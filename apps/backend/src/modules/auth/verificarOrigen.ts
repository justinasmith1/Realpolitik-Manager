// Protección CSRF por origen (ADR-0006 §4), segunda barrera después de `SameSite=Strict`.
//
// En los métodos que escriben (POST, PUT, PATCH, DELETE), el pedido tiene que traer `Origin` y ser
// EXACTAMENTE uno de los orígenes permitidos (los mismos de `CORS_ORIGINS`: el frontend). Se
// rechaza, con `403 ORIGEN_NO_PERMITIDO`:
// - sin `Origin`: todos los navegadores soportados lo envían en un POST, también del mismo origen;
//   un cliente que no lo manda no es un navegador (y no puede ser víctima de CSRF), así que no
//   pierde nada útil;
// - `Origin: null` (documentos sandbox, `file://`, algunas redirecciones);
// - cualquier otro origen, sin coincidencias parciales: `https://app.example.evil.com` no es
//   `https://app.example`;
// - `Sec-Fetch-Site: cross-site`, como defensa adicional cuando el navegador lo informa.
//
// `Referer` no se usa como respaldo: el frontend envía `Referrer-Policy: no-referrer`, y aceptar un
// Referer cuando falta Origin solo agregaría un camino más. `Host` y `X-Forwarded-Host` tampoco: los
// controla quien hace el pedido o el proxy, no prueban de dónde salió.
//
// Se aplica a TODA la API, no solo a `/auth`: `createApp` lo monta global, antes de leer cualquier
// cuerpo, así que toda escritura de negocio (y también login, logout y cambio de contraseña) exige
// un `Origin` permitido. No es redundante con la sesión: es lo que frena un pedido de otro sitio
// que viaja con la cookie del navegador.

import type { RequestHandler } from 'express';

import { forbidden } from '../../errors/app-error';

import { registrarEventoDeAuth } from './registroDeEventos';

const METODOS_SIN_EFECTOS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const MENSAJE_ORIGEN_NO_PERMITIDO = 'Origen no permitido.';

export function verificarOrigen(origenesPermitidos: readonly string[]): RequestHandler {
  const permitidos = new Set(origenesPermitidos);
  return (req, _res, next) => {
    if (METODOS_SIN_EFECTOS.has(req.method)) {
      next();
      return;
    }
    const origen = req.get('origin');
    const sitio = req.get('sec-fetch-site');
    if (origen === undefined || !permitidos.has(origen) || sitio === 'cross-site') {
      registrarEventoDeAuth('auth.origen_rechazado', { ip: req.ip });
      next(forbidden('ORIGEN_NO_PERMITIDO', MENSAJE_ORIGEN_NO_PERMITIDO));
      return;
    }
    next();
  };
}
