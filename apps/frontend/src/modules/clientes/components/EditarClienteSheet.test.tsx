import type { Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditarClienteSheet } from '@/modules/clientes/components/EditarClienteSheet';

// La API se simula en `fetch`: el test recorre formulario → mutation → clientes.api → http().
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

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Datos ficticios. El teléfono y los emails adicionales los guarda el servidor pero el
// formulario no los muestra: la edición no debe enviarlos.
const clienteJson = {
  id: 'c3d4e5f6-a7b8-4901-8def-012345678901',
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@municipio.example',
  emailsAdicionales: ['otro@municipio.example'],
  telefono: '+54 11 4000-1234',
  canalEntrega: 'PORTAL_WEB',
  portalUrl: 'https://portal.ejemplo.gob.ar',
  estado: 'ACTIVO',
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const cliente = {
  ...clienteJson,
  creadoEn: new Date(clienteJson.creadoEn),
  actualizadoEn: new Date(clienteJson.actualizadoEn),
} as Cliente;

function renderEdicion() {
  const onActualizado = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EditarClienteSheet cliente={cliente} onClose={onClose} onActualizado={onActualizado} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onActualizado, onClose };
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta);
const botonGuardar = () => screen.getByRole('button', { name: 'Guardar cambios' });

/** Cuerpo JSON del único PATCH enviado. */
function cuerpoEnviado(): unknown {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(init?.body as string);
}

describe('EditarClienteSheet', () => {
  it('abre un panel "Editar cliente" precargado con los datos del cliente', () => {
    renderEdicion();

    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument();
    expect(campo('Razón social')).toHaveValue('Municipio de Ejemplo');
    expect(campo('Denominación')).toHaveValue('Muni Ejemplo');
    expect(campo('CUIT')).toHaveValue('30-50001274-5');
    expect(campo('Sector')).toHaveValue('PUBLICO');
    expect(campo('Subtipo público')).toHaveValue('MUNICIPAL');
    expect(campo('Condición frente al IVA')).toHaveValue('EXENTO');
    expect(campo('Email de contacto')).toHaveValue('compras@municipio.example');
    expect(campo('Canal de entrega')).toHaveValue('PORTAL_WEB');
    expect(campo('URL del portal')).toHaveValue('https://portal.ejemplo.gob.ar');
    expect(botonGuardar()).toBeInTheDocument();
  });

  it('al guardar hace PATCH /clientes/:id con los campos del formulario y nada más', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...clienteJson, razonSocial: 'Municipio Renombrado' }, 200),
    );
    const { user, onActualizado } = renderEdicion();

    await user.clear(campo('Razón social'));
    await user.type(campo('Razón social'), 'Municipio Renombrado');
    await user.click(botonGuardar());

    await vi.waitFor(() => expect(onActualizado).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.example/clientes/${cliente.id}`);
    expect(init?.method).toBe('PATCH');
    // No viajan ni el teléfono ni los emails adicionales: el servidor los conserva.
    expect(cuerpoEnviado()).toEqual({
      razonSocial: 'Municipio Renombrado',
      denominacion: 'Muni Ejemplo',
      cuit: '30-50001274-5',
      sector: 'PUBLICO',
      subtipo: 'MUNICIPAL',
      ivaCondicion: 'EXENTO',
      emailContacto: 'compras@municipio.example',
      canalEntrega: 'PORTAL_WEB',
      portalUrl: 'https://portal.ejemplo.gob.ar',
    });
    expect(onActualizado).toHaveBeenCalledWith(
      expect.objectContaining({ razonSocial: 'Municipio Renombrado' }),
    );
  });

  it('con un CUIT inválido marca el campo y no envía nada', async () => {
    const { user, onActualizado } = renderEdicion();

    await user.clear(campo('CUIT'));
    await user.type(campo('CUIT'), '30-50001274-6');
    await user.click(botonGuardar());

    expect(
      screen.getByText(
        'El CUIT ingresado no es válido (dígito verificador incorrecto o prefijo inválido).',
      ),
    ).toBeInTheDocument();
    expect(campo('CUIT')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onActualizado).not.toHaveBeenCalled();
  });

  it('con un CUIT de otro cliente muestra cuál lo tiene y queda abierto con los datos', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'CONFLICT',
            message: 'Ya existe un cliente con ese CUIT',
            details: {
              motivo: 'CUIT_DUPLICADO',
              clienteExistente: {
                id: 'd4e5f6a7-b8c9-4012-9ef0-123456789012',
                razonSocial: 'Cliente Existente S.A.',
                estado: 'INACTIVO',
              },
            },
          },
        },
        409,
      ),
    );
    const { user, onActualizado } = renderEdicion();

    await user.clear(campo('CUIT'));
    await user.type(campo('CUIT'), '20-12345678-6');
    await user.click(botonGuardar());

    expect(
      await screen.findByText(
        'Ya existe un cliente registrado con este CUIT: Cliente Existente S.A. (inactivo).',
      ),
    ).toBeInTheDocument();
    expect(campo('CUIT')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('CUIT')).toHaveValue('20-12345678-6');
    expect(campo('Razón social')).toHaveValue('Municipio de Ejemplo');
    expect(onActualizado).not.toHaveBeenCalled();
  });

  it('ante un error inesperado muestra un mensaje genérico y no cierra', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500));
    const { user, onActualizado, onClose } = renderEdicion();

    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos guardar los cambios. Probá de nuevo en unos segundos.',
    );
    expect(onActualizado).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
