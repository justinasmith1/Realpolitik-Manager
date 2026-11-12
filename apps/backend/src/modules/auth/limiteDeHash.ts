// Cuántos cálculos de argon2id corren a la vez (ADR-0006 §2).
//
// Cada cálculo reserva ~19 MiB (PARAMETROS_ARGON2) y ocupa un hilo del threadpool de libuv, que por
// defecto tiene 4 y comparte con el sistema de archivos, el DNS y el resto de `crypto`. Medido en
// desarrollo (Node 22, Windows, 12 CPU lógicas): 2 cálculos simultáneos suman ~19 MiB de pico sobre
// el primero y tardan lo mismo que uno (~28 ms); 8 simultáneos solo corren de a 4, suman ~57 MiB y
// tardan ~120 ms. Sin límite, un pico de inicios de sesión ocuparía los 4 hilos y frenaría todo lo
// demás. La memoria y las CPU reales de Railway no están medidas: se ajustan con el primer
// despliegue del núcleo (ADR-0006 §2).
//
// Con 2 a la vez y 8 en espera, el peor caso son ~40 MiB de argon2 y una espera de unos 4 turnos.
// Más allá, `CapacidadAgotadaError`: el inicio de sesión responderá 503 con Retry-After (se define
// con los endpoints), que no es lo mismo que credenciales incorrectas.

import { LimitadorDeConcurrencia } from '../../lib/limitadorDeConcurrencia';

export const MAXIMO_HASHES_SIMULTANEOS = 2;
export const MAXIMO_HASHES_EN_ESPERA = 8;

/**
 * Límite compartido por todo el proceso para `hashearContrasena` y `verificarContrasena`:
 * `limiteDeHash.ejecutar(() => verificarContrasena(hash, contrasena))`.
 */
export const limiteDeHash = new LimitadorDeConcurrencia({
  maximoSimultaneas: MAXIMO_HASHES_SIMULTANEOS,
  maximoEnEspera: MAXIMO_HASHES_EN_ESPERA,
});
