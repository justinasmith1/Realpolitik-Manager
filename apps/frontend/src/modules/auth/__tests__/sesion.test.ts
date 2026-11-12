import { QueryClient } from '@tanstack/react-query';

import {
  CLAVE_SESION,
  destinoDespuesDeEntrar,
  establecerSesion,
  terminarSesion,
  urlDeCambioDeContrasena,
  urlDeLogin,
  volverAValido,
} from '@/modules/auth/sesion';
import { sesionDePrueba } from '@/modules/auth/test/sesionDePrueba';

describe('volverA: solo rutas internas (sin redirecciones abiertas)', () => {
  it.each(['/rendiciones', '/rendiciones?mes=2026-10&estado=ABIERTA', '/clientes/1/matriz'])(
    'acepta %s',
    (ruta) => {
      expect(volverAValido(ruta)).toBe(ruta);
    },
  );

  it.each([
    null,
    undefined,
    '',
    'rendiciones',
    'https://malo.example/',
    '//malo.example/',
    '/\\malo.example/',
    '/\t/malo.example',
    'javascript:alert(1)',
    '/login',
    '/login?volverA=/x',
    '/login/otra',
    '/cambiar-contrasena',
    '/cambiar-contrasena?volverA=/x',
  ])('ignora %s', (valor) => {
    expect(volverAValido(valor)).toBeNull();
    expect(destinoDespuesDeEntrar(valor)).toBe('/rendiciones');
  });
});

describe('estado de sesión en la caché', () => {
  it('terminar la sesión deja "no autenticado", descarta los datos y recuerda el motivo', () => {
    const queryClient = new QueryClient();
    establecerSesion(queryClient, sesionDePrueba());
    queryClient.setQueryData(['clientes'], [{ id: 1 }]);

    terminarSesion(queryClient, 'vencida');

    expect(queryClient.getQueryData(CLAVE_SESION)).toBeNull();
    expect(queryClient.getQueryData(['clientes'])).toBeUndefined();
    expect(urlDeLogin(queryClient, '/clientes?x=1')).toBe(
      '/login?motivo=vencida&volverA=%2Fclientes%3Fx%3D1',
    );
  });

  it('entrar de nuevo borra el motivo anterior', () => {
    const queryClient = new QueryClient();
    terminarSesion(queryClient, 'cerrada');
    establecerSesion(queryClient, sesionDePrueba());
    terminarSesion(queryClient);

    expect(urlDeLogin(queryClient, null)).toBe('/login');
  });

  it('las URLs de acceso no llevan un volverA inválido ni el de la pantalla de entrada', () => {
    const queryClient = new QueryClient();
    expect(urlDeLogin(queryClient, '//malo.example')).toBe('/login');
    expect(urlDeLogin(queryClient, '/rendiciones')).toBe('/login');
    expect(urlDeCambioDeContrasena('https://malo.example')).toBe('/cambiar-contrasena');
    expect(urlDeCambioDeContrasena('/clientes')).toBe('/cambiar-contrasena?volverA=%2Fclientes');
  });
});
