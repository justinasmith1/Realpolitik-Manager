import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

import {
  etiquetasEmisor,
  TEXTO_EMISOR_PENDIENTE,
  TEXTO_EMISOR_SIN_ASIGNAR,
} from '@/modules/clientes/clientes.etiquetas';
import { NuevoClienteSheet } from '@/modules/clientes/components/NuevoClienteSheet';
import { elegirOpcion } from '@/test/select';

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Datos ficticios.
const clienteCreado = {
  id: 'c3d4e5f6-a7b8-4901-8def-012345678901',
  razonSocial: 'Empresa de Ejemplo S.A.',
  denominacion: 'Empresa Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PRIVADO',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@empresa.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

function renderAlta() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NuevoClienteSheet abierto onAbiertoChange={vi.fn()} onCreado={vi.fn()} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta);

async function completarPrivado(user: UserEvent) {
  await user.type(campo('Razón social'), 'Empresa de Ejemplo S.A.');
  await user.type(campo('Denominación'), 'Empresa Ejemplo');
  await user.type(campo('CUIT'), '30500012745');
  await elegirOpcion(user, campo('Sector'), 'PRIVADO');
  await elegirOpcion(user, campo('Condición frente al IVA'), 'EXENTO');
  await user.type(campo('Email de contacto'), 'compras@empresa.example');
}

function cuerpoEnviado(): unknown {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
}

describe('NuevoClienteSheet: emisor', () => {
  it('arranca en "Sin asignar", con el marcador de pendiente y sin ser obligatorio', () => {
    renderAlta();

    expect(campo('Emisor')).toHaveTextContent(TEXTO_EMISOR_SIN_ASIGNAR);
    expect(screen.getByText(TEXTO_EMISOR_PENDIENTE)).toBeInTheDocument();
    expect(campo('Emisor')).not.toBeRequired();
  });

  it('registra un cliente sin emisor sin bloquearlo y sin enviar la clave', async () => {
    fetchMock.mockResolvedValue(jsonResponse(clienteCreado, 201));
    const user = renderAlta();

    await completarPrivado(user);
    await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));

    expect(cuerpoEnviado()).not.toHaveProperty('emisor');
  });

  it.each(['PERSONA_FISICA', 'SOCIEDAD'] as const)(
    'registra un cliente con el emisor %s elegido',
    async (emisor) => {
      fetchMock.mockResolvedValue(jsonResponse({ ...clienteCreado, emisor }, 201));
      const user = renderAlta();

      await completarPrivado(user);
      await elegirOpcion(user, campo('Emisor'), emisor);
      expect(campo('Emisor')).toHaveTextContent(etiquetasEmisor[emisor]);
      await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));

      expect(cuerpoEnviado()).toMatchObject({ emisor });
    },
  );
});
