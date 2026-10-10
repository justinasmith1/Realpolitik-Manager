import { Prisma, type Cliente as ClienteRow } from '@prisma/client';
import {
  problemasDeEmails,
  type ActualizarEstadoClienteDto,
  type Cliente,
  type CreateClienteDto,
  type ListarClientesQuery,
  type Periodicidad,
  type UpdateClienteDto,
} from '@realpolitik/shared';

import { conflict, notFound, validationError, type AppError } from '../../errors/app-error';
import { escaparComodinesDeLike } from '../../lib/like';
import { prisma } from '../../lib/prisma';

import { toClienteDto } from './cliente.mapper';

/**
 * Registra un cliente nuevo (HU1.1). Siempre nace ACTIVO.
 *
 * No se consulta antes si el CUIT existe: la garantía es el índice único de la base, y una
 * preconsulta igual dejaría pasar dos altas simultáneas. Se intenta crear y, si la base
 * rechaza el CUIT, se informa cuál es el cliente que ya lo tiene.
 */
export async function crearCliente(input: CreateClienteDto): Promise<Cliente> {
  let creado: ClienteRow;
  try {
    creado = await prisma.cliente.create({ data: datosDeAlta(input) });
  } catch (error) {
    if (esCuitDuplicado(error)) {
      throw await conflictoPorCuit(input.cuit, error);
    }
    throw error;
  }
  return toClienteDto(creado);
}

/**
 * Modifica un cliente (HU1.7). Solo cambia los campos enviados; `telefono` y
 * `emailsAdicionales` se conservan mientras el pedido no los traiga.
 *
 * Igual que en el alta, la garantía del CUIT es el índice único: como el `update` no choca
 * con la propia fila, enviar el CUIT que el cliente ya tiene no es un duplicado.
 */
export async function actualizarCliente(id: string, input: UpdateClienteDto): Promise<Cliente> {
  const actual = await prisma.cliente.findFirst({
    where: { id, isDeleted: false },
    select: { sector: true, canalEntrega: true, emailContacto: true, emailsAdicionales: true },
  });
  if (actual === null) {
    throw notFound('Cliente no encontrado');
  }

  validarEmailsResultantes(input, actual);

  // Un `subtipo` suelto se valida contra el sector guardado; con `sector` ya lo validó shared.
  if (input.sector === undefined && input.subtipo !== undefined && actual.sector === 'PRIVADO') {
    throw validationError([
      { campo: 'subtipo', mensaje: 'Los clientes privados no tienen subtipo.' },
    ]);
  }

  // Sin cambio de canal, el dato de entrega enviado se valida contra el canal guardado:
  // una URL o un número que el canal actual no usa quedarían escondidos. Con cambio de
  // canal ya lo validó shared y `datosDeEdicion` limpia el dato del otro canal.
  if (input.canalEntrega === undefined) {
    if (input.portalUrl !== undefined && actual.canalEntrega !== 'PORTAL_WEB') {
      throw validationError([
        {
          campo: 'portalUrl',
          mensaje: 'Para cargar la URL del portal, el canal tiene que ser Portal web.',
        },
      ]);
    }
    if (input.whatsappNumero !== undefined && actual.canalEntrega !== 'WHATSAPP') {
      throw validationError([
        {
          campo: 'whatsappNumero',
          mensaje: 'Para cargar el número, el canal tiene que ser WhatsApp.',
        },
      ]);
    }
  }

  let actualizado: ClienteRow;
  try {
    actualizado = await prisma.cliente.update({
      where: { id, isDeleted: false },
      data: datosDeEdicion(input),
    });
  } catch (error) {
    if (input.cuit !== undefined && esCuitDuplicado(error)) {
      throw await conflictoPorCuit(input.cuit, error);
    }
    // El cliente se dio de baja entre la consulta y el `update`.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw notFound('Cliente no encontrado');
    }
    throw error;
  }
  return toClienteDto(actualizado);
}

/**
 * La regla de los emails (shared) se aplica al estado RESULTANTE de la edición: lo enviado más
 * lo guardado. El schema solo ve el pedido, y un PATCH que trae uno de los dos campos (el
 * principal o los adicionales) podría chocar con el otro, que ya está en la base.
 *
 * Si el pedido no trae los adicionales, solo importa que el principal nuevo no esté entre los
 * guardados; los repetidos que ya hubiera entre ellos no se tocan ni bloquean la edición.
 */
function validarEmailsResultantes(
  input: UpdateClienteDto,
  actual: Pick<ClienteRow, 'emailContacto' | 'emailsAdicionales'>,
): void {
  if (input.emailContacto === undefined && input.emailsAdicionales === undefined) return;

  const problemas = problemasDeEmails({
    emailContacto: input.emailContacto ?? actual.emailContacto,
    emailsAdicionales: input.emailsAdicionales ?? actual.emailsAdicionales,
  });

  if (input.emailsAdicionales !== undefined) {
    if (problemas.length > 0) {
      throw validationError(
        problemas.map(({ indice, mensaje }) => ({
          campo: `emailsAdicionales.${indice}`,
          mensaje,
        })),
      );
    }
    return;
  }

  // Los adicionales no vienen en el pedido: el error es del principal que se quiere cargar.
  if (problemas.some(({ tipo }) => tipo === 'IGUAL_AL_PRINCIPAL')) {
    throw validationError([
      {
        campo: 'emailContacto',
        mensaje:
          'Este email ya está cargado como email adicional del cliente: quitalo de los adicionales o usá otro.',
      },
    ]);
  }
}

// Cuántas veces se vuelve a intentar si el estado cambia entre la escritura condicional y la
// lectura (otro pedido lo cambió justo en medio). Alcanza con pocas: hace falta que el estado
// oscile en cada intento para agotarlas.
const INTENTOS_DE_CAMBIO_DE_ESTADO = 3;

/**
 * Activa o desactiva un cliente (HU1.8). Solo cambia `estado`: los datos, los contactos y
 * lo demás no se tocan, y no se usa la baja lógica (`isDeleted`), que es otra cosa. Pedir el
 * estado que el cliente ya tiene responde 200 con el cliente tal cual, SIN escribir la fila
 * (`updatedAt` no cambia).
 *
 * Una sola sentencia decide si hay que escribir: `UPDATE … WHERE id AND NOT isDeleted AND
 * estado <> nuevo RETURNING …` (el `update` de Prisma con filtros extra en el `where`).
 * - Si escribe, devuelve la fila que escribió: respuesta y escritura coinciden.
 * - Si no matchea (P2025), el cliente no existe, está dado de baja o ya tiene ese estado: se
 *   lee para distinguirlo. Leer y escribir por separado ("leer, y si difiere, actualizar")
 *   dejaría escribir dos veces a dos pedidos simultáneos; acá la condición la evalúa
 *   PostgreSQL al tomar el lock de la fila, así que de dos pedidos iguales solo uno escribe.
 * - Si al leer el estado ya no es el pedido, otro pedido lo cambió entre la escritura y la
 *   lectura: se reintenta, para que la respuesta muestre el estado que se pidió.
 *
 * No hace falta una transacción: cada paso es una sentencia atómica y ninguno depende de un
 * dato leído en otro. Tampoco SQL crudo.
 */
export async function cambiarEstadoCliente(
  id: string,
  estado: ActualizarEstadoClienteDto['estado'],
): Promise<Cliente> {
  for (let intento = 1; intento <= INTENTOS_DE_CAMBIO_DE_ESTADO; intento++) {
    try {
      const actualizado = await prisma.cliente.update({
        where: { id, isDeleted: false, estado: { not: estado } },
        data: { estado },
      });
      return toClienteDto(actualizado);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2025') {
        throw error;
      }
    }

    const actual = await prisma.cliente.findFirst({ where: { id, isDeleted: false } });
    if (actual === null) {
      throw notFound('Cliente no encontrado');
    }
    if (actual.estado === estado) {
      return toClienteDto(actual);
    }
  }
  throw new Error(
    `El estado del cliente ${id} cambió durante ${INTENTOS_DE_CAMBIO_DE_ESTADO} intentos seguidos.`,
  );
}

/**
 * Lista los clientes (HU1.2). Excluye los dados de baja (`isDeleted`) y ordena por razón
 * social. Sin paginación, según el contrato.
 */
export async function listarClientes(filtros: ListarClientesQuery): Promise<Cliente[]> {
  const where: Prisma.ClienteWhereInput = {
    isDeleted: false,
    estado: filtros.estado,
    ...(filtros.sector !== undefined && { sector: filtros.sector }),
    ...(filtros.subtipo !== undefined && { subtipo: filtros.subtipo }),
    ...(filtros.q !== undefined && { OR: condicionesDeBusqueda(filtros.q) }),
  };

  const filas = await prisma.cliente.findMany({ where, orderBy: { razonSocial: 'asc' } });
  return filas.map(toClienteDto);
}

// Busca `q` en razón social, denominación y CUIT, sin distinguir mayúsculas. El texto se busca
// literalmente: `contains` no escapa los comodines de LIKE (ver `escaparComodinesDeLike`).
function condicionesDeBusqueda(q: string): Prisma.ClienteWhereInput[] {
  const texto = escaparComodinesDeLike(q);
  return [
    { razonSocial: { contains: texto, mode: 'insensitive' } },
    { denominacion: { contains: texto, mode: 'insensitive' } },
    ...fragmentosDeCuit(q).map((fragmento) => ({ cuit: { contains: fragmento } })),
  ];
}

// El CUIT se guarda como XX-XXXXXXXX-X, pero se busca con o sin guiones. Si `q` solo tiene
// dígitos, guiones y espacios, se prueba el fragmento en cada posición posible del CUIT,
// con los guiones que le tocarían ahí (la base no puede ignorarlos al comparar). Solo lleva
// dígitos y guiones, así que no hay comodines que escapar.
function fragmentosDeCuit(q: string): string[] {
  if (!/^[\d\s-]+$/.test(q)) return [];
  const digitos = q.replace(/\D/g, '');
  if (digitos === '') return [];

  const fragmentos = new Set<string>();
  for (let inicio = 0; inicio + digitos.length <= 11; inicio++) {
    let texto = '';
    for (let i = 0; i < digitos.length; i++) {
      const posicion = inicio + i;
      if (posicion === 2 || posicion === 10) texto += '-';
      texto += digitos[i];
    }
    fragmentos.add(texto);
  }
  return [...fragmentos];
}

// Campo por campo, sin spread del input: si el DTO de alta suma campos en el futuro, no
// llegan a la base sin una decisión explícita.
function datosDeAlta(input: CreateClienteDto): Prisma.ClienteCreateInput {
  return {
    razonSocial: input.razonSocial,
    denominacion: input.denominacion,
    cuit: input.cuit,
    ivaCondicion: input.ivaCondicion,
    emailContacto: input.emailContacto,
    emailsAdicionales: input.emailsAdicionales,
    telefono: input.telefono ?? null,
    portalUrl: input.portalUrl ?? null,
    canalEntrega: input.canalEntrega,
    whatsappNumero: input.whatsappNumero ?? null,
    ...columnasDePeriodicidad(input.periodicidad),
    sector: input.sector,
    subtipo: input.sector === 'PUBLICO' ? input.subtipo : null,
    estado: 'ACTIVO',
  };
}

// La periodicidad vive en tres columnas: configurada se escriben las tres, y sin configurar
// (alta sin periodicidad o `null` en la edición) quedan las tres en null.
function columnasDePeriodicidad(periodicidad: Periodicidad | null | undefined) {
  return {
    periodicidadTipo: periodicidad?.tipo ?? null,
    periodicidadDiaLimite: periodicidad?.diaLimite ?? null,
    periodicidadMesInicioCiclo: periodicidad?.mesInicioCiclo ?? null,
  };
}

// Solo los campos enviados, uno por uno: lo que el pedido no trae no se toca. Dos reglas
// de consistencia:
// - Al cambiar el sector, un privado queda sin subtipo.
// - Al cambiar el canal, el dato del otro canal se limpia para no dejarlo escondido. Si el
//   pedido trae `portalUrl` o `whatsappNumero` sin cambiar el canal, `actualizarCliente` ya
//   comprobó que coincide con el canal guardado y se guarda tal cual (un cliente que ya
//   está en PORTAL_WEB puede cambiar solo la URL).
function datosDeEdicion(input: UpdateClienteDto): Prisma.ClienteUpdateInput {
  return {
    ...(input.razonSocial !== undefined && { razonSocial: input.razonSocial }),
    ...(input.denominacion !== undefined && { denominacion: input.denominacion }),
    ...(input.cuit !== undefined && { cuit: input.cuit }),
    ...(input.ivaCondicion !== undefined && { ivaCondicion: input.ivaCondicion }),
    ...(input.emailContacto !== undefined && { emailContacto: input.emailContacto }),
    ...(input.emailsAdicionales !== undefined && { emailsAdicionales: input.emailsAdicionales }),
    ...(input.telefono !== undefined && { telefono: input.telefono }),
    // Ausente = no se toca; `null` = borrar; objeto = reemplazar las tres columnas.
    ...(input.periodicidad !== undefined && columnasDePeriodicidad(input.periodicidad)),
    ...(input.sector !== undefined && {
      sector: input.sector,
      // Para un público, shared ya exigió el subtipo en el mismo pedido.
      subtipo: input.sector === 'PUBLICO' ? (input.subtipo ?? null) : null,
    }),
    ...(input.sector === undefined && input.subtipo !== undefined && { subtipo: input.subtipo }),
    ...(input.canalEntrega === undefined
      ? {
          ...(input.portalUrl !== undefined && { portalUrl: input.portalUrl }),
          ...(input.whatsappNumero !== undefined && { whatsappNumero: input.whatsappNumero }),
        }
      : {
          canalEntrega: input.canalEntrega,
          portalUrl: input.canalEntrega === 'PORTAL_WEB' ? (input.portalUrl ?? null) : null,
          whatsappNumero: input.canalEntrega === 'WHATSAPP' ? (input.whatsappNumero ?? null) : null,
        }),
  };
}

// Con PostgreSQL, Prisma 5 informa en `meta.target` los campos del índice violado
// (`['cuit']`). Solo ese índice es un CUIT duplicado: cualquier otro P2002 sigue como
// error inesperado.
function esCuitDuplicado(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target) && target.length === 1 && target[0] === 'cuit';
}

// El CUIT queda reservado por cualquier cliente, sin importar su estado ni la baja lógica,
// así que la búsqueda no filtra. Si el registro ya no está (se borró entre ambas consultas),
// no hay a quién señalar: se relanza el error original, que termina en un 500.
async function conflictoPorCuit(
  cuit: string,
  original: Prisma.PrismaClientKnownRequestError,
): Promise<AppError> {
  const existente = await prisma.cliente.findUnique({
    where: { cuit },
    select: { id: true, razonSocial: true, estado: true },
  });
  if (existente === null) {
    throw original;
  }
  return conflict(
    'CUIT_DUPLICADO',
    {
      clienteExistente: {
        id: existente.id,
        razonSocial: existente.razonSocial,
        estado: existente.estado,
      },
    },
    'Ya existe un cliente con ese CUIT',
  );
}
