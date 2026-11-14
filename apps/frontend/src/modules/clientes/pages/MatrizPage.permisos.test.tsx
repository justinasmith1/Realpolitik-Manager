// MatrizPage según el rol (HU4.3). CONSULTA lee el cliente, su matriz, las indicaciones y las
// observaciones, sin alta, edición ni baja de requisitos y sin abrir la edición del cliente;
// ADMINISTRATIVO y ADMINISTRADOR conservan todo, incluido el aviso de cliente no activo.
//
// Las rendiciones del cliente (`RendicionesSection`) se adaptan en el bloque 3: estos tests no
// miran sus acciones.

import type { RolUsuarioType } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { sembrarSesion } from '@/modules/auth/test/sesionDePrueba';
import { stateDeListado } from '@/modules/clientes/matriz.navegacion';
import { MatrizPage } from '@/modules/clientes/pages/MatrizPage';

const fetchMock = vi.fn<typeof fetch>();

const ID = '11111111-1111-4111-a111-111111111111';
const fechas = { creadoEn: '2026-10-08T12:00:00.000Z', actualizadoEn: '2026-10-08T12:00:00.000Z' };

const cliente = {
  id: ID,
  razonSocial: 'Municipalidad de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'muni@ejemplo.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null },
  estado: 'ACTIVO',
  matrizConfigurada: true,
  ...fechas,
};

const requisitos = [
  {
    id: '55555555-5555-4555-a555-555555555555',
    clienteId: ID,
    tipoDocumento: { id: '33333333-3333-4333-a333-333333333333', nombre: 'Zócalo', activo: true },
    cantidad: 3,
    diasAproximados: [1, 8, 15],
    canalEntrega: null,
    nota: null,
    ...fechas,
  },
];

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

function servir(datos: typeof cliente = cliente, lista: unknown[] = requisitos) {
  fetchMock.mockImplementation((entrada, init) => {
    if ((init?.method ?? 'GET') !== 'GET') return Promise.resolve(json({}, 500));
    const path = new URL(urlDe(entrada)).pathname;
    if (path.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: 'Un PDF por factura.' }));
    }
    if (path.endsWith('/observaciones')) {
      return Promise.resolve(json({ observaciones: 'Pagan a 60 días.' }));
    }
    if (path.endsWith('/rendiciones')) return Promise.resolve(json([]));
    if (path.endsWith('/requisitos')) return Promise.resolve(json(lista));
    return Promise.resolve(json(datos));
  });
}

function renderMatriz(rol: RolUsuarioType) {
  const queryClient = sembrarSesion(
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    { rol },
  );
  const router = createMemoryRouter(
    [
      { path: '/clientes', element: <p>Listado de clientes</p> },
      { path: '/clientes/:id/matriz', element: <MatrizPage /> },
    ],
    {
      initialEntries: [
        { pathname: `/clientes/${ID}/matriz`, state: stateDeListado('?q=muni&sector=PUBLICO') },
      ],
    },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

const AVISO_INACTIVO = 'Este cliente debe estar activo para modificar sus requisitos.';
const PISTA_DE_ALTA = 'La factura también se configura como un requisito. No se agrega sola.';

const botonAgregar = () => screen.queryByRole('button', { name: 'Agregar requisito' });
const menuDelRequisito = () => screen.queryByRole('button', { name: 'Acciones de Zócalo' });
const botonesEditarEnLaFicha = () =>
  screen.queryAllByRole('button', { name: /^Editar en la ficha del cliente/ });

/** Espera a que estén la matriz y las dos notas. */
async function esperarPantalla() {
  await screen.findByRole('heading', { level: 1, name: 'Muni Ejemplo' });
  await screen.findByText('Un PDF por factura.');
  await screen.findByText('Pagan a 60 días.');
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('MatrizPage con CONSULTA', () => {
  it('lee el cliente, la matriz y las dos notas, sin ninguna acción de escritura', async () => {
    servir();
    renderMatriz('CONSULTA');
    await esperarPantalla();

    expect(screen.getAllByText('Zócalo').length).toBeGreaterThan(0);
    expect(screen.getByText('Con requisitos cargados')).toBeInTheDocument();
    expect(botonAgregar()).not.toBeInTheDocument();
    expect(menuDelRequisito()).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).not.toBeInTheDocument();
    expect(botonesEditarEnLaFicha()).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('un cliente inactivo se lee sin el aviso de "debe estar activo": su rol no edita igual', async () => {
    servir({ ...cliente, estado: 'INACTIVO' });
    renderMatriz('CONSULTA');
    await esperarPantalla();

    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.queryByText(AVISO_INACTIVO)).not.toBeInTheDocument();
    expect(screen.getAllByText('Zócalo').length).toBeGreaterThan(0);
  });

  it('una matriz vacía lo dice sin instrucciones para configurarla', async () => {
    servir({ ...cliente, matrizConfigurada: false }, []);
    renderMatriz('CONSULTA');
    await esperarPantalla();

    expect(
      screen.getByRole('heading', { name: 'Este cliente todavía no tiene requisitos' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(PISTA_DE_ALTA)).not.toBeInTheDocument();
    expect(botonAgregar()).not.toBeInTheDocument();
  });

  it('conserva "Volver a clientes" con los filtros del listado', async () => {
    servir();
    const { router, user } = renderMatriz('CONSULTA');
    await esperarPantalla();

    await user.click(screen.getByRole('link', { name: 'Volver a clientes' }));

    expect(router.state.location.pathname).toBe('/clientes');
    expect(router.state.location.search).toBe('?q=muni&sector=PUBLICO');
  });

  it('al abrir la pantalla solo hace lecturas', async () => {
    servir();
    renderMatriz('CONSULTA');
    await esperarPantalla();

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  // Integración con el bloque 3: la sección de rendiciones de la matriz también es de lectura.
  it.each(['ACTIVO', 'INACTIVO'] as const)(
    'con el cliente %s, las rendiciones se listan sin "Abrir rendición" ni el aviso de inactivo',
    async (estado) => {
      servir({ ...cliente, estado });
      renderMatriz('CONSULTA');
      await esperarPantalla();

      expect(screen.getByRole('heading', { name: 'Rendiciones' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Abrir rendición/ })).not.toBeInTheDocument();
      expect(
        screen.queryByText('El cliente no está activo: no se pueden abrir rendiciones nuevas.'),
      ).not.toBeInTheDocument();
    },
  );
});

describe.each(['ADMINISTRATIVO', 'ADMINISTRADOR'] as const)('MatrizPage con %s', (rol) => {
  it('conserva el alta, el menú de cada requisito y la edición de las notas', async () => {
    servir();
    renderMatriz(rol);
    await esperarPantalla();

    expect(botonAgregar()).toBeInTheDocument();
    expect(menuDelRequisito()).toBeInTheDocument();
    expect(botonesEditarEnLaFicha()).toHaveLength(2);
  });

  it('con el cliente inactivo conserva el aviso y no ofrece modificar requisitos', async () => {
    servir({ ...cliente, estado: 'INACTIVO' });
    renderMatriz(rol);
    await esperarPantalla();

    expect(screen.getByText(AVISO_INACTIVO)).toBeInTheDocument();
    expect(botonAgregar()).not.toBeInTheDocument();
    expect(menuDelRequisito()).not.toBeInTheDocument();
    // Las notas se editan con el cliente en cualquier estado.
    expect(botonesEditarEnLaFicha()).toHaveLength(2);
  });

  it('una matriz vacía conserva la indicación de cómo configurarla', async () => {
    servir({ ...cliente, matrizConfigurada: false }, []);
    renderMatriz(rol);
    await esperarPantalla();

    expect(screen.getByText(PISTA_DE_ALTA)).toBeInTheDocument();
    expect(botonAgregar()).toBeInTheDocument();
  });
});
