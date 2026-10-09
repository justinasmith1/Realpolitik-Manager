// Validación del formulario de cliente. Las reglas son las de `CreateClienteSchema`
// (shared): acá solo se adapta el resultado a un formulario.
//
// Hacen falta dos ajustes que el schema no resuelve por sí solo:
// - Con el sector vacío, la unión discriminada se detiene en `sector` y no revisa el resto.
//   Para mostrar todos los errores juntos, se valida el resto como si fuera PRIVADO (los
//   campos comunes son idénticos en ambas ramas) y el sector se informa aparte.
// - Para un campo vacío, Zod responde "Required" o un error de enum en inglés. El contrato
//   deja esos textos al front, así que un campo vacío usa el mensaje propio de abajo.
// - La regla del canal de entrega es un `superRefine` en shared, y Zod solo lo corre
//   si todo lo demás es válido. Para no esconder "falta la URL" hasta que se corrija el CUIT,
//   los vacíos condicionales (`portalUrl`, `whatsappNumero`) también se chequean acá.

import {
  CreateClienteSchema,
  type CanalEntregaType,
  type ClienteSectorType,
  type ClienteSubtipoPublicoType,
  type CreateClienteDto,
  type IvaCondicionType,
} from '@realpolitik/shared';
import type { FieldErrors, Resolver } from 'react-hook-form';

import type { NuevoCliente } from '@/modules/clientes/api/clientes.api';

/** Valores del formulario: texto libre o una opción todavía sin elegir (''). */
export interface ClienteFormValues {
  razonSocial: string;
  denominacion: string;
  cuit: string;
  sector: ClienteSectorType | '';
  subtipo: ClienteSubtipoPublicoType | '';
  ivaCondicion: IvaCondicionType | '';
  emailContacto: string;
  canalEntrega: CanalEntregaType;
  portalUrl: string;
  whatsappNumero: string;
}

export type CampoClienteForm = keyof ClienteFormValues;

/**
 * Los selects de datos fiscales arrancan sin opción elegida. El canal arranca en CORREO,
 * igual que el default de la base: es el canal habitual y no obliga a cargar nada extra.
 */
export const valoresInicialesClienteForm: ClienteFormValues = {
  razonSocial: '',
  denominacion: '',
  cuit: '',
  sector: '',
  subtipo: '',
  ivaCondicion: '',
  emailContacto: '',
  canalEntrega: 'CORREO',
  portalUrl: '',
  whatsappNumero: '',
};

const mensajesCampoVacio: Record<CampoClienteForm, string> = {
  razonSocial: 'Ingresá la razón social.',
  denominacion: 'Ingresá la denominación.',
  cuit: 'Ingresá el CUIT.',
  sector: 'Elegí el sector.',
  subtipo: 'Elegí el subtipo.',
  ivaCondicion: 'Elegí la condición frente al IVA.',
  emailContacto: 'Ingresá el email de contacto.',
  canalEntrega: 'Elegí el canal de entrega.',
  portalUrl: 'Ingresá la URL del portal.',
  whatsappNumero: 'Ingresá el número de WhatsApp.',
};

const campos = Object.keys(mensajesCampoVacio) as CampoClienteForm[];

const esCampo = (valor: unknown): valor is CampoClienteForm =>
  typeof valor === 'string' && valor in mensajesCampoVacio;

// Campos que solo son obligatorios en ciertas condiciones. El resto lo es siempre.
function estaVacio(campo: CampoClienteForm, valores: ClienteFormValues): boolean {
  switch (campo) {
    case 'subtipo':
      return valores.sector === 'PUBLICO' && valores.subtipo === '';
    case 'portalUrl':
      return valores.canalEntrega === 'PORTAL_WEB' && valores.portalUrl.trim() === '';
    case 'whatsappNumero':
      return valores.canalEntrega === 'WHATSAPP' && valores.whatsappNumero.trim() === '';
    default:
      return valores[campo].trim() === '';
  }
}

// Lo que se valida con shared. El CUIT y el email se recortan porque es común pegarlos con
// espacios; el resto de la normalización la hace el schema. Del canal se envía solo el dato
// que corresponde: una URL tipeada y luego descartada al pasar a WhatsApp no debe viajar.
function aCandidato(valores: ClienteFormValues): Record<string, unknown> {
  const sector = valores.sector === '' ? 'PRIVADO' : valores.sector;
  return {
    razonSocial: valores.razonSocial,
    denominacion: valores.denominacion,
    cuit: valores.cuit.trim(),
    sector,
    ...(sector === 'PUBLICO' && valores.subtipo !== '' ? { subtipo: valores.subtipo } : {}),
    ...(valores.ivaCondicion === '' ? {} : { ivaCondicion: valores.ivaCondicion }),
    emailContacto: valores.emailContacto.trim(),
    canalEntrega: valores.canalEntrega,
    ...(valores.canalEntrega === 'PORTAL_WEB' && valores.portalUrl.trim() !== ''
      ? { portalUrl: valores.portalUrl.trim() }
      : {}),
    ...(valores.canalEntrega === 'WHATSAPP' && valores.whatsappNumero.trim() !== ''
      ? { whatsappNumero: valores.whatsappNumero.trim() }
      : {}),
  };
}

// Solo los campos del formulario, con los valores ya normalizados por shared (CUIT canónico,
// textos recortados, email en minúsculas, WhatsApp en E.164). Lo que el schema agrega por
// defecto (`emailsAdicionales`) no se envía, y un privado nunca lleva subtipo.
function aNuevoCliente(datos: CreateClienteDto): NuevoCliente {
  const comunes = {
    razonSocial: datos.razonSocial,
    denominacion: datos.denominacion,
    cuit: datos.cuit,
    ivaCondicion: datos.ivaCondicion,
    emailContacto: datos.emailContacto,
    canalEntrega: datos.canalEntrega,
    ...(datos.portalUrl === undefined ? {} : { portalUrl: datos.portalUrl }),
    ...(datos.whatsappNumero === undefined ? {} : { whatsappNumero: datos.whatsappNumero }),
  };
  return datos.sector === 'PUBLICO'
    ? { ...comunes, sector: 'PUBLICO', subtipo: datos.subtipo }
    : { ...comunes, sector: 'PRIVADO' };
}

/**
 * Valida el formulario completo. Si es válido, entrega el `NuevoCliente` listo para enviar;
 * si no, un error por campo (el primero que corresponda a cada uno).
 */
export const clienteFormResolver: Resolver<ClienteFormValues, unknown, NuevoCliente> = (
  valores,
) => {
  const errores: FieldErrors<ClienteFormValues> = {};
  const agregar = (campo: CampoClienteForm, message: string) => {
    errores[campo] ??= { type: 'validate', message };
  };

  for (const campo of campos) {
    if (estaVacio(campo, valores)) {
      agregar(campo, mensajesCampoVacio[campo]);
    }
  }

  const resultado = CreateClienteSchema.safeParse(aCandidato(valores));
  if (!resultado.success) {
    for (const issue of resultado.error.issues) {
      const campo = issue.path[0];
      if (esCampo(campo)) {
        agregar(campo, issue.message);
      }
    }
    // Shared rechazó algo que el formulario no muestra (p. ej. un campo obligatorio nuevo).
    // Sin un error, RHF daría el formulario por válido y enviaría `values` vacíos.
    if (Object.keys(errores).length === 0) {
      // RHF tipa `root` como error y a la vez como mapa de errores con nombre; se usa la
      // forma simple (`errors.root.message`), la misma que deja `setError('root', …)`.
      errores.root = { type: 'validate', message: 'Revisá los datos.' } as NonNullable<
        FieldErrors<ClienteFormValues>['root']
      >;
    }
  }

  if (!resultado.success || Object.keys(errores).length > 0) {
    return { values: {}, errors: errores };
  }
  return { values: aNuevoCliente(resultado.data), errors: {} };
};
