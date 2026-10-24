// Validación del formulario de un requisito (alta y edición). Las reglas son las de shared:
// cantidad, días, canal y nota. Acá solo se adapta el texto del formulario (campos vacíos, días
// a medias) para no mandar una lista que el schema tomaría por válida si se descartaran huecos.

import {
  CanalEntrega,
  CanalPropioSchema,
  CantidadSchema,
  CreateRequisitoClienteSchema,
  DiasAproximadosSchema,
  NotaSchema,
  TipoDocumentoIdSchema,
  problemaDeDias,
  type CanalEntregaType,
  type RequisitoCliente,
} from '@realpolitik/shared';
import type { FieldError, FieldErrors, Resolver } from 'react-hook-form';

import type { CambiosRequisito, NuevoRequisito } from '@/modules/clientes/api/requisitos.api';

/** Valores del formulario. `canal` vacío = usar el canal principal del cliente. */
export interface RequisitoFormValues {
  tipoDocumentoId: string;
  cantidad: string;
  /** Un texto por documento. Puede haber más que la cantidad si sobran y no se quitaron. */
  dias: string[];
  canal: '' | CanalEntregaType;
  nota: string;
}

export const valoresInicialesAlta: RequisitoFormValues = {
  tipoDocumentoId: '',
  cantidad: '1',
  dias: [],
  canal: '',
  nota: '',
};

export type CampoRequisito = 'tipoDocumentoId' | 'cantidad' | 'dias' | 'canal' | 'nota';

/** Lo que viaja a la API, ya normalizado por shared (días ordenados, nota vacía en `null`). */
export interface RequisitoNormalizado {
  tipoDocumentoId: string;
  cantidad: number;
  diasAproximados: number[];
  canalEntrega: CanalEntregaType | null;
  nota: string | null;
}

const MENSAJE_LISTA_A_MEDIAS = 'Completá cada día o limpiá todos. Una lista a medias no se guarda.';
const MENSAJE_DIA_VACIO = 'Completá este día.';

export function leerCantidad(texto: string): number | undefined {
  const limpio = texto.trim();
  if (limpio === '') return undefined;
  if (!/^\d+$/.test(limpio)) return Number.NaN;
  return Number(limpio);
}

/** Mensaje de shared para un día escrito en su campo, o `null` si sirve. Vacío no es un error de rango. */
export function mensajeDeDia(texto: string): string | null {
  const limpio = texto.trim();
  if (limpio === '') return null;
  const numerico = /^\d+$/.test(limpio) ? Number(limpio) : Number.NaN;
  const resultado = DiasAproximadosSchema.safeParse([numerico]);
  if (resultado.success) return null;
  return resultado.error.issues[0]?.message ?? null;
}

/**
 * Al cambiar la cantidad no se borran días. Si hacen falta más casilleros, se agregan vacíos.
 * Si la cantidad no es válida, la lista queda igual.
 */
export function diasTrasCambiarCantidad(dias: readonly string[], cantidadTexto: string): string[] {
  if (dias.length === 0) return [];
  const valida = CantidadSchema.safeParse(leerCantidad(cantidadTexto));
  if (!valida.success || dias.length >= valida.data) return [...dias];
  return [...dias, ...Array.from({ length: valida.data - dias.length }, () => '')];
}

/** Casilleros vacíos, uno por documento. `null` si la cantidad no sirve para abrirlos. */
export function indicarDias(cantidadTexto: string): string[] | null {
  const valida = CantidadSchema.safeParse(leerCantidad(cantidadTexto));
  if (!valida.success) return null;
  return Array.from({ length: valida.data }, () => '');
}

/** Quita los días que pasan de la cantidad. Es una acción explícita: no ocurre sola. */
export function quitarDiasSobrantes(dias: readonly string[], cantidadTexto: string): string[] {
  const valida = CantidadSchema.safeParse(leerCantidad(cantidadTexto));
  if (!valida.success) return [...dias];
  return dias.slice(0, valida.data);
}

function largoDe(dias: readonly string[]): number[] {
  return Array.from({ length: dias.length }, () => 1);
}

/**
 * Incompatibilidad visible de los días. Antes de enviar, una lista toda vacía todavía no se marca:
 * la persona acaba de pedir los casilleros. Al enviar, tampoco cuenta como lista vacía válida.
 */
export function incompatibilidadDeDias(
  valores: Pick<RequisitoFormValues, 'cantidad' | 'dias'>,
  alEnviar: boolean,
): string | null {
  if (valores.dias.length === 0) return null;
  const cantidad = CantidadSchema.safeParse(leerCantidad(valores.cantidad));
  if (!cantidad.success) return null;
  const problema = problemaDeDias(cantidad.data, largoDe(valores.dias));
  if (problema !== null) return problema;
  const vacios = valores.dias.filter((dia) => dia.trim() === '').length;
  if (vacios === 0) return null;
  if (vacios === valores.dias.length && !alEnviar) return null;
  return MENSAJE_LISTA_A_MEDIAS;
}

export function requisitoAValoresForm(requisito: RequisitoCliente): RequisitoFormValues {
  return {
    tipoDocumentoId: requisito.tipoDocumento.id,
    cantidad: String(requisito.cantidad),
    dias: requisito.diasAproximados.map(String),
    canal: requisito.canalEntrega ?? '',
    nota: requisito.nota ?? '',
  };
}

function diasEquivalentes(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const numeros = (dias: readonly string[]) =>
    dias.map((dia) => {
      const limpio = dia.trim();
      if (limpio === '') return null;
      if (mensajeDeDia(limpio) !== null) return undefined;
      return Number(limpio);
    });
  const na = numeros(a);
  const nb = numeros(b);
  if (na.some((n) => n === undefined) || nb.some((n) => n === undefined)) {
    return a.every((dia, indice) => dia.trim() === (b[indice] ?? '').trim());
  }
  const ordenar = (lista: readonly (number | null | undefined)[]) =>
    [...lista].sort((x, y) => (x ?? -1) - (y ?? -1));
  return JSON.stringify(ordenar(na)) === JSON.stringify(ordenar(nb));
}

/** Misma intención de guardado: el orden de los días no cuenta, shared los ordena. */
export function valoresEquivalentes(a: RequisitoFormValues, b: RequisitoFormValues): boolean {
  if (a.tipoDocumentoId !== b.tipoDocumentoId || a.canal !== b.canal) return false;
  if (a.nota.trim() !== b.nota.trim()) return false;
  const ca = CantidadSchema.safeParse(leerCantidad(a.cantidad));
  const cb = CantidadSchema.safeParse(leerCantidad(b.cantidad));
  if (ca.success && cb.success) {
    if (ca.data !== cb.data) return false;
  } else if (a.cantidad.trim() !== b.cantidad.trim()) {
    return false;
  }
  return diasEquivalentes(a.dias, b.dias);
}

export function esCanalDeFormulario(valor: string): valor is '' | CanalEntregaType {
  return valor === '' || (CanalEntrega.options as readonly string[]).includes(valor);
}

function mensajeDe(
  resultado: { success: true } | { success: false; error: { issues: { message: string }[] } },
) {
  return resultado.success ? null : (resultado.error.issues[0]?.message ?? null);
}

function errorTipo(id: string, exigir: boolean): string | null {
  if (!exigir) return null;
  return mensajeDe(TipoDocumentoIdSchema.safeParse(id.trim() === '' ? undefined : id.trim()));
}

type NodoDias = FieldError & { root?: FieldError } & Record<number, FieldError | undefined>;

function nodoDeDias(mensaje: string | null, porIndice: (string | null)[]): NodoDias | undefined {
  const hayIndice = porIndice.some((mensajeDia) => mensajeDia !== null);
  if (mensaje === null && !hayIndice) return undefined;
  const nodo = {
    type: 'validate',
    ...(mensaje === null ? {} : { message: mensaje, root: { type: 'validate', message: mensaje } }),
  } as NodoDias;
  porIndice.forEach((mensajeDia, indice) => {
    if (mensajeDia !== null) nodo[indice] = { type: 'validate', message: mensajeDia };
  });
  return nodo;
}

/**
 * Valida el estado completo del formulario. Una lista con huecos no llega al schema: si se
 * omitieran los vacíos, shared podría aceptarla. `exigirTipo` es falso en la edición.
 */
export function validarRequisito(
  valores: RequisitoFormValues,
  exigirTipo: boolean,
):
  | { ok: true; datos: RequisitoNormalizado }
  | { ok: false; errores: FieldErrors<RequisitoFormValues> } {
  const errores: FieldErrors<RequisitoFormValues> = {};
  const tipo = errorTipo(valores.tipoDocumentoId, exigirTipo);
  const cantidad = mensajeDe(CantidadSchema.safeParse(leerCantidad(valores.cantidad)));
  const canal = mensajeDe(CanalPropioSchema.safeParse(valores.canal === '' ? null : valores.canal));
  const nota = mensajeDe(NotaSchema.safeParse(valores.nota));
  if (tipo !== null) errores.tipoDocumentoId = { type: 'validate', message: tipo };
  if (cantidad !== null) errores.cantidad = { type: 'validate', message: cantidad };
  if (canal !== null) errores.canal = { type: 'validate', message: canal };
  if (nota !== null) errores.nota = { type: 'validate', message: nota };

  const porIndice = valores.dias.map((dia) => mensajeDeDia(dia));
  const cantidadOk = CantidadSchema.safeParse(leerCantidad(valores.cantidad));
  const largoCoincide = cantidadOk.success && valores.dias.length === cantidadOk.data;
  if (largoCoincide && valores.dias.some((dia) => dia.trim() === '')) {
    valores.dias.forEach((dia, indice) => {
      if (dia.trim() === '') porIndice[indice] = MENSAJE_DIA_VACIO;
    });
  }
  const nodo = nodoDeDias(incompatibilidadDeDias(valores, true), porIndice);
  if (nodo !== undefined) errores.dias = nodo;
  if (Object.keys(errores).length > 0) return { ok: false, errores };

  const resultado = CreateRequisitoClienteSchema.safeParse({
    tipoDocumentoId: valores.tipoDocumentoId.trim(),
    cantidad: leerCantidad(valores.cantidad),
    diasAproximados: valores.dias.length === 0 ? [] : valores.dias.map((dia) => Number(dia.trim())),
    canalEntrega: valores.canal === '' ? null : valores.canal,
    nota: valores.nota,
  });
  if (!resultado.success) {
    for (const issue of resultado.error.issues) {
      const campo = issue.path[0];
      if (campo === 'diasAproximados') {
        errores.dias ??= { type: 'validate', message: issue.message };
      } else if (campo === 'tipoDocumentoId') {
        errores.tipoDocumentoId ??= { type: 'validate', message: issue.message };
      } else if (campo === 'cantidad') {
        errores.cantidad ??= { type: 'validate', message: issue.message };
      } else if (campo === 'canalEntrega') {
        errores.canal ??= { type: 'validate', message: issue.message };
      } else if (campo === 'nota') {
        errores.nota ??= { type: 'validate', message: issue.message };
      }
    }
    if (Object.keys(errores).length === 0) {
      errores.root = {
        type: 'validate',
        message: 'Revisá los datos.',
      } as NonNullable<FieldErrors<RequisitoFormValues>['root']>;
    }
    return { ok: false, errores };
  }

  return {
    ok: true,
    datos: {
      tipoDocumentoId: resultado.data.tipoDocumentoId,
      cantidad: resultado.data.cantidad,
      diasAproximados: resultado.data.diasAproximados,
      canalEntrega: resultado.data.canalEntrega,
      nota: resultado.data.nota,
    },
  };
}

export function resolverRequisito(
  exigirTipo: boolean,
): Resolver<RequisitoFormValues, unknown, RequisitoNormalizado> {
  return (valores) => {
    const resultado = validarRequisito(valores, exigirTipo);
    if (resultado.ok) return { values: resultado.datos, errors: {} };
    return { values: {}, errors: resultado.errores };
  };
}

/** PATCH con solo lo que cambió respecto de lo guardado. `{}` si no hay nada que enviar. */
export function cambiosDeRequisito(
  datos: RequisitoNormalizado,
  requisito: RequisitoCliente,
): CambiosRequisito {
  const ordenar = (dias: readonly number[]) => [...dias].sort((a, b) => a - b);
  const guardados = ordenar(requisito.diasAproximados);
  const enviados = ordenar(datos.diasAproximados);
  const mismosDias =
    enviados.length === guardados.length &&
    enviados.every((dia, indice) => dia === guardados[indice]);
  return {
    ...(datos.cantidad !== requisito.cantidad ? { cantidad: datos.cantidad } : {}),
    ...(!mismosDias ? { diasAproximados: datos.diasAproximados } : {}),
    ...(datos.canalEntrega !== requisito.canalEntrega ? { canalEntrega: datos.canalEntrega } : {}),
    ...(datos.nota !== requisito.nota ? { nota: datos.nota } : {}),
  };
}

export const hayCambios = (cambios: CambiosRequisito) => Object.keys(cambios).length > 0;

export function cuerpoDeAlta(datos: RequisitoNormalizado): NuevoRequisito {
  return {
    tipoDocumentoId: datos.tipoDocumentoId,
    cantidad: datos.cantidad,
    diasAproximados: datos.diasAproximados,
    canalEntrega: datos.canalEntrega,
    nota: datos.nota,
  };
}
