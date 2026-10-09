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
// - La periodicidad es un objeto en shared y tres campos sueltos en el formulario. Los
//   inputs dan texto: el número se arma acá, explícito, y los errores de shared
//   (`periodicidad.diaLimite`) se devuelven al campo del formulario que corresponde.

import {
  CreateClienteSchema,
  type CanalEntregaType,
  type Cliente,
  type ClienteSectorType,
  type ClienteSubtipoPublicoType,
  type CreateClienteDto,
  type IvaCondicionType,
  type PeriodicidadTipoType,
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
  /** '' = sin configurar: la periodicidad es opcional. */
  periodicidadTipo: PeriodicidadTipoType | '';
  /** Texto del input; se convierte a número recién al validar. */
  periodicidadDiaLimite: string;
  /** Valor del select ('1' a '12'); solo aplica a BIMESTRAL. */
  periodicidadMesInicioCiclo: string;
}

export type CampoClienteForm = keyof ClienteFormValues;

/**
 * Los selects de datos fiscales arrancan sin opción elegida. El canal arranca en CORREO,
 * igual que el default de la base: es el canal habitual y no obliga a cargar nada extra.
 * La periodicidad arranca sin configurar.
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
  periodicidadTipo: '',
  periodicidadDiaLimite: '',
  periodicidadMesInicioCiclo: '',
};

/** Valores iniciales del formulario de edición: los datos que ya tiene el cliente. */
export function clienteAValoresForm(cliente: Cliente): ClienteFormValues {
  const { periodicidad } = cliente;
  return {
    razonSocial: cliente.razonSocial,
    denominacion: cliente.denominacion,
    cuit: cliente.cuit,
    sector: cliente.sector,
    subtipo: cliente.sector === 'PUBLICO' ? cliente.subtipo : '',
    ivaCondicion: cliente.ivaCondicion,
    emailContacto: cliente.emailContacto,
    canalEntrega: cliente.canalEntrega,
    portalUrl: cliente.portalUrl ?? '',
    whatsappNumero: cliente.whatsappNumero ?? '',
    // Sin periodicidad, los tres campos quedan vacíos ("Sin configurar").
    periodicidadTipo: periodicidad?.tipo ?? '',
    periodicidadDiaLimite: periodicidad === null ? '' : String(periodicidad.diaLimite),
    periodicidadMesInicioCiclo:
      periodicidad?.tipo === 'BIMESTRAL' ? String(periodicidad.mesInicioCiclo) : '',
  };
}

/** Campos que pueden ser obligatorios. El tipo de periodicidad nunca lo es. */
type CampoObligatorio = Exclude<CampoClienteForm, 'periodicidadTipo'>;

const mensajesCampoVacio: Record<CampoObligatorio, string> = {
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
  periodicidadDiaLimite: 'Ingresá el día límite.',
  periodicidadMesInicioCiclo: 'Elegí el mes de inicio del ciclo.',
};

const camposObligatorios = Object.keys(mensajesCampoVacio) as CampoObligatorio[];

const esCampo = (valor: unknown): valor is CampoClienteForm =>
  typeof valor === 'string' && valor in valoresInicialesClienteForm;

// Shared informa la periodicidad como objeto (`['periodicidad', 'diaLimite']`); el
// formulario la tiene en tres campos sueltos.
const campoDePeriodicidad: Record<string, CampoClienteForm> = {
  tipo: 'periodicidadTipo',
  diaLimite: 'periodicidadDiaLimite',
  mesInicioCiclo: 'periodicidadMesInicioCiclo',
};

function campoDelIssue(path: readonly PropertyKey[]): CampoClienteForm | undefined {
  const [campo, subcampo] = path;
  if (campo === 'periodicidad') {
    return typeof subcampo === 'string' ? campoDePeriodicidad[subcampo] : 'periodicidadTipo';
  }
  return esCampo(campo) ? campo : undefined;
}

// Campos que solo son obligatorios en ciertas condiciones. El resto lo es siempre.
function estaVacio(campo: CampoObligatorio, valores: ClienteFormValues): boolean {
  switch (campo) {
    case 'subtipo':
      return valores.sector === 'PUBLICO' && valores.subtipo === '';
    case 'portalUrl':
      return valores.canalEntrega === 'PORTAL_WEB' && valores.portalUrl.trim() === '';
    case 'whatsappNumero':
      return valores.canalEntrega === 'WHATSAPP' && valores.whatsappNumero.trim() === '';
    case 'periodicidadDiaLimite':
      return valores.periodicidadTipo !== '' && valores.periodicidadDiaLimite.trim() === '';
    case 'periodicidadMesInicioCiclo':
      return valores.periodicidadTipo === 'BIMESTRAL' && valores.periodicidadMesInicioCiclo === '';
    default:
      return valores[campo].trim() === '';
  }
}

// Un texto de solo dígitos pasa a número. Cualquier otra cosa ("10.5", "1e1", "diez") viaja
// tal cual para que shared la rechace con su mensaje: no se redondea ni se interpreta.
function aNumero(texto: string): number | string | undefined {
  const limpio = texto.trim();
  if (limpio === '') return undefined;
  return /^\d+$/.test(limpio) ? Number(limpio) : limpio;
}

// Sin tipo no hay periodicidad: el día o el mes que hayan quedado escritos no viajan.
// El mes solo se envía en BIMESTRAL; en los demás tipos es `null`, como pide shared.
function aPeriodicidad(valores: ClienteFormValues): Record<string, unknown> | undefined {
  if (valores.periodicidadTipo === '') return undefined;
  return {
    tipo: valores.periodicidadTipo,
    diaLimite: aNumero(valores.periodicidadDiaLimite),
    mesInicioCiclo:
      valores.periodicidadTipo === 'BIMESTRAL' ? aNumero(valores.periodicidadMesInicioCiclo) : null,
  };
}

// Lo que se valida con shared. El CUIT y el email se recortan porque es común pegarlos con
// espacios; el resto de la normalización la hace el schema. Del canal se envía solo el dato
// que corresponde: una URL tipeada y luego descartada al pasar a WhatsApp no debe viajar.
function aCandidato(valores: ClienteFormValues): Record<string, unknown> {
  const sector = valores.sector === '' ? 'PRIVADO' : valores.sector;
  const periodicidad = aPeriodicidad(valores);
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
    ...(periodicidad === undefined ? {} : { periodicidad }),
  };
}

// Solo los campos del formulario, con los valores ya normalizados por shared (CUIT canónico,
// textos recortados, email en minúsculas, WhatsApp en E.164). Lo que el schema agrega por
// defecto (`emailsAdicionales`) no se envía, y un privado nunca lleva subtipo. Sin
// periodicidad configurada, la clave no se envía (no es `null`: eso significa "borrarla").
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
    // Shared ya dejó solo `tipo`, `diaLimite` y `mesInicioCiclo`, con números de verdad.
    ...(datos.periodicidad === undefined ? {} : { periodicidad: datos.periodicidad }),
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

  for (const campo of camposObligatorios) {
    if (estaVacio(campo, valores)) {
      agregar(campo, mensajesCampoVacio[campo]);
    }
  }

  const resultado = CreateClienteSchema.safeParse(aCandidato(valores));
  if (!resultado.success) {
    for (const issue of resultado.error.issues) {
      const campo = campoDelIssue(issue.path);
      if (campo !== undefined) {
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
