// Política para una contraseña NUEVA (ADR-0006 §2). Se aplica antes de calcular el hash, al elegir
// o cambiar una contraseña; nunca al verificar una existente (las contraseñas temporales que genera
// el sistema y las anteriores a un cambio de política siguen verificando).
//
// Reglas, en orden:
// 1. Caracteres y largo: `ContrasenaNuevaSchema` de shared, la misma que usa el frontend. El largo
//    mínimo es de 8 (P5, decidido por el usuario; la propuesta técnica era 15).
// 2. Previsible, con un solo mensaje que no dice qué regla falló. Como pide NIST SP 800-63B-4, se
//    compara la contraseña ENTERA, nunca fragmentos: una frase que contiene un nombre es válida.
//    - Lista de contraseñas comunes (`listaDeContrasenasComunes.ts`, sin servicios externos).
//    - Contexto: la contraseña, reducida a sus letras, es una palabra del contexto o un derivado
//      trivial de ella (ver `palabrasDelContexto` y `esDerivadoDelContexto`).
//    - Repetición trivial: toda la contraseña es una unidad de 1 a 4 caracteres repetida.
//    Todas comparan en minúsculas y después de NFC, como el hash. No hay reglas de composición.
//
// Nada de este módulo registra ni devuelve la contraseña.

import {
  ContrasenaNuevaSchema,
  MENSAJE_CONTRASENA_CARACTERES,
  MENSAJE_CONTRASENA_CORTA,
  MENSAJE_CONTRASENA_LARGA,
  MENSAJE_CONTRASENA_PREVISIBLE,
} from '@realpolitik/shared';

import { CONTRASENAS_COMUNES } from './listaDeContrasenasComunes';

const COMUNES = new Set(CONTRASENAS_COMUNES);

/** Nombres del servicio, ya reducidos a letras. */
const NOMBRES_DEL_SERVICIO = ['realpolitik', 'realpolitikmanager'];

/** Una parte del nombre o del email más corta que esto no se considera una palabra (p. ej. "de"). */
const LARGO_MINIMO_DE_PALABRA = 2;

/**
 * Unidad más larga que se considera una repetición trivial (`zzzz…`, `1212…`, `abcabc…`,
 * `1234 1234 …`). Las repeticiones de unidades más largas (`passwordpassword`) las cubre la lista.
 */
const UNIDAD_MAXIMA_DE_REPETICION = 4;

/** Datos de la persona con los que se compara la contraseña. */
export interface ContextoDeContrasena {
  email?: string | null;
  nombre?: string | null;
}

export type MotivoDeRechazo = 'CARACTERES_INVALIDOS' | 'MUY_CORTA' | 'MUY_LARGA' | 'PREVISIBLE';

/** Qué regla de "previsible" se aplicó. Solo para tests y diagnóstico: nunca llega a la persona. */
export type ReglaPrevisible = 'LISTA_COMUN' | 'CONTEXTO' | 'REPETICION_TRIVIAL';

export type ResultadoDePolitica =
  | { aceptada: true }
  | { aceptada: false; motivo: Exclude<MotivoDeRechazo, 'PREVISIBLE'>; mensaje: string }
  | { aceptada: false; motivo: 'PREVISIBLE'; regla: ReglaPrevisible; mensaje: string };

const MOTIVO_POR_MENSAJE: Record<string, Exclude<MotivoDeRechazo, 'PREVISIBLE'>> = {
  [MENSAJE_CONTRASENA_CARACTERES]: 'CARACTERES_INVALIDOS',
  [MENSAJE_CONTRASENA_CORTA]: 'MUY_CORTA',
  [MENSAJE_CONTRASENA_LARGA]: 'MUY_LARGA',
};

function comparable(texto: string): string {
  return texto.normalize('NFC').toLowerCase();
}

/** Solo las letras (y sus marcas, como la tilde descompuesta), en minúsculas y NFC. */
function soloLetras(texto: string): string {
  return comparable(texto).replace(/[^\p{L}\p{M}]+/gu, '');
}

/** Partes de un texto separadas por lo que no es una letra, reducidas a letras. */
function partes(texto: string): string[] {
  return comparable(texto)
    .split(/[^\p{L}\p{M}]+/u)
    .filter((parte) => [...parte].length >= LARGO_MINIMO_DE_PALABRA);
}

/**
 * Palabras del contexto, reducidas a letras:
 * - los nombres del servicio;
 * - la parte local del email entera ("mariana.gomez" → "marianagomez") y cada una de sus partes;
 * - el nombre completo en su orden y al revés ("Mariana Gómez" → "marianagómez", "gómezmariana")
 *   y cada una de sus partes.
 */
export function palabrasDelContexto({ email, nombre }: ContextoDeContrasena): Set<string> {
  const palabras = new Set(NOMBRES_DEL_SERVICIO);
  if (email) {
    const local = comparable(email).split('@')[0] ?? '';
    for (const palabra of [soloLetras(local), ...partes(local)]) palabras.add(palabra);
  }
  if (nombre) {
    const delNombre = partes(nombre);
    palabras.add(delNombre.join(''));
    palabras.add([...delNombre].reverse().join(''));
    for (const palabra of delNombre) palabras.add(palabra);
  }
  palabras.delete('');
  return palabras;
}

/**
 * Derivados triviales, comparando la contraseña entera reducida a sus letras:
 * 1. es una palabra del contexto: la palabra con números, símbolos o espacios en cualquier lugar
 *    ("Mariana2026!!!!" sí; "realpolitik 2026 ok?" no, porque tiene otras letras);
 * 2. es una palabra del contexto repetida ("marianamariana1").
 * No se prueban sustituciones del tipo "m4r14n4" ni combinaciones: la lista sería difícil de
 * justificar y produciría falsos positivos.
 */
export function esDerivadoDelContexto(contrasena: string, contexto: ContextoDeContrasena): boolean {
  const letras = soloLetras(contrasena);
  if (letras === '') return false;
  for (const palabra of palabrasDelContexto(contexto)) {
    if (letras === palabra) return true;
    if (
      letras.length % palabra.length === 0 &&
      letras === palabra.repeat(letras.length / palabra.length)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Toda la contraseña (en minúsculas y NFC) es una unidad de 1 a 4 caracteres repetida, aunque la
 * última repetición quede incompleta: "zzzzzzzzzzzzzzz", "919191919191919", "abcabcabcabcabc".
 */
export function esRepeticionTrivial(contrasena: string): boolean {
  const puntos = [...comparable(contrasena)];
  for (
    let largo = 1;
    largo <= UNIDAD_MAXIMA_DE_REPETICION && largo * 2 <= puntos.length;
    largo += 1
  ) {
    if (puntos.every((punto, i) => punto === puntos[i % largo])) return true;
  }
  return false;
}

function reglaPrevisible(
  contrasena: string,
  contexto: ContextoDeContrasena,
): ReglaPrevisible | null {
  if (COMUNES.has(comparable(contrasena))) return 'LISTA_COMUN';
  if (esDerivadoDelContexto(contrasena, contexto)) return 'CONTEXTO';
  if (esRepeticionTrivial(contrasena)) return 'REPETICION_TRIVIAL';
  return null;
}

/**
 * Evalúa una contraseña nueva. No lanza: devuelve si se acepta y, si no, el motivo y el mensaje
 * para la persona (los de shared). La contraseña no se modifica ni se recorta.
 */
export function evaluarContrasenaNueva(
  contrasena: string,
  contexto: ContextoDeContrasena = {},
): ResultadoDePolitica {
  const formato = ContrasenaNuevaSchema.safeParse(contrasena);
  if (!formato.success) {
    const mensaje = formato.error.issues[0]?.message ?? MENSAJE_CONTRASENA_CARACTERES;
    return {
      aceptada: false,
      motivo: MOTIVO_POR_MENSAJE[mensaje] ?? 'CARACTERES_INVALIDOS',
      mensaje,
    };
  }
  const regla = reglaPrevisible(contrasena, contexto);
  if (regla !== null) {
    return { aceptada: false, motivo: 'PREVISIBLE', regla, mensaje: MENSAJE_CONTRASENA_PREVISIBLE };
  }
  return { aceptada: true };
}
