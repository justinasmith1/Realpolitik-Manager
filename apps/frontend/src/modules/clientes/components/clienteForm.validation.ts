// Validación del formulario de cliente. Las reglas son las de `CreateClienteSchema`
// (shared): acá solo se adapta el resultado a un formulario.
//
// Hacen falta dos ajustes que el schema no resuelve por sí solo:
// - Con el sector vacío, la unión discriminada se detiene en `sector` y no revisa el resto.
//   Para mostrar todos los errores juntos, se valida el resto como si fuera PRIVADO (los
//   campos comunes son idénticos en ambas ramas) y el sector se informa aparte.
// - Para un campo vacío, Zod responde "Required" o un error de enum en inglés. El contrato
//   deja esos textos al front, así que un campo vacío usa el mensaje propio de abajo.

import {
  CreateClienteSchema,
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
}

export type CampoClienteForm = keyof ClienteFormValues;

/** Sin valores por defecto: los selects arrancan sin opción elegida. */
export const valoresInicialesClienteForm: ClienteFormValues = {
  razonSocial: '',
  denominacion: '',
  cuit: '',
  sector: '',
  subtipo: '',
  ivaCondicion: '',
  emailContacto: '',
};

const mensajesCampoVacio: Record<CampoClienteForm, string> = {
  razonSocial: 'Ingresá la razón social.',
  denominacion: 'Ingresá la denominación.',
  cuit: 'Ingresá el CUIT.',
  sector: 'Elegí el sector.',
  subtipo: 'Elegí el subtipo.',
  ivaCondicion: 'Elegí la condición frente al IVA.',
  emailContacto: 'Ingresá el email de contacto.',
};

const campos = Object.keys(mensajesCampoVacio) as CampoClienteForm[];

const esCampo = (valor: unknown): valor is CampoClienteForm =>
  typeof valor === 'string' && valor in mensajesCampoVacio;

function estaVacio(campo: CampoClienteForm, valores: ClienteFormValues): boolean {
  if (campo === 'subtipo') {
    return valores.sector === 'PUBLICO' && valores.subtipo === '';
  }
  return valores[campo].trim() === '';
}

// Lo que se valida con shared. El CUIT y el email se recortan porque es común pegarlos con
// espacios; el resto de la normalización la hace el schema.
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
  };
}

// Solo los campos de HU1.1, con los valores ya normalizados por shared (CUIT canónico,
// textos recortados, email en minúsculas). Lo que el schema agrega por defecto
// (`emailsAdicionales`) no se envía, y un privado nunca lleva subtipo.
function aNuevoCliente(datos: CreateClienteDto): NuevoCliente {
  const comunes = {
    razonSocial: datos.razonSocial,
    denominacion: datos.denominacion,
    cuit: datos.cuit,
    ivaCondicion: datos.ivaCondicion,
    emailContacto: datos.emailContacto,
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
