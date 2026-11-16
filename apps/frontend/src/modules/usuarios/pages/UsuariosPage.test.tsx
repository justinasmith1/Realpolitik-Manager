import { act, screen, waitFor, within } from '@testing-library/react';

import { USUARIOS_COMPACTO_QUERY } from '@/modules/usuarios/components/UsuariosListado';
import { RETARDO_BUSQUEDA_MS } from '@/modules/usuarios/hooks/useFiltrosUsuarios';
import {
  bruno,
  carla,
  crearServidor,
  dario,
  errorJson,
  json,
  pedidosDe,
  renderUsuarios,
  yo,
} from '@/modules/usuarios/test/servidorDeUsuarios';
import { elegirOpcion } from '@/test/select';

const fetchMock = vi.fn<typeof fetch>();
const pedidos = () => pedidosDe(fetchMock);
const tabla = () => screen.getByRole('table', { name: 'Usuarios' });
const nombresEnTabla = () =>
  within(tabla())
    .getAllByRole('rowheader')
    .map((celda) => celda.querySelector('button')?.textContent);
const filaDe = (nombre: string) => screen.getByRole('row', { name: new RegExp(`^${nombre}`) });

function simularPantallaAngosta() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
    matches: query === USUARIOS_COMPACTO_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

describe('UsuariosPage: encabezado y listado', () => {
  it('un h1 "Usuarios", su descripción y "Nuevo usuario"', async () => {
    crearServidor(fetchMock);
    renderUsuarios();
    expect(screen.getByRole('heading', { level: 1, name: 'Usuarios' })).toBeInTheDocument();
    expect(
      screen.getByText('Administrá las cuentas y los permisos de acceso al sistema.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo usuario' })).toBeInTheDocument();
    await screen.findByRole('table', { name: 'Usuarios' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('mientras carga muestra el esqueleto y lo anuncia; después, solo las activas en el orden de la API', async () => {
    crearServidor(fetchMock);
    renderUsuarios();
    expect(screen.getByText('Cargando usuarios…')).toHaveAttribute('role', 'status');

    await screen.findByRole('table', { name: 'Usuarios' });
    expect(pedidos()).toEqual(['GET /usuarios']);
    expect(nombresEnTabla()).toEqual([yo.nombre, bruno.nombre, carla.nombre]);
    expect(screen.getByText('3 usuarios')).toBeInTheDocument();
  });

  it('cada fila: nombre, email, rol legible, estado, cambio pendiente y último acceso', async () => {
    crearServidor(fetchMock);
    renderUsuarios();
    await screen.findByRole('table', { name: 'Usuarios' });

    const filaBruno = filaDe(bruno.nombre);
    expect(within(filaBruno).getByText(bruno.email)).toBeInTheDocument();
    expect(within(filaBruno).getByText('Administrativo')).toBeInTheDocument();
    expect(within(filaBruno).getByText('Activo')).toBeInTheDocument();
    expect(within(filaBruno).queryByText('Cambio pendiente')).not.toBeInTheDocument();
    expect(within(filaBruno).getByText('10 nov 2026')).toBeInTheDocument();

    // Activa y con el cambio pendiente: son dos datos distintos. Sin último acceso, no se inventa.
    const filaCarla = filaDe(carla.nombre);
    expect(within(filaCarla).getByText('Consulta')).toBeInTheDocument();
    expect(within(filaCarla).getByText('Activo')).toBeInTheDocument();
    expect(within(filaCarla).getByText('Cambio pendiente')).toBeInTheDocument();
    expect(within(filaCarla).getByText('Nunca ingresó')).toBeInTheDocument();
  });

  it('la cuenta propia se reconoce por el id, con "Tu cuenta"; solo esa fila lo dice', async () => {
    const servidor = crearServidor(fetchMock);
    // Otra cuenta con el mismo nombre que la sesión: no es la propia.
    servidor.cuentas = [
      ...servidor.cuentas,
      { ...bruno, id: '0b0b0b0b-0000-4000-8000-0000000000bb', nombre: yo.nombre },
    ];
    renderUsuarios();
    await screen.findByRole('table', { name: 'Usuarios' });
    expect(screen.getAllByText('Tu cuenta')).toHaveLength(1);
    expect(
      within(screen.getAllByRole('row')[1] as HTMLElement).getByText('Tu cuenta'),
    ).toBeInTheDocument();
  });

  it('el menú de la cuenta propia solo ofrece Editar; el de las demás, todo', async () => {
    crearServidor(fetchMock);
    const { user } = renderUsuarios();
    await screen.findByRole('table', { name: 'Usuarios' });

    await user.click(screen.getByRole('button', { name: `Acciones de ${yo.nombre}` }));
    expect(
      within(await screen.findByRole('menu'))
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Editar']);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: `Acciones de ${bruno.nombre}` }));
    expect(
      within(await screen.findByRole('menu'))
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Editar', 'Restablecer contraseña', 'Desactivar']);
  });

  it('en pantallas angostas, tarjetas con los mismos datos y acciones', async () => {
    simularPantallaAngosta();
    crearServidor(fetchMock);
    renderUsuarios();
    const lista = await screen.findByRole('list', { name: 'Usuarios' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const tarjetas = within(lista).getAllByRole('listitem');
    expect(tarjetas).toHaveLength(3);
    const deCarla = tarjetas[2] as HTMLElement;
    expect(within(deCarla).getByText(carla.email)).toBeInTheDocument();
    expect(within(deCarla).getByText('Consulta')).toBeInTheDocument();
    expect(within(deCarla).getByText('Cambio pendiente')).toBeInTheDocument();
    expect(within(deCarla).getByText('Nunca ingresó')).toBeInTheDocument();
    expect(
      within(deCarla).getByRole('button', { name: `Acciones de ${carla.nombre}` }),
    ).toBeInTheDocument();
    expect(within(tarjetas[0] as HTMLElement).getByText('Tu cuenta')).toBeInTheDocument();
  });
});

describe('UsuariosPage: filtros', () => {
  it('"Incluir desactivados" pide todas, las muestra como desactivadas y queda en la URL', async () => {
    crearServidor(fetchMock);
    const { user, router } = renderUsuarios();
    await screen.findByRole('table', { name: 'Usuarios' });
    await user.click(screen.getByRole('checkbox', { name: 'Incluir desactivados' }));

    await waitFor(() => expect(nombresEnTabla()).toContain(dario.nombre));
    expect(pedidos()).toContain('GET /usuarios?incluirDesactivados=true');
    expect(within(filaDe(dario.nombre)).getByText('Desactivado')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?desactivados=1');
  });

  it('la búsqueda espera a que se deje de escribir y pide q; el rol pide rol', async () => {
    crearServidor(fetchMock);
    const { user, router } = renderUsuarios();
    await screen.findByRole('table', { name: 'Usuarios' });

    await user.type(screen.getByRole('searchbox', { name: 'Buscar usuario' }), 'carla');
    // Ni un pedido por tecla: uno solo, con el texto completo.
    await waitFor(() => expect(pedidos()).toContain('GET /usuarios?q=carla'), {
      timeout: RETARDO_BUSQUEDA_MS + 1000,
    });
    expect(pedidos().filter((p) => p.startsWith('GET /usuarios?q='))).toEqual([
      'GET /usuarios?q=carla',
    ]);
    await waitFor(() => expect(nombresEnTabla()).toEqual([carla.nombre]));

    await elegirOpcion(user, screen.getByRole('combobox', { name: 'Rol' }), 'Consulta');
    await waitFor(() => expect(pedidos()).toContain('GET /usuarios?q=carla&rol=CONSULTA'));
    expect(router.state.location.search).toBe('?q=carla&rol=CONSULTA');
  });

  it('mientras llega el filtro nuevo, el listado anterior queda atenuado y se anuncia "Actualizando…"', async () => {
    const servidor = crearServidor(fetchMock);
    const { user } = renderUsuarios();
    await screen.findByRole('table', { name: 'Usuarios' });
    let responder: (respuesta: Response) => void = () => undefined;
    servidor.forzadas.set(
      'GET /usuarios',
      () => new Promise((resolve) => (responder = resolve)) as never,
    );

    await elegirOpcion(user, screen.getByRole('combobox', { name: 'Rol' }), 'Consulta');
    expect(await screen.findByText('Actualizando…')).toBeInTheDocument();
    expect(tabla().closest('[aria-busy="true"]')).not.toBeNull();
    // Los datos son del filtro anterior: no se presentan como el resultado nuevo.
    expect(screen.queryByText('3 usuarios')).not.toBeInTheDocument();

    act(() => responder(json([carla])));
    await waitFor(() => expect(nombresEnTabla()).toEqual([carla.nombre]));
    expect(screen.getByText('1 usuario')).toBeInTheDocument();
  });

  it('una URL inválida se corrige: el rol desconocido y una búsqueda con control no se piden', async () => {
    crearServidor(fetchMock);
    const { router } = renderUsuarios('/usuarios?rol=ROOT&q=a%00b&desactivados=0');
    await screen.findByRole('table', { name: 'Usuarios' });
    expect(pedidos()).toEqual(['GET /usuarios']);
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('sin coincidencias: lo dice y ofrece limpiar los filtros (no "Nuevo usuario" como salida)', async () => {
    crearServidor(fetchMock);
    const { user, router } = renderUsuarios('/usuarios?q=nadie&desactivados=1');
    expect(
      await screen.findByText('No encontramos usuarios con esos filtros.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Nuevo usuario/ })).toHaveLength(1);

    await user.click(
      within(
        screen.getByText('No encontramos usuarios con esos filtros.').parentElement as HTMLElement,
      ).getByRole('button', { name: 'Limpiar filtros' }),
    );
    await screen.findByRole('table', { name: 'Usuarios' });
    expect(router.state.location.search).toBe('');
    expect(screen.getByRole('searchbox', { name: 'Buscar usuario' })).toHaveValue('');
  });

  it('sin coincidencias entre las activas: ofrece incluir las desactivadas', async () => {
    crearServidor(fetchMock);
    const { user } = renderUsuarios('/usuarios?q=dario');
    expect(
      await screen.findByText('No encontramos usuarios con esos filtros.'),
    ).toBeInTheDocument();
    await user.click(
      screen.getAllByRole('button', { name: 'Incluir desactivados' })[0] as HTMLElement,
    );
    await waitFor(() => expect(nombresEnTabla()).toEqual([dario.nombre]));
  });

  it('sin ninguna cuenta activa ni filtros: "No hay cuentas activas"', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.cuentas = [dario];
    renderUsuarios();
    expect(await screen.findByText('No hay cuentas activas')).toBeInTheDocument();
  });
});

describe('UsuariosPage: error de carga', () => {
  it('dice que no se pudieron cargar (no que no hay), con diagnóstico, y Reintentar vuelve a pedir', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.forzadas.set('GET /usuarios', () => errorJson(503, 'SERVICE_UNAVAILABLE'));
    const { user } = renderUsuarios();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos cargar los usuarios');
    expect(alerta).toHaveTextContent('HTTP_503');
    expect(alerta).not.toHaveTextContent('mensaje interno');
    expect(screen.queryByText(/No hay cuentas/)).not.toBeInTheDocument();

    servidor.forzadas.delete('GET /usuarios');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('table', { name: 'Usuarios' });
  });

  it('un 403 al listar se explica como falta de permiso', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.forzadas.set('GET /usuarios', () =>
      errorJson(403, 'FORBIDDEN', { motivo: 'PERMISO_INSUFICIENTE' }),
    );
    renderUsuarios();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tu cuenta no tiene permiso para administrar usuarios.',
    );
  });
});
