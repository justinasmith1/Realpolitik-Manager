// Reglas temporales de una sesión (ADR-0006 §1), como funciones puras.
//
// Reciben el instante actual (`ahora`) en lugar de leer el reloj: así son deterministas y se
// prueban los bordes exactos, como `esAtrasada` (ADR-0005). El servicio de sesiones (Backend 2)
// les pasa su reloj inyectado.
//
// Usan los campos del modelo `Sesion` (createdAt, ultimaActividadEn, expiraEn, revocadaEn). Las
// fechas son instantes absolutos (milisegundos desde la época, UTC): 24 horas son 86 400 000 ms,
// no "el mismo horario del día siguiente", y no dependen de la zona horaria ni de los cambios de
// horario de verano.
//
// No consultan ni escriben la base.

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

export interface DuracionesDeSesion {
  /** Sin actividad durante este tiempo, la sesión vence. */
  inactividadMs: number;
  /** Desde el inicio, la sesión vence pase lo que pase (`expiraEn`). */
  absolutaMs: number;
}

/**
 * Duraciones por defecto: única fuente de verdad. **Propuesta funcional pendiente de aprobación
 * (P2)**: 24 horas de inactividad y 7 días de duración máxima. Cuando se confirmen (o se lleven a
 * variables de entorno), se cambian acá o se pasan como parámetro; el modelo no cambia.
 */
export const DURACIONES_DE_SESION: Readonly<DuracionesDeSesion> = Object.freeze({
  inactividadMs: 24 * HORA,
  absolutaMs: 7 * DIA,
});

/**
 * Como mucho una escritura de actividad por minuto por sesión (ADR-0006 §1). La consulta del
 * servicio usa la misma comparación estricta: `ultimaActividadEn < ahora − 60 s`.
 */
export const INTERVALO_MINIMO_DE_ACTIVIDAD_MS = MINUTO;

/**
 * Cuánto se conservan las sesiones revocadas o vencidas antes de borrarlas (de forma oportunista,
 * al crear otra sesión del mismo usuario). Mientras existen, una cookie vieja se reconoce como
 * vencida y no como desconocida.
 */
export const RETENCION_DE_SESIONES_CERRADAS_MS = 7 * DIA;

export type EstadoDeSesion =
  'VIGENTE' | 'REVOCADA' | 'VENCIDA_POR_DURACION' | 'VENCIDA_POR_INACTIVIDAD';

/** Los campos de `Sesion` que deciden su vigencia. */
export interface TiemposDeSesion {
  createdAt: Date;
  ultimaActividadEn: Date;
  expiraEn: Date;
  revocadaEn: Date | null;
}

function instante(fecha: Date, nombre: string): number {
  const ms = fecha.getTime();
  if (!Number.isFinite(ms)) throw new RangeError(`${nombre} no es una fecha válida.`);
  return ms;
}

function validarDuraciones({ inactividadMs, absolutaMs }: DuracionesDeSesion): void {
  for (const [nombre, valor] of [
    ['inactividadMs', inactividadMs],
    ['absolutaMs', absolutaMs],
  ] as const) {
    if (!Number.isSafeInteger(valor) || valor <= 0) {
      throw new RangeError(
        `${nombre} tiene que ser una cantidad entera y positiva de milisegundos.`,
      );
    }
  }
}

/**
 * Fechas de una sesión nueva, todas a partir del mismo `ahora`: así se cumple el CHECK
 * `ck_sesion_fechas_coherentes` (`expiraEn > createdAt`, actividad no anterior al inicio). El
 * servicio las escribe explícitamente; no deja que la base complete `createdAt` con su propio reloj.
 */
export function fechasDeSesionNueva(
  ahora: Date,
  duraciones: DuracionesDeSesion = DURACIONES_DE_SESION,
): Pick<TiemposDeSesion, 'createdAt' | 'ultimaActividadEn' | 'expiraEn'> {
  validarDuraciones(duraciones);
  const inicio = instante(ahora, 'ahora');
  return {
    createdAt: new Date(inicio),
    ultimaActividadEn: new Date(inicio),
    expiraEn: new Date(inicio + duraciones.absolutaMs),
  };
}

/**
 * Estado de una sesión en `ahora`, en este orden:
 * 1. `REVOCADA` si tiene `revocadaEn` (una revocación no se deshace).
 * 2. `VENCIDA_POR_DURACION` si `ahora >= expiraEn`. Usa el `expiraEn` guardado: cambiar la duración
 *    absoluta no alarga ni acorta las sesiones ya creadas.
 * 3. `VENCIDA_POR_INACTIVIDAD` si `ahora >= ultimaActividadEn + inactividad`. Se calcula con la
 *    duración vigente, que no se guarda.
 * 4. Si no, `VIGENTE`.
 *
 * En el instante exacto del límite la sesión ya venció. Si `ultimaActividadEn` quedara en el futuro
 * (un reloj que retrocede), la sesión sigue vigente hasta que se cumpla el plazo desde esa fecha.
 */
export function evaluarSesion(
  sesion: TiemposDeSesion,
  ahora: Date,
  duraciones: DuracionesDeSesion = DURACIONES_DE_SESION,
): EstadoDeSesion {
  validarDuraciones(duraciones);
  const actual = instante(ahora, 'ahora');
  if (sesion.revocadaEn !== null) return 'REVOCADA';
  if (actual >= instante(sesion.expiraEn, 'expiraEn')) return 'VENCIDA_POR_DURACION';
  const ultima = instante(sesion.ultimaActividadEn, 'ultimaActividadEn');
  if (actual >= ultima + duraciones.inactividadMs) return 'VENCIDA_POR_INACTIVIDAD';
  return 'VIGENTE';
}

/**
 * Si corresponde registrar actividad: pasó estrictamente más de un minuto desde la última. Evita
 * una escritura por pedido. Con un reloj que retrocede, no registra.
 */
export function debeRegistrarActividad(
  sesion: Pick<TiemposDeSesion, 'ultimaActividadEn'>,
  ahora: Date,
): boolean {
  return (
    instante(ahora, 'ahora') - instante(sesion.ultimaActividadEn, 'ultimaActividadEn') >
    INTERVALO_MINIMO_DE_ACTIVIDAD_MS
  );
}

/**
 * Umbrales para registrar actividad en UNA escritura condicional (sin leer y después escribir):
 * `UPDATE … WHERE revocadaEn IS NULL AND expiraEn > ahora AND ultimaActividadEn > vigenteDesde
 * AND ultimaActividadEn < registrarSiAnteriorA`. Son las mismas comparaciones que `evaluarSesion` y
 * `debeRegistrarActividad`, expresadas sobre `ultimaActividadEn`:
 * - `registrarSiAnteriorA` (ahora − 1 min): como mucho una escritura por minuto, y una escritura
 *   tardía nunca pisa una fecha más reciente;
 * - `vigenteDesde` (ahora − inactividad): una sesión ya vencida por inactividad no revive.
 */
export function umbralesDeActividad(
  ahora: Date,
  duraciones: DuracionesDeSesion = DURACIONES_DE_SESION,
): { registrarSiAnteriorA: Date; vigenteDesde: Date } {
  validarDuraciones(duraciones);
  const actual = instante(ahora, 'ahora');
  return {
    registrarSiAnteriorA: new Date(actual - INTERVALO_MINIMO_DE_ACTIVIDAD_MS),
    vigenteDesde: new Date(actual - duraciones.inactividadMs),
  };
}
