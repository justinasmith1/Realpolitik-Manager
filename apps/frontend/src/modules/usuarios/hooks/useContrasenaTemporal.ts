// Alta y restablecimiento: las dos escrituras cuya respuesta trae una contraseña temporal.
//
// No usan `useMutation` a propósito. Una mutation guarda su resultado (`data`) en la
// MutationCache, a la vista de `useMutationState` y hasta que se recolecta, aunque el diálogo que
// mostró la contraseña ya se haya cerrado. Acá la respuesta va directo a quien la pidió y TanStack
// Query solo se usa para invalidar el listado. Lo demás se hace igual que en una mutation de la
// app: sin reintentos y con el manejo global de sesión y acceso (401, 403).

import type { ContrasenaRestablecida, CrearUsuarioDto, UsuarioCreado } from '@realpolitik/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { manejarErrorGlobal } from '@/modules/auth/manejoGlobal';
import {
  crearUsuario,
  hayQueReleerElListado,
  interpretarFalloDeUsuario,
  restablecerContrasena,
  usuariosQueryKey,
  type FalloDeUsuario,
} from '@/modules/usuarios/api/usuarios.api';

/** Cómo terminó el envío: la respuesta del servidor, o por qué falló. */
export type ResultadoDeEnvio<T> = { ok: true; respuesta: T } | { ok: false; fallo: FalloDeUsuario };

function useEnvioConContrasena<A, T>(enviar: (argumento: A) => Promise<T>) {
  const queryClient = useQueryClient();
  const [enviando, setEnviando] = useState(false);
  // La ref corta un segundo envío en el mismo instante, antes de que `enviando` llegue al render.
  const enCurso = useRef(false);

  async function ejecutar(argumento: A): Promise<ResultadoDeEnvio<T> | null> {
    if (enCurso.current) return null;
    enCurso.current = true;
    setEnviando(true);
    const refrescar = () => void queryClient.invalidateQueries({ queryKey: usuariosQueryKey });
    try {
      const respuesta = await enviar(argumento);
      refrescar();
      return { ok: true, respuesta };
    } catch (error) {
      manejarErrorGlobal(queryClient, error, { origen: 'envio' });
      const fallo = interpretarFalloDeUsuario(error);
      if (hayQueReleerElListado(fallo)) refrescar();
      return { ok: false, fallo };
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return { ejecutar, enviando };
}

/** `POST /usuarios`. Devuelve `null` si ya hay un alta en curso (no se envía otra). */
export function useCrearUsuario() {
  const { ejecutar, enviando } = useEnvioConContrasena<CrearUsuarioDto, UsuarioCreado>(
    crearUsuario,
  );
  return { crear: ejecutar, creando: enviando };
}

/** `POST /usuarios/:id/restablecer-password`. `null` si ya hay uno en curso. */
export function useRestablecerContrasena() {
  const { ejecutar, enviando } = useEnvioConContrasena<string, ContrasenaRestablecida>(
    restablecerContrasena,
  );
  return { restablecer: ejecutar, restableciendo: enviando };
}
