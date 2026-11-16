// Utilidades compartidas por los tests de la pantalla de usuarios: un servidor de mentira que
// responde el contrato de `/usuarios` (filtros incluidos) y la página montada en su ruta, con una
// sesión de ADMINISTRADOR. Datos ficticios.

import type { RolUsuarioType } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { sembrarSesion } from '@/modules/auth/test/sesionDePrueba';
import { UsuariosPage } from '@/modules/usuarios/pages/UsuariosPage';

export const BASE = 'https://api.example';
export const ID_PROPIO = '0000a000-0000-4000-8000-0000000000aa';
export const TEMPORAL = 'VGVtcG9yYWwtZGUtcHJ1ZWJhLTMyLWNhcmFj';

/** Una cuenta como la devuelve la API. */
export interface UsuarioJson {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuarioType;
  activo: boolean;
  debeCambiarPassword: boolean;
  ultimoAccesoEn: string | null;
}

const cuenta = (n: number, datos: Partial<UsuarioJson>): UsuarioJson => ({
  id: `0b0b0b0b-0000-4000-8000-00000000000${n}`,
  nombre: `Persona ${n}`,
  email: `persona${n}@ejemplo.example`,
  rol: 'ADMINISTRATIVO',
  activo: true,
  debeCambiarPassword: false,
  ultimoAccesoEn: '2026-11-10T13:00:00.000Z',
  ...datos,
});

export const yo: UsuarioJson = {
  ...cuenta(0, { nombre: 'Ana Admin', email: 'ana@ejemplo.example', rol: 'ADMINISTRADOR' }),
  id: ID_PROPIO,
};
export const bruno = cuenta(1, {
  nombre: 'Bruno Díaz',
  email: 'bruno.con.un.email.muy.largo.para.probar@subdominio.ejemplo.example',
  rol: 'ADMINISTRATIVO',
});
export const carla = cuenta(2, {
  nombre: 'Carla Pérez',
  email: 'carla@ejemplo.example',
  rol: 'CONSULTA',
  debeCambiarPassword: true,
  ultimoAccesoEn: null,
});
export const dario = cuenta(3, {
  nombre: 'Darío Ruiz',
  email: 'dario@ejemplo.example',
  rol: 'CONSULTA',
  activo: false,
});

export const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const errorJson = (status: number, code: string, details?: unknown) =>
  json({ error: { code, message: 'mensaje interno que no se muestra', details } }, status);

export const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

type Respuesta = () => Response | Promise<Response>;

/**
 * El servidor: `cuentas` es la base. `GET /usuarios` filtra como el backend (búsqueda en nombre y
 * email sin mayúsculas, rol, activas salvo `incluirDesactivados=true`). Las escrituras responden lo
 * forzado en `forzadas` (`MÉTODO /ruta`) o, si no hay, el éxito del contrato aplicado a `cuentas`.
 */
export function crearServidor(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  const servidor = {
    cuentas: [yo, bruno, carla, dario],
    forzadas: new Map<string, Respuesta>(),
  };

  const buscar = (id: string) => servidor.cuentas.find((c) => c.id === id);
  const reemplazar = (actualizada: UsuarioJson) => {
    servidor.cuentas = servidor.cuentas.map((c) => (c.id === actualizada.id ? actualizada : c));
    return actualizada;
  };

  fetchMock.mockImplementation((entrada, init) => {
    const url = new URL(urlDe(entrada));
    const metodo = init?.method ?? 'GET';
    const forzada = servidor.forzadas.get(`${metodo} ${url.pathname}`);
    if (forzada) return Promise.resolve(forzada());
    const cuerpo = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    const [, , id, accion] = url.pathname.split('/');

    if (metodo === 'GET' && url.pathname === '/usuarios') {
      const q = url.searchParams.get('q')?.toLowerCase();
      const rol = url.searchParams.get('rol');
      const todas = url.searchParams.get('incluirDesactivados') === 'true';
      return Promise.resolve(
        json(
          servidor.cuentas.filter(
            (c) =>
              (todas || c.activo) &&
              (rol === null || c.rol === rol) &&
              (q === undefined ||
                c.nombre.toLowerCase().includes(q) ||
                c.email.toLowerCase().includes(q)),
          ),
        ),
      );
    }
    if (metodo === 'POST' && url.pathname === '/usuarios') {
      const nueva: UsuarioJson = {
        id: '0b0b0b0b-0000-4000-8000-0000000000ff',
        nombre: String(cuerpo.nombre),
        email: String(cuerpo.email),
        rol: cuerpo.rol as RolUsuarioType,
        activo: true,
        debeCambiarPassword: true,
        ultimoAccesoEn: null,
      };
      servidor.cuentas = [...servidor.cuentas, nueva];
      return Promise.resolve(json({ usuario: nueva, contrasenaTemporal: TEMPORAL }, 201));
    }
    const existente = id === undefined ? undefined : buscar(id);
    if (existente === undefined) {
      return Promise.resolve(errorJson(404, 'NOT_FOUND'));
    }
    if (metodo === 'PATCH' && accion === undefined) {
      const modificados = (['nombre', 'rol'] as const).filter(
        (campo) => campo in cuerpo && cuerpo[campo] !== existente[campo],
      );
      const usuario = reemplazar({ ...existente, ...cuerpo });
      return Promise.resolve(
        json({ usuario, modificados, sesionesRevocadas: modificados.includes('rol') ? 1 : 0 }),
      );
    }
    if (metodo === 'PATCH' && accion === 'estado') {
      const cambio = existente.activo !== cuerpo.activo;
      const usuario = reemplazar({ ...existente, activo: cuerpo.activo === true });
      return Promise.resolve(json({ usuario, cambio, sesionesRevocadas: cambio ? 1 : 0 }));
    }
    if (metodo === 'POST' && accion === 'restablecer-password') {
      const usuario = reemplazar({ ...existente, debeCambiarPassword: true });
      return Promise.resolve(json({ usuario, contrasenaTemporal: TEMPORAL, sesionesRevocadas: 1 }));
    }
    return Promise.resolve(errorJson(404, 'NOT_FOUND'));
  });

  return servidor;
}

/** Los pedidos hechos, como `MÉTODO /ruta?query`. */
export const pedidosDe = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) =>
  fetchMock.mock.calls.map(([entrada, init]) => {
    const url = new URL(urlDe(entrada));
    return `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
  });

/** La página en `/usuarios`, con la sesión de `yo` (ADMINISTRADOR). */
export function renderUsuarios(url = '/usuarios') {
  const queryClient = sembrarSesion(
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    { id: ID_PROPIO, nombre: yo.nombre, email: yo.email, rol: 'ADMINISTRADOR' },
  );
  const router = createMemoryRouter([{ path: '/usuarios', element: <UsuariosPage /> }], {
    initialEntries: [url],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient, user: userEvent.setup() };
}
