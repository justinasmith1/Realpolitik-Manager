// Cookie de sesión (ADR-0006 §4): la única cookie del sistema.
//
// `__Host-rp_sesion` con `Path=/; Secure; HttpOnly; SameSite=Strict`, sin `Domain`:
// - `__Host-` obliga al navegador a exigir `Secure`, `Path=/` y ningún `Domain`: un subdominio no
//   puede pisarla;
// - `HttpOnly`: JavaScript no la lee;
// - `SameSite=Strict`: no viaja en pedidos que empiezan en otro sitio.
//
// Sin `Max-Age` ni `Expires`: es una cookie de sesión del navegador. La vigencia real (24 h de
// inactividad y 7 días, propuestas P2) la decide el servidor con `expiraEn` y la última actividad,
// así que la cookie nunca alarga una sesión. Si P16 pide que sobreviva al cierre del navegador, se
// agrega `Max-Age` igual al tiempo restante hasta `expiraEn`.
//
// Los mismos atributos en desarrollo: los navegadores tratan `http://localhost` como un contexto
// seguro y aceptan `Secure` y `__Host-` ahí. Verificado con Edge (Chromium) sin interfaz contra el
// proxy de Vite; Firefox no se probó. No hay una variante sin `Secure`.

import type { CookieOptions, Request, Response } from 'express';

export const NOMBRE_COOKIE_DE_SESION = '__Host-rp_sesion';

const ATRIBUTOS: Readonly<CookieOptions> = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
});

/**
 * El token de la cookie de sesión del pedido, o `undefined`. Si llegaran varias cookies con ese
 * nombre (no debería: `__Host-` lo impide), se usa la primera. El valor no se valida acá: lo hace
 * el servicio de sesiones.
 */
export function leerTokenDeSesion(req: Request): string | undefined {
  const cabecera = req.headers.cookie;
  if (!cabecera) return undefined;
  for (const par of cabecera.split(';')) {
    const igual = par.indexOf('=');
    if (igual < 0 || par.slice(0, igual).trim() !== NOMBRE_COOKIE_DE_SESION) continue;
    try {
      return decodeURIComponent(par.slice(igual + 1).trim());
    } catch {
      return undefined; // codificación inválida: como si no hubiera cookie
    }
  }
  return undefined;
}

export function emitirCookieDeSesion(res: Response, token: string): void {
  res.cookie(NOMBRE_COOKIE_DE_SESION, token, ATRIBUTOS);
}

/** Borra la cookie con los mismos atributos con que se creó (si no coinciden, el navegador la conserva). */
export function borrarCookieDeSesion(res: Response): void {
  res.clearCookie(NOMBRE_COOKIE_DE_SESION, ATRIBUTOS);
}
