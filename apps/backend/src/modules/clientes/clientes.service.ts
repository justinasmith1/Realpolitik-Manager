import { Prisma, type Cliente as ClienteRow } from '@prisma/client';
import type { Cliente, CreateClienteDto, ListarClientesQuery } from '@realpolitik/shared';

import { conflict, type AppError } from '../../errors/app-error';
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

// Busca `q` en razón social, denominación y CUIT, sin distinguir mayúsculas.
function condicionesDeBusqueda(q: string): Prisma.ClienteWhereInput[] {
  return [
    { razonSocial: { contains: q, mode: 'insensitive' } },
    { denominacion: { contains: q, mode: 'insensitive' } },
    ...fragmentosDeCuit(q).map((fragmento) => ({ cuit: { contains: fragmento } })),
  ];
}

// El CUIT se guarda como XX-XXXXXXXX-X, pero se busca con o sin guiones. Si `q` solo tiene
// dígitos, guiones y espacios, se prueba el fragmento en cada posición posible del CUIT,
// con los guiones que le tocarían ahí (la base no puede ignorarlos al comparar).
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
    sector: input.sector,
    subtipo: input.sector === 'PUBLICO' ? input.subtipo : null,
    estado: 'ACTIVO',
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
