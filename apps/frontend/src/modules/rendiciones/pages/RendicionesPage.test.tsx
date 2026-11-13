import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { RendicionesPage } from '@/modules/rendiciones/pages/RendicionesPage';

// Pantalla Rendiciones (HU3.2): el listado del mes elegido, con el mes en la URL.

const fetchMock = vi.fn<typeof fetch>();
// Mediados de noviembre de 2026 en Buenos Aires.
const HOY = new Date('2026-11-15T12:00:00-03:00');

const fila = (n: number, denominacion: string) => ({
  id: `e1f2a3b4-c5d6-4789-8abc-${String(n).padStart(12, '0')}`,
  clienteId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
  cliente: { denominacion, sector: 'PRIVADO', subtipo: null },
  numeroFactura: `B 00002-0000000${n}`,
  estado: 'EN_CURSO',
  avance: { reunidos: 1, total: 2, faltantes: 1 },
  ultimoPaso: null,
  atrasada: false,
  cobro: null,
});

/**
 * El backend simulado: el listado de cada mes, por `anio-mes`, y el de atrasadas (HU3.4; por
 * defecto, ninguna).
 */
function servir(porMes: Record<string, object[]>, atrasadas: object[] = []) {
  fetchMock.mockImplementation((entrada) => {
    const url = new URL(typeof entrada === 'string' ? entrada : (entrada as Request).url);
    const clave = `${url.searchParams.get('anio')}-${url.searchParams.get('mes')}`;
    const cuerpo = url.pathname === '/rendiciones/atrasadas' ? atrasadas : (porMes[clave] ?? []);
    return Promise.resolve(
      new Response(JSON.stringify(cuerpo), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function renderPantalla(url = '/rendiciones') {
  const router = createMemoryRouter(
    [
      { path: '/rendiciones', element: <RendicionesPage /> },
      { path: '/clientes', element: <h1>Clientes</h1> },
    ],
    { initialEntries: [url] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

/** Los pedidos del listado del mes (el de atrasadas se pide siempre, aparte). */
const pedidos = () =>
  fetchMock.mock.calls
    .map(([entrada]) => {
      const url = new URL(typeof entrada === 'string' ? entrada : (entrada as Request).url);
      return `${url.pathname}${url.search}`;
    })
    .filter((pedido) => pedido !== '/rendiciones/atrasadas');
const mesVisible = () => within(screen.getByRole('group', { name: 'Mes' })).getByText(/\d{4}/);

describe('RendicionesPage (HU3.2)', () => {
  it('sin parámetros muestra el mes actual (Buenos Aires), con una fila por rendición', async () => {
    servir({ '2026-11': [fila(1, 'Muni Ejemplo'), fila(2, 'Muni Ejemplo')] });
    const { router } = renderPantalla();

    const lista = await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2);
    expect(mesVisible()).toHaveTextContent('Noviembre 2026');
    expect(pedidos()).toEqual(['/rendiciones?anio=2026&mes=11']);
    // El mes actual no se escribe en la URL.
    expect(router.state.location.search).toBe('');
  });

  it('debajo del título dice qué día es hoy y cuántas rendiciones hay en el mes', async () => {
    servir({
      '2026-11': [fila(1, 'Muni Ejemplo'), fila(2, 'Zeta')],
      '2025-12': [fila(3, 'Zeta')],
    });
    renderPantalla();

    expect(
      await screen.findByText('Hoy es domingo 15/11 · 2 rendiciones en noviembre'),
    ).toBeInTheDocument();

    // Un mes de otro año lo aclara, y "hoy" sigue siendo hoy.
    renderPantalla('/rendiciones?anio=2025&mes=12');
    expect(
      await screen.findByText('Hoy es domingo 15/11 · 1 rendición en diciembre de 2025'),
    ).toBeInTheDocument();
  });

  it('las filas van en una sola tarjeta, separadas por una línea', async () => {
    servir({ '2026-11': [fila(1, 'Muni Ejemplo'), fila(2, 'Zeta')] });
    renderPantalla();

    const lista = await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });
    expect(lista).toHaveClass('divide-y', 'rounded-card', 'border');
  });

  it('las flechas cambian de mes, lo guardan en la URL y piden ese mes', async () => {
    servir({ '2026-11': [fila(1, 'Muni Ejemplo')], '2026-10': [fila(2, 'Zeta')] });
    const { router, user } = renderPantalla();
    await screen.findByRole('link', { name: /Muni Ejemplo/ });

    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));

    await waitFor(() => expect(router.state.location.search).toBe('?anio=2026&mes=10'));
    expect(mesVisible()).toHaveTextContent('Octubre 2026');
    expect(await screen.findByRole('link', { name: /Zeta/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Muni Ejemplo/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    await waitFor(() => expect(router.state.location.search).toBe('?anio=2026&mes=12'));
    expect(mesVisible()).toHaveTextContent('Diciembre 2026');
  });

  it('las flechas cruzan de año', async () => {
    servir({});
    const { router, user } = renderPantalla('/rendiciones?anio=2026&mes=12');
    await screen.findByText('No hay rendiciones en Diciembre 2026');

    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));

    await waitFor(() => expect(router.state.location.search).toBe('?anio=2027&mes=1'));
    expect(mesVisible()).toHaveTextContent('Enero 2027');
  });

  it('abrir la URL con un mes lo muestra y lo pide', async () => {
    servir({ '2026-3': [fila(1, 'Muni Ejemplo')] });
    renderPantalla('/rendiciones?anio=2026&mes=3');

    expect(
      await screen.findByRole('list', { name: 'Rendiciones de Marzo 2026' }),
    ).toBeInTheDocument();
    expect(pedidos()).toEqual(['/rendiciones?anio=2026&mes=3']);
  });

  it.each(['?anio=2026&mes=13', '?anio=abc&mes=3', '?anio=2026', '?anio=2026&mes=3&mes=4'])(
    'un mes inválido en la URL (%s) vuelve al mes actual y se quita',
    async (query) => {
      servir({ '2026-11': [fila(1, 'Muni Ejemplo')] });
      const { router } = renderPantalla(`/rendiciones${query}`);

      await waitFor(() => expect(router.state.location.search).toBe(''));
      expect(
        await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' }),
      ).toBeInTheDocument();
    },
  );

  it('sin rendiciones en el mes lo dice y ofrece ir a Clientes', async () => {
    servir({});
    const { router, user } = renderPantalla();

    expect(await screen.findByText('No hay rendiciones en Noviembre 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Ir a Clientes' }));

    expect(router.state.location.pathname).toBe('/clientes');
  });

  it('si la consulta falla lo avisa y deja reintentar', async () => {
    let fallar = true;
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        fallar
          ? new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'x' } }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            })
          : new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    const { user } = renderPantalla();

    expect(await screen.findByText('No pudimos cargar las rendiciones.')).toBeInTheDocument();
    fallar = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('No hay rendiciones en Noviembre 2026')).toBeInTheDocument();
  });

  it('no deja pasar de los años que admite una rendición (2020 a 2100)', async () => {
    servir({});
    renderPantalla('/rendiciones?anio=2020&mes=1');

    await screen.findByText('No hay rendiciones en Enero 2020');
    expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeEnabled();
  });
});

describe('RendicionesPage: resumen y filtros (HU3.3)', () => {
  interface Cambios {
    estado?: string;
    denominacion?: string;
    sector?: string;
    subtipo?: string | null;
    numeroFactura?: string;
  }
  let n = 100;
  const rendicion = ({
    estado = 'EN_CURSO',
    denominacion = 'Grupo Solano',
    sector = 'PRIVADO',
    subtipo = null,
    numeroFactura,
  }: Cambios = {}) => {
    n += 1;
    return {
      ...fila(n, denominacion),
      cliente: { denominacion, sector, subtipo },
      numeroFactura: numeroFactura ?? `B 00002-0000${n}`,
      estado,
      ultimoPaso: ['ENVIADA', 'APROBADA', 'RECHAZADA'].includes(estado)
        ? { estado, fecha: '2026-11-03T15:00:00.000Z' }
        : null,
    };
  };

  // Noviembre: 2 En curso, 1 Completa, 1 Enviada, 1 Rechazada. Municipio y Privado.
  const noviembre = [
    rendicion({ denominacion: 'Grupo Solano' }),
    rendicion({
      denominacion: 'Municipalidad de Córdoba',
      sector: 'PUBLICO',
      subtipo: 'MUNICIPAL',
      numeroFactura: 'B 00002-00001482',
    }),
    rendicion({ estado: 'COMPLETA', denominacion: 'Andina Logística' }),
    rendicion({
      estado: 'ENVIADA',
      denominacion: 'Municipalidad de Ensenada',
      sector: 'PUBLICO',
      subtipo: 'MUNICIPAL',
    }),
    rendicion({ estado: 'RECHAZADA', denominacion: 'Zeta Producciones' }),
  ];

  const tarjetas = () => screen.getByRole('group', { name: 'Resumen por estado' });
  const tarjeta = (titulo: string) =>
    within(tarjetas()).getByRole('button', { name: new RegExp(`^${titulo}`) });
  const textosDeTarjetas = () =>
    within(tarjetas())
      .getAllByRole('button')
      .map((boton) => boton.textContent);
  const desplegable = () => screen.getByRole('combobox', { name: 'Tipo de cliente' });
  const opcionesDeTipo = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(desplegable());
    const opciones = (await screen.findAllByRole('option')).map((opcion) => opcion.textContent);
    await user.keyboard('{Escape}');
    return opciones;
  };
  const elegirTipo = async (user: ReturnType<typeof userEvent.setup>, nombre: string) => {
    await user.click(desplegable());
    await user.click(await screen.findByRole('option', { name: nombre }));
  };
  const activos = () => screen.getByRole('group', { name: 'Filtros activos' });
  const clientesVisibles = () =>
    within(screen.getByRole('list', { name: /^Rendiciones de/ }))
      .getAllByRole('heading', { level: 3 })
      .map((titulo) => titulo.textContent);
  const buscador = () => screen.getByRole('searchbox', { name: 'Buscar cliente o factura' });
  const parametro = (router: { state: { location: { search: string } } }, nombre: string) =>
    new URLSearchParams(router.state.location.search).get(nombre);

  it('las tarjetas cuentan las rendiciones del mes por estado y no cambian al filtrar', async () => {
    servir({ '2026-11': noviembre });
    const { user } = renderPantalla();
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    const esperadas = [
      'En curso2',
      'Completas1',
      'Enviadas1',
      'Aprobadas0',
      'Rechazadas1',
      'Atrasadas0',
    ];
    expect(textosDeTarjetas()).toEqual(esperadas);

    await user.click(tarjeta('Enviadas'));
    await elegirTipo(user, 'Municipio');

    expect(clientesVisibles()).toEqual(['Municipalidad de Ensenada']);
    expect(textosDeTarjetas()).toEqual(esperadas);
    // El subtítulo sigue contando el total del mes.
    expect(screen.getByText(/5 rendiciones en noviembre/)).toBeInTheDocument();
  });

  it('las tarjetas son el único filtro por estado: no hay chips de estado', async () => {
    servir({ '2026-11': noviembre });
    renderPantalla();
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    expect(screen.queryByRole('group', { name: 'Estado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Todas' })).toBeNull();
  });

  it('tocar una tarjeta filtra el listado y lo guarda en la URL; tocarla de nuevo lo quita', async () => {
    servir({ '2026-11': noviembre });
    const { router, user } = renderPantalla();
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    await user.click(tarjeta('En curso'));

    expect(router.state.location.search).toBe('?estado=EN_CURSO');
    expect(clientesVisibles()).toEqual(['Grupo Solano', 'Municipalidad de Córdoba']);
    expect(tarjeta('En curso')).toHaveAttribute('aria-pressed', 'true');

    await user.click(tarjeta('En curso'));

    expect(router.state.location.search).toBe('');
    expect(clientesVisibles()).toHaveLength(5);
    expect(tarjeta('En curso')).toHaveAttribute('aria-pressed', 'false');
  });

  it('con un estado activo, su tarjeta se marca y las demás se atenúan, pero siguen clickeables', async () => {
    servir({ '2026-11': noviembre });
    const { router, user } = renderPantalla('/rendiciones?estado=EN_CURSO');
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    expect(tarjeta('En curso')).toHaveClass('bg-estado-en-curso-soft', 'border-estado-en-curso');
    expect(tarjeta('En curso')).not.toHaveClass('opacity-60');
    expect(tarjeta('Rechazadas')).toHaveClass('opacity-60');
    expect(tarjeta('Rechazadas')).toHaveTextContent('1');

    // Tocar otra cambia el estado filtrado.
    await user.click(tarjeta('Rechazadas'));

    expect(router.state.location.search).toBe('?estado=RECHAZADA');
    expect(clientesVisibles()).toEqual(['Zeta Producciones']);
    expect(tarjeta('En curso')).toHaveClass('opacity-60');
  });

  it('sin estado activo, ninguna tarjeta se atenúa', async () => {
    servir({ '2026-11': noviembre });
    renderPantalla();
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    for (const boton of within(tarjetas()).getAllByRole('button')) {
      expect(boton).not.toHaveClass('opacity-60');
    }
  });

  it('el desplegable de tipo dice "Tipo de cliente: Todos" y ofrece solo los tipos del mes', async () => {
    servir({ '2026-11': noviembre });
    const { user } = renderPantalla();
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    expect(desplegable()).toHaveTextContent('Tipo de cliente: Todos');
    expect(await opcionesDeTipo(user)).toEqual(['Todos', 'Municipio', 'Privado']);
  });

  it('elegir un tipo filtra, lo guarda en la URL y el desplegable dice "Tipo: <tipo>"; "Todos" lo quita', async () => {
    servir({ '2026-11': noviembre });
    const { router, user } = renderPantalla();
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    await elegirTipo(user, 'Municipio');

    expect(router.state.location.search).toBe('?tipo=MUNICIPAL');
    expect(clientesVisibles()).toEqual(['Municipalidad de Córdoba', 'Municipalidad de Ensenada']);
    expect(desplegable()).toHaveTextContent('Tipo: Municipio');
    expect(within(desplegable()).getByText('Municipio')).toHaveClass('font-semibold');

    await elegirTipo(user, 'Todos');

    expect(router.state.location.search).toBe('');
    expect(desplegable()).toHaveTextContent('Tipo de cliente: Todos');
  });

  it('estado y tipo de cliente a la vez: solo las que cumplen los dos, y los dos en la URL', async () => {
    servir({ '2026-11': noviembre });
    const { router, user } = renderPantalla();
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    await user.click(tarjeta('En curso'));
    await elegirTipo(user, 'Privado');

    expect(clientesVisibles()).toEqual(['Grupo Solano']);
    expect(parametro(router, 'estado')).toBe('EN_CURSO');
    expect(parametro(router, 'tipo')).toBe('PRIVADO');
  });

  it.each([
    ['por el nombre, sin acentos ni mayúsculas', 'CORDOBA'],
    ['por la factura, sin guiones ni la B', '0000200001482'],
    ['por la factura, con guiones', '00002-00001482'],
    ['por la factura, con la B', 'b 00002-0000148'],
  ])('el buscador encuentra %s', async (_caso, texto) => {
    servir({ '2026-11': noviembre });
    const { router, user } = renderPantalla();
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    await user.type(buscador(), texto);

    // Con un pequeño retardo, llega a la URL y filtra.
    await waitFor(() => expect(parametro(router, 'q')).toBe(texto));
    // La URL cambia antes de que se vuelva a pintar el listado: se espera también a la lista.
    await waitFor(() => expect(clientesVisibles()).toEqual(['Municipalidad de Córdoba']));
  });

  it('recargar con filtros en la URL los aplica', async () => {
    servir({ '2026-11': noviembre });
    renderPantalla('/rendiciones?estado=EN_CURSO&tipo=MUNICIPAL&q=cordoba');
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    expect(clientesVisibles()).toEqual(['Municipalidad de Córdoba']);
    expect(tarjeta('En curso')).toHaveAttribute('aria-pressed', 'true');
    expect(desplegable()).toHaveTextContent('Tipo: Municipio');
    expect(buscador()).toHaveValue('cordoba');
  });

  it('los valores inválidos en la URL se ignoran y se quitan; el mes queda', async () => {
    servir({ '2026-10': noviembre });
    const { router } = renderPantalla(
      '/rendiciones?anio=2026&mes=10&estado=ATRASADA&tipo=OTRO&q=%20%20',
    );
    await screen.findByRole('list', { name: 'Rendiciones de Octubre 2026' });

    await waitFor(() => expect(router.state.location.search).toBe('?anio=2026&mes=10'));
    expect(clientesVisibles()).toHaveLength(5);
  });

  it('un filtro repetido en la URL también se quita', async () => {
    servir({ '2026-11': noviembre });
    const { router } = renderPantalla('/rendiciones?estado=ENVIADA&estado=COMPLETA&tipo=PRIVADO');
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    await waitFor(() => expect(router.state.location.search).toBe('?tipo=PRIVADO'));
    expect(clientesVisibles()).toEqual(['Grupo Solano', 'Andina Logística', 'Zeta Producciones']);
  });

  it('sin resultados lo dice, sin botón propio, y "Limpiar todo" deja solo el mes', async () => {
    servir({ '2026-10': noviembre });
    const { router, user } = renderPantalla(
      '/rendiciones?anio=2026&mes=10&estado=APROBADA&tipo=PRIVADO&q=solano',
    );

    expect(
      await screen.findByRole('heading', { name: 'Ninguna rendición coincide con los filtros' }),
    ).toBeInTheDocument();
    // Las tarjetas y los filtros siguen, para cambiarlos.
    expect(tarjetas()).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull();

    await user.click(within(activos()).getByRole('button', { name: 'Limpiar todo' }));

    expect(router.state.location.search).toBe('?anio=2026&mes=10');
    expect(clientesVisibles()).toHaveLength(5);
    expect(buscador()).toHaveValue('');
  });

  it('al cambiar de mes los filtros se mantienen, y las tarjetas y los tipos son los del nuevo mes', async () => {
    servir({
      '2026-11': noviembre,
      '2026-10': [rendicion({ estado: 'ENVIADA', denominacion: 'Grupo Solano' })],
    });
    const { router, user } = renderPantalla('/rendiciones?estado=ENVIADA');
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));

    await screen.findByRole('list', { name: 'Rendiciones de Octubre 2026' });
    expect(parametro(router, 'estado')).toBe('ENVIADA');
    expect(clientesVisibles()).toEqual(['Grupo Solano']);
    expect(tarjeta('Enviadas')).toHaveTextContent('1');
    expect(tarjeta('En curso')).toHaveTextContent('0');
    expect(await opcionesDeTipo(user)).toEqual(['Todos', 'Privado']);
  });

  it('un tipo filtrado que no está en el mes sigue en el desplegable, para verlo y quitarlo', async () => {
    servir({ '2026-11': noviembre });
    const { router, user } = renderPantalla('/rendiciones?tipo=SINDICAL_OBRA_SOCIAL');

    expect(
      await screen.findByRole('heading', { name: 'Ninguna rendición coincide con los filtros' }),
    ).toBeInTheDocument();
    expect(desplegable()).toHaveTextContent('Tipo: Sindicato u obra social');
    expect(await opcionesDeTipo(user)).toEqual([
      'Todos',
      'Municipio',
      'Privado',
      'Sindicato u obra social',
    ]);

    await elegirTipo(user, 'Todos');

    expect(router.state.location.search).toBe('');
    expect(await opcionesDeTipo(user)).toEqual(['Todos', 'Municipio', 'Privado']);
  });

  describe('línea de filtros activos', () => {
    it('no aparece sin filtros', async () => {
      servir({ '2026-11': noviembre });
      renderPantalla();
      await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

      expect(screen.queryByRole('group', { name: 'Filtros activos' })).toBeNull();
    });

    it('muestra cuántas se ven sobre el total del mes y una etiqueta por filtro', async () => {
      servir({ '2026-11': noviembre });
      renderPantalla('/rendiciones?estado=EN_CURSO&tipo=MUNICIPAL&q=cordoba');
      await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

      expect(activos()).toHaveTextContent(
        /^1 de 5 · Filtros:Estado: En curso.*Municipio.*“cordoba”.*Limpiar todo$/,
      );
      // La del estado va en el color de su estado.
      expect(within(activos()).getByText('Estado: En curso')).toHaveClass(
        'text-estado-en-curso',
        'bg-estado-en-curso-soft',
      );
    });

    it.each([
      [
        'el estado',
        'Quitar filtro Estado: En curso',
        { estado: null, tipo: 'MUNICIPAL', q: 'cordoba' },
      ],
      ['el tipo', 'Quitar filtro Municipio', { estado: 'EN_CURSO', tipo: null, q: 'cordoba' }],
      [
        'la búsqueda',
        'Quitar filtro “cordoba”',
        { estado: 'EN_CURSO', tipo: 'MUNICIPAL', q: null },
      ],
    ])('la ✕ de %s quita solo ese filtro', async (_caso, boton, quedan) => {
      servir({ '2026-11': noviembre });
      const { router, user } = renderPantalla(
        '/rendiciones?estado=EN_CURSO&tipo=MUNICIPAL&q=cordoba',
      );
      await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

      await user.click(within(activos()).getByRole('button', { name: boton }));

      expect(parametro(router, 'estado')).toBe(quedan.estado);
      expect(parametro(router, 'tipo')).toBe(quedan.tipo);
      expect(parametro(router, 'q')).toBe(quedan.q);
      if (quedan.q === null) expect(buscador()).toHaveValue('');
    });

    it('"Limpiar todo" deja solo el mes y la línea desaparece', async () => {
      servir({ '2026-10': noviembre });
      const { router, user } = renderPantalla(
        '/rendiciones?anio=2026&mes=10&estado=EN_CURSO&tipo=PRIVADO&q=solano',
      );
      await screen.findByRole('list', { name: 'Rendiciones de Octubre 2026' });

      await user.click(within(activos()).getByRole('button', { name: 'Limpiar todo' }));

      expect(router.state.location.search).toBe('?anio=2026&mes=10');
      expect(screen.queryByRole('group', { name: 'Filtros activos' })).toBeNull();
      expect(clientesVisibles()).toHaveLength(5);
      expect(buscador()).toHaveValue('');
    });
  });

  // Deuda técnica post HU3.4: con el mes vacío las seis tarjetas se ven siempre (en 0), sin filtros.
  it('un mes sin rendiciones muestra las tarjetas en 0 y el aviso, sin filtros', async () => {
    servir({});
    renderPantalla('/rendiciones?estado=ENVIADA');

    expect(await screen.findByText('No hay rendiciones en Noviembre 2026')).toBeInTheDocument();
    const tarjetasDelMes = screen.getByRole('group', { name: 'Resumen por estado' });
    expect(within(tarjetasDelMes).getAllByRole('button')).toHaveLength(6);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filtros activos' })).toBeNull();
  });
});

describe('RendicionesPage: atrasadas (HU3.4)', () => {
  let n = 500;
  const rendicion = (
    denominacion: string,
    {
      estado = 'EN_CURSO',
      atrasada = false,
      sector = 'PRIVADO',
      subtipo = null as string | null,
    } = {},
  ) => {
    n += 1;
    return {
      ...fila(n, denominacion),
      cliente: { denominacion, sector, subtipo },
      estado,
      atrasada,
    };
  };
  /** Una fila del listado de atrasadas: la del mes, con su período y `atrasada: true`. */
  const atrasada = (
    denominacion: string,
    anio: number,
    mes: number,
    extra: { sector?: string; subtipo?: string | null; estado?: string } = {},
  ) => ({ ...rendicion(denominacion, { ...extra, atrasada: true }), anio, mes });

  // Hoy es noviembre de 2026: atrasadas, septiembre o antes. Ya vienen ordenadas por el backend.
  const ATRASADAS = [
    atrasada('Zeta Producciones', 2026, 3),
    atrasada('Municipalidad de Córdoba', 2026, 9, {
      sector: 'PUBLICO',
      subtipo: 'MUNICIPAL',
      estado: 'COMPLETA',
    }),
    atrasada('Grupo Solano', 2026, 9),
  ];
  const NOVIEMBRE = [rendicion('Andina Logística'), rendicion('Grupo Solano')];

  const tarjetas = () => screen.getByRole('group', { name: 'Resumen por estado' });
  const tarjeta = (titulo: string) =>
    within(tarjetas()).getByRole('button', { name: new RegExp(`^${titulo}`) });
  const lista = (nombre: string | RegExp) => screen.getByRole('list', { name: nombre });
  const clientesDe = (nombre: string | RegExp) =>
    within(lista(nombre))
      .getAllByRole('heading', { level: 3 })
      .map((titulo) => titulo.textContent);
  const activos = () => screen.getByRole('group', { name: 'Filtros activos' });
  const parametro = (router: { state: { location: { search: string } } }, nombre: string) =>
    new URLSearchParams(router.state.location.search).get(nombre);

  it('la tarjeta Atrasadas cuenta todas las atrasadas aunque se esté viendo el mes actual', async () => {
    servir({ '2026-11': NOVIEMBRE }, ATRASADAS);
    renderPantalla();
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    await waitFor(() => expect(tarjeta('Atrasadas')).toHaveTextContent('Atrasadas3'));
    expect(within(tarjeta('Atrasadas')).getByText('3')).toHaveClass('text-atrasada');
    expect(pedidos()).toEqual(['/rendiciones?anio=2026&mes=11']);
    const urls = fetchMock.mock.calls.map(([entrada]) =>
      typeof entrada === 'string' ? entrada : (entrada as Request).url,
    );
    expect(urls).toContain('https://api.example/rendiciones/atrasadas');
  });

  it('con 0 atrasadas la tarjeta se muestra igual, en un tono neutro', async () => {
    servir({ '2026-11': NOVIEMBRE });
    renderPantalla();
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    await waitFor(() => expect(tarjeta('Atrasadas')).toHaveTextContent('Atrasadas0'));
    const numero = within(tarjeta('Atrasadas')).getByText('0');
    expect(numero).not.toHaveClass('text-atrasada');
    expect(numero).toHaveClass('text-content-secondary');
  });

  it('tocar la tarjeta abre la vista de atrasadas; tocarla de nuevo vuelve al mes', async () => {
    servir({ '2026-11': NOVIEMBRE }, ATRASADAS);
    const { router, user } = renderPantalla();
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });
    await waitFor(() => expect(tarjeta('Atrasadas')).toHaveTextContent('3'));

    await user.click(tarjeta('Atrasadas'));

    expect(router.state.location.search).toBe('?vista=atrasadas');
    expect(tarjeta('Atrasadas')).toHaveAttribute('aria-pressed', 'true');
    expect(clientesDe('Rendiciones atrasadas')).toEqual([
      'Zeta Producciones',
      'Municipalidad de Córdoba',
      'Grupo Solano',
    ]);
    // Ninguna tarjeta de estado queda activa.
    expect(tarjeta('En curso')).toHaveAttribute('aria-pressed', 'false');

    await user.click(tarjeta('Atrasadas'));

    expect(router.state.location.search).toBe('');
    expect(clientesDe('Rendiciones de Noviembre 2026')).toEqual([
      'Andina Logística',
      'Grupo Solano',
    ]);
  });

  it('en la vista, de la más vieja a la más nueva, cada fila con "Atrasada · <mes>"', async () => {
    servir({ '2026-11': NOVIEMBRE }, ATRASADAS);
    renderPantalla('/rendiciones?vista=atrasadas');

    const filas = within(await screen.findByRole('list', { name: 'Rendiciones atrasadas' }))
      .getAllByRole('listitem')
      .map((item) => within(item).getByText(/^Atrasada · /).textContent);

    expect(filas).toEqual([
      'Atrasada · Marzo 2026',
      'Atrasada · Septiembre 2026',
      'Atrasada · Septiembre 2026',
    ]);
    expect(within(lista('Rendiciones atrasadas')).getAllByText(/^Atrasada · /)[0]).toHaveClass(
      'text-atrasada',
    );
    // El estado de la segunda línea sigue siendo el suyo.
    expect(within(lista('Rendiciones atrasadas')).getByText('Completa')).toBeInTheDocument();
  });

  it('en la vista, el tipo de cliente y el buscador siguen aplicando', async () => {
    servir({ '2026-11': NOVIEMBRE }, ATRASADAS);
    const { router, user } = renderPantalla('/rendiciones?vista=atrasadas');
    await screen.findByRole('list', { name: 'Rendiciones atrasadas' });

    await user.click(screen.getByRole('combobox', { name: 'Tipo de cliente' }));
    await user.click(await screen.findByRole('option', { name: 'Privado' }));
    expect(clientesDe('Rendiciones atrasadas')).toEqual(['Zeta Producciones', 'Grupo Solano']);

    await user.type(screen.getByRole('searchbox', { name: 'Buscar cliente o factura' }), 'solano');
    await waitFor(() => expect(parametro(router, 'q')).toBe('solano'));
    await waitFor(() => expect(clientesDe('Rendiciones atrasadas')).toEqual(['Grupo Solano']));
    expect(parametro(router, 'vista')).toBe('atrasadas');
    expect(activos()).toHaveTextContent(/^1 de 3 · Filtros:/);
  });

  it('tocar una tarjeta de estado sale de la vista y aplica ese estado al mes', async () => {
    servir({ '2026-11': NOVIEMBRE }, ATRASADAS);
    const { router, user } = renderPantalla('/rendiciones?vista=atrasadas');
    await screen.findByRole('list', { name: 'Rendiciones atrasadas' });

    await user.click(tarjeta('En curso'));

    expect(router.state.location.search).toBe('?estado=EN_CURSO');
    expect(tarjeta('En curso')).toHaveAttribute('aria-pressed', 'true');
    expect(tarjeta('Atrasadas')).toHaveAttribute('aria-pressed', 'false');
    expect(clientesDe('Rendiciones de Noviembre 2026')).toEqual([
      'Andina Logística',
      'Grupo Solano',
    ]);
  });

  it('recargar con ?vista=atrasadas mantiene la vista; un estado junto con la vista se quita', async () => {
    servir({ '2026-11': NOVIEMBRE }, ATRASADAS);
    const { router } = renderPantalla('/rendiciones?vista=atrasadas&estado=ENVIADA');

    expect(await screen.findByRole('list', { name: 'Rendiciones atrasadas' })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe('?vista=atrasadas'));
    expect(tarjeta('Enviadas')).toHaveAttribute('aria-pressed', 'false');
  });

  it('una vista desconocida en la URL se ignora y se quita', async () => {
    servir({ '2026-11': NOVIEMBRE }, ATRASADAS);
    const { router } = renderPantalla('/rendiciones?vista=otra');

    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('la línea de filtros activos muestra "Atrasadas ✕" en rojo; su ✕ vuelve al mes', async () => {
    servir({ '2026-11': NOVIEMBRE }, ATRASADAS);
    const { router, user } = renderPantalla('/rendiciones?vista=atrasadas');
    await screen.findByRole('list', { name: 'Rendiciones atrasadas' });

    expect(activos()).toHaveTextContent(/^3 de 3 · Filtros:Atrasadas.*Limpiar todo$/);
    expect(within(activos()).getByText('Atrasadas')).toHaveClass('text-atrasada');

    await user.click(within(activos()).getByRole('button', { name: 'Quitar filtro Atrasadas' }));

    expect(router.state.location.search).toBe('');
    expect(screen.queryByRole('group', { name: 'Filtros activos' })).toBeNull();
  });

  it('"Limpiar todo" desde la vista vuelve al mes sin filtros', async () => {
    servir({ '2026-10': NOVIEMBRE }, ATRASADAS);
    const { router, user } = renderPantalla(
      '/rendiciones?anio=2026&mes=10&vista=atrasadas&tipo=PRIVADO&q=solano',
    );
    await screen.findByRole('list', { name: 'Rendiciones atrasadas' });

    await user.click(within(activos()).getByRole('button', { name: 'Limpiar todo' }));

    expect(router.state.location.search).toBe('?anio=2026&mes=10');
    expect(
      await screen.findByRole('list', { name: 'Rendiciones de Octubre 2026' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['el mes actual', '2026-11', '/rendiciones'],
    ['el mes anterior', '2026-10', '/rendiciones?anio=2026&mes=10'],
  ])('en %s ninguna fila tiene la marca', async (_caso, clave, url) => {
    servir({ [clave]: NOVIEMBRE }, ATRASADAS);
    renderPantalla(url);

    const listado = await screen.findByRole('list', { name: /^Rendiciones de/ });

    expect(within(listado).queryByText(/^Atrasada/)).toBeNull();
  });

  it('en un mes de dos meses atrás, las sin enviar vienen primero y marcadas', async () => {
    // El backend ya las ordena: atrasadas primero.
    servir(
      {
        '2026-9': [
          rendicion('Municipalidad de Córdoba', { atrasada: true }),
          rendicion('Zeta Producciones', { estado: 'ENVIADA' }),
        ],
      },
      ATRASADAS,
    );
    renderPantalla('/rendiciones?anio=2026&mes=9');

    const items = within(
      await screen.findByRole('list', { name: 'Rendiciones de Septiembre 2026' }),
    ).getAllByRole('listitem');

    // Fuera de la vista, la marca es solo "Atrasada", sin el mes (es el que se está viendo).
    expect(within(items[0] as HTMLElement).getByText('Atrasada')).toHaveClass('text-atrasada');
    expect(within(items[1] as HTMLElement).queryByText(/^Atrasada/)).toBeNull();
  });

  it('con el mes vacío y atrasadas, se ven las seis tarjetas y el aviso del mes vacío', async () => {
    servir({}, ATRASADAS);
    const { user } = renderPantalla();

    expect(await screen.findByText('No hay rendiciones en Noviembre 2026')).toBeInTheDocument();
    await waitFor(() => expect(tarjeta('Atrasadas')).toHaveTextContent('3'));
    expect(within(tarjetas()).getAllByRole('button')).toHaveLength(6);
    expect(screen.queryByRole('searchbox')).toBeNull();

    // Desde ahí se abre la vista.
    await user.click(tarjeta('Atrasadas'));
    expect(await screen.findByRole('list', { name: 'Rendiciones atrasadas' })).toBeInTheDocument();
  });

  it('con el mes vacío y las atrasadas cargando, las seis tarjetas ya están en pantalla', async () => {
    // El listado del mes responde vacío; el de atrasadas no responde todavía.
    fetchMock.mockImplementation((entrada) => {
      const url = new URL(typeof entrada === 'string' ? entrada : (entrada as Request).url);
      if (url.pathname === '/rendiciones/atrasadas') return new Promise<Response>(() => undefined);
      return Promise.resolve(
        new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
      );
    });
    renderPantalla();

    expect(await screen.findByText('No hay rendiciones en Noviembre 2026')).toBeInTheDocument();
    expect(within(tarjetas()).getAllByRole('button')).toHaveLength(6);
    // Atrasadas, con el estado de carga.
    expect(tarjeta('Atrasadas')).toHaveTextContent('Atrasadas–');
  });

  it('con el mes vacío y 0 atrasadas, siguen las seis tarjetas (Atrasadas en 0, neutra)', async () => {
    servir({});
    renderPantalla();

    expect(await screen.findByText('No hay rendiciones en Noviembre 2026')).toBeInTheDocument();
    await waitFor(() => expect(tarjeta('Atrasadas')).toHaveTextContent('Atrasadas0'));
    expect(within(tarjetas()).getAllByRole('button')).toHaveLength(6);
  });

  it('en la vista sin atrasadas, lo dice', async () => {
    servir({ '2026-11': NOVIEMBRE });
    renderPantalla('/rendiciones?vista=atrasadas');

    expect(
      await screen.findByRole('heading', { name: 'No hay rendiciones atrasadas' }),
    ).toBeInTheDocument();
  });
});
