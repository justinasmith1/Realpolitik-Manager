import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { ClientesPage } from '@/modules/clientes/pages/ClientesPage';
import { elegirOpcion } from '@/test/select';

// Flujo completo con el hook y el localStorage reales de jsdom: nada de preferencias simuladas.

const CLAVE = 'realpolitik-manager:table-columns:v1:clientes:anonymous';
const DEFAULTS = [
  'Cliente',
  'CUIT',
  'Sector',
  'Subtipo',
  'Email de contacto',
  'Canal',
  'Periodicidad',
  'Acciones',
];

const comunes = {
  denominacion: 'Ejemplo',
  ivaCondicion: 'EXENTO',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: null,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};
const activo = {
  ...comunes,
  id: '11111111-1111-4111-a111-111111111111',
  razonSocial: 'Activa S.A.',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  emailContacto: 'activa@ejemplo.example',
  estado: 'ACTIVO',
};
const inactivo = {
  ...comunes,
  id: '22222222-2222-4222-a222-222222222222',
  razonSocial: 'Inactiva S.A.',
  cuit: '30-50001274-5',
  sector: 'PRIVADO',
  emailContacto: 'inactiva@ejemplo.example',
  estado: 'INACTIVO',
};

const fetchMock = vi.fn<typeof fetch>();
const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

beforeEach(() => {
  window.localStorage.clear();
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((entrada) => {
    const estado = new URL(urlDe(entrada)).searchParams.get('estado');
    const cuerpo = estado === 'INACTIVO' ? [inactivo] : [activo];
    return Promise.resolve(
      new Response(JSON.stringify(cuerpo), { headers: { 'Content-Type': 'application/json' } }),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/** Monta la página como al entrar (o al volver a abrir el navegador). */
async function abrirPagina(url = '/clientes') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const vista = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <ClientesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('table', { name: 'Clientes' });
  return { ...vista, user: userEvent.setup() };
}

const encabezados = () => screen.getAllByRole('columnheader').map((th) => th.textContent);
const guardado = () => window.localStorage.getItem(CLAVE);

async function abrirPicker(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Columnas' }));
  return within(await screen.findByRole('dialog', { name: 'Columnas visibles' }));
}

async function cerrarPicker(user: UserEvent) {
  await user.keyboard('{Escape}');
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('ClientesPage: columnas de la tabla', () => {
  it('ocultar, persistir entre montajes, reordenar y restablecer', async () => {
    // Primera visita: defaults y nada guardado.
    const primera = await abrirPagina();
    expect(encabezados()).toEqual(DEFAULTS);
    expect(guardado()).toBeNull();

    // Ocultar Email: la tabla cambia en el momento y se guarda.
    let picker = await abrirPicker(primera.user);
    await primera.user.click(picker.getByRole('checkbox', { name: 'Email de contacto' }));
    expect(encabezados()).not.toContain('Email de contacto');
    expect(screen.queryByText('activa@ejemplo.example')).not.toBeInTheDocument();
    expect(guardado()).toBe(
      '{"version":1,"ids":["cuit","sector","subtipo","canal","periodicidad"]}',
    );
    await cerrarPicker(primera.user);
    primera.unmount();

    // Volver a entrar: Email sigue oculto.
    const segunda = await abrirPagina();
    expect(encabezados()).toEqual([
      'Cliente',
      'CUIT',
      'Sector',
      'Subtipo',
      'Canal',
      'Periodicidad',
      'Acciones',
    ]);

    // Cambiar el orden: ocultar y volver a mostrar CUIT la lleva al final.
    picker = await abrirPicker(segunda.user);
    await segunda.user.click(picker.getByRole('checkbox', { name: 'CUIT' }));
    await segunda.user.click(picker.getByRole('checkbox', { name: 'CUIT' }));
    expect(encabezados()).toEqual([
      'Cliente',
      'Sector',
      'Subtipo',
      'Canal',
      'Periodicidad',
      'CUIT',
      'Acciones',
    ]);
    expect(guardado()).toBe(
      '{"version":1,"ids":["sector","subtipo","canal","periodicidad","cuit"]}',
    );

    // Restablecer: defaults, la clave desaparece y el panel sigue abierto.
    await segunda.user.click(picker.getByRole('button', { name: 'Restablecer' }));
    expect(encabezados()).toEqual(DEFAULTS);
    expect(guardado()).toBeNull();
    expect(window.localStorage).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Columnas visibles' })).toBeInTheDocument();
    expect(picker.getByRole('button', { name: 'Restablecer' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('sin columnas opcionales quedan Cliente y Acciones, y así se recuerda', async () => {
    const primera = await abrirPagina();
    const picker = await abrirPicker(primera.user);
    for (const nombre of DEFAULTS.slice(1, -1)) {
      await primera.user.click(picker.getByRole('checkbox', { name: nombre }));
    }

    expect(encabezados()).toEqual(['Cliente', 'Acciones']);
    expect(guardado()).toBe('{"version":1,"ids":[]}');
    expect(picker.getByText('0/6')).toBeInTheDocument();
    await cerrarPicker(primera.user);
    primera.unmount();

    const segunda = await abrirPagina();
    expect(encabezados()).toEqual(['Cliente', 'Acciones']);
    // Las acciones de la fila siguen disponibles.
    await segunda.user.click(screen.getByRole('button', { name: 'Acciones de Activa S.A.' }));
    expect(await screen.findByRole('menuitem', { name: 'Editar' })).toBeInTheDocument();
  });

  it('pasar de Activos a Inactivos no cambia ni duplica la preferencia', async () => {
    window.localStorage.setItem(CLAVE, '{"version":1,"ids":["email","cuit"]}');
    const { user } = await abrirPagina();
    expect(encabezados()).toEqual(['Cliente', 'Email de contacto', 'CUIT', 'Acciones']);

    await elegirOpcion(user, screen.getByLabelText('Estado'), 'INACTIVO');
    await screen.findByRole('row', { name: /Inactiva S\.A\./ });

    expect(encabezados()).toEqual(['Cliente', 'Email de contacto', 'CUIT', 'Acciones']);
    expect(window.localStorage).toHaveLength(1);
    expect(guardado()).toBe('{"version":1,"ids":["email","cuit"]}');

    await elegirOpcion(user, screen.getByLabelText('Estado'), 'ACTIVO');
    await screen.findByRole('row', { name: /Activa S\.A\./ });
    expect(encabezados()).toEqual(['Cliente', 'Email de contacto', 'CUIT', 'Acciones']);
  });

  it('en layout compacto no hay picker y las tarjetas muestran todos los datos', async () => {
    window.localStorage.setItem(CLAVE, '{"version":1,"ids":[]}');
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/clientes']}>
          <ClientesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const tarjeta = within(await screen.findByRole('listitem'));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Columnas' })).not.toBeInTheDocument();
    expect(tarjeta.getByText('20-12345678-6')).toBeInTheDocument();
    expect(tarjeta.getByText('activa@ejemplo.example')).toBeInTheDocument();
    expect(tarjeta.getByText('Correo')).toBeInTheDocument();
    expect(tarjeta.getByText('Sin configurar')).toBeInTheDocument();
  });
});
