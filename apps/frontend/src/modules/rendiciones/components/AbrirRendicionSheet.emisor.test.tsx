import { Emisor } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

import { etiquetasEmisor } from '@/modules/clientes/clientes.etiquetas';
import { AbrirRendicionSheet } from '@/modules/rendiciones/components/AbrirRendicionSheet';
import {
  AYUDA_EMISOR_DEL_CLIENTE,
  AYUDA_EMISOR_SIN_HABITUAL,
  MENSAJE_EMISOR_OBLIGATORIO,
} from '@/modules/rendiciones/rendiciones.etiquetas';
import {
  CLIENTE_ID,
  errorJson,
  HOY,
  itemJson,
  json,
  OTRA_ID,
  rendicionJson,
} from '@/modules/rendiciones/test/rendiciones.fixtures';
import { elegirOpcion } from '@/test/select';

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

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

const OTRO_CLIENTE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456700';

function renderPanel(emisor?: 'PERSONA_FISICA' | 'SOCIEDAD') {
  const props = {
    onAbiertoChange: vi.fn(),
    onAbierta: vi.fn(),
    onVerRendicion: vi.fn(),
  };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AbrirRendicionSheet
        abierto
        cliente={{ id: CLIENTE_ID, denominacion: 'Muni Ejemplo', emisor }}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), ...props };
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta);
const botonAbrir = () => screen.getByRole('button', { name: 'Abrir rendición' });

async function enviarFactura(user: UserEvent, factura = 'a 1-1') {
  await user.type(campo('Número de factura'), factura);
  await user.click(botonAbrir());
}

/** Cuerpo JSON del único POST enviado. */
function cuerpoEnviado(): unknown {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
}

describe('AbrirRendicionSheet: emisor (HU2.9)', () => {
  it.each(Emisor.options)('viene precargado con el emisor %s del cliente', (emisor) => {
    renderPanel(emisor);

    expect(campo('Emisor')).toHaveTextContent(etiquetasEmisor[emisor]);
    expect(campo('Emisor')).toHaveAccessibleDescription(
      expect.stringContaining(AYUDA_EMISOR_DEL_CLIENTE),
    );
  });

  it('las opciones salen de `etiquetasEmisor`, una por tipo de emisor y ninguna más', async () => {
    const { user } = renderPanel('SOCIEDAD');

    await user.click(campo('Emisor'));
    const opciones = within(await screen.findByRole('listbox'))
      .getAllByRole('option')
      .map((opcion) => opcion.textContent);

    expect(opciones).toEqual(Emisor.options.map((emisor) => etiquetasEmisor[emisor]));
  });

  it('al abrir envía el emisor precargado', async () => {
    fetchMock.mockResolvedValue(json({ ...rendicionJson(), items: [itemJson()] }, 201));
    const { user, onAbierta } = renderPanel('SOCIEDAD');

    await enviarFactura(user);

    await waitFor(() => expect(onAbierta).toHaveBeenCalledTimes(1));
    expect(cuerpoEnviado()).toMatchObject({
      emisor: 'SOCIEDAD',
      numeroFactura: 'A 00001-00000001',
    });
  });

  it('se puede elegir el otro emisor solo para esta rendición: viaja ese y no se toca al cliente', async () => {
    fetchMock.mockResolvedValue(
      json({ ...rendicionJson({ emisor: 'PERSONA_FISICA' }), items: [itemJson()] }, 201),
    );
    const { user, onAbierta } = renderPanel('SOCIEDAD');

    await elegirOpcion(user, campo('Emisor'), 'PERSONA_FISICA');
    expect(campo('Emisor')).toHaveTextContent(etiquetasEmisor.PERSONA_FISICA);
    await enviarFactura(user);

    await waitFor(() => expect(onAbierta).toHaveBeenCalledTimes(1));
    expect(cuerpoEnviado()).toMatchObject({ emisor: 'PERSONA_FISICA' });
    // Un solo pedido, el alta: no hay un PATCH al cliente.
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.example/clientes/${CLIENTE_ID}/rendiciones`,
    );
  });

  describe('si el cliente no tiene emisor', () => {
    it('el campo arranca vacío y explica que hay que elegir uno', () => {
      renderPanel(undefined);

      expect(campo('Emisor')).not.toHaveTextContent(etiquetasEmisor.PERSONA_FISICA);
      expect(campo('Emisor')).not.toHaveTextContent(etiquetasEmisor.SOCIEDAD);
      expect(campo('Emisor')).toHaveAccessibleDescription(
        expect.stringContaining(AYUDA_EMISOR_SIN_HABITUAL),
      );
    });

    it('es obligatorio: sin elegir marca el campo, le da el foco y no envía nada', async () => {
      const { user } = renderPanel(undefined);

      await enviarFactura(user);

      expect(campo('Emisor')).toHaveAccessibleDescription(
        expect.stringContaining(MENSAJE_EMISOR_OBLIGATORIO),
      );
      expect(campo('Emisor')).toHaveFocus();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('con el emisor elegido se abre y viaja ese emisor', async () => {
      fetchMock.mockResolvedValue(
        json({ ...rendicionJson({ emisor: 'PERSONA_FISICA' }), items: [itemJson()] }, 201),
      );
      const { user, onAbierta } = renderPanel(undefined);

      await elegirOpcion(user, campo('Emisor'), 'PERSONA_FISICA');
      await enviarFactura(user);

      await waitFor(() => expect(onAbierta).toHaveBeenCalledTimes(1));
      expect(cuerpoEnviado()).toMatchObject({ emisor: 'PERSONA_FISICA' });
    });

    it('el error del servidor en `emisor` se muestra debajo del campo y le da el foco', async () => {
      fetchMock.mockResolvedValue(
        errorJson(400, 'VALIDATION_ERROR', [
          {
            campo: 'emisor',
            mensaje: 'Elegí el emisor de la factura: el cliente no tiene uno asignado.',
          },
        ]),
      );
      // El cliente de la pantalla estaba desactualizado: creía que tenía emisor.
      const { user } = renderPanel('SOCIEDAD');

      await enviarFactura(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Algunos datos no son válidos. Revisá los campos marcados.',
      );
      expect(campo('Emisor')).toHaveAccessibleDescription(
        expect.stringContaining('Elegí el emisor de la factura: el cliente no tiene uno asignado.'),
      );
      expect(campo('Emisor')).toHaveFocus();
    });
  });

  describe('409 RENDICION_DUPLICADA (el número ya existe para este emisor)', () => {
    const existente = {
      id: OTRA_ID,
      clienteId: OTRO_CLIENTE_ID,
      anio: 2026,
      mes: 9,
      numeroFactura: 'A 00001-00000001',
    };

    it('lo dice debajo del número con el texto "para este emisor" y en el aviso general', async () => {
      fetchMock.mockResolvedValue(
        errorJson(409, 'CONFLICT', {
          motivo: 'RENDICION_DUPLICADA',
          rendicionExistente: existente,
        }),
      );
      const { user } = renderPanel('SOCIEDAD');

      await enviarFactura(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Ya hay una rendición abierta con la factura A 00001-00000001 (Septiembre 2026) para este emisor.',
      );
      expect(campo('Número de factura')).toHaveAccessibleDescription(
        expect.stringContaining('Ese número de factura ya existe para este emisor.'),
      );
    });

    it('"Ver rendición" lleva a la existente con SU cliente, aunque no sea el actual', async () => {
      fetchMock.mockResolvedValue(
        errorJson(409, 'CONFLICT', {
          motivo: 'RENDICION_DUPLICADA',
          rendicionExistente: existente,
        }),
      );
      const { user, onVerRendicion, onAbierta } = renderPanel('SOCIEDAD');

      await enviarFactura(user);
      await user.click(await screen.findByRole('button', { name: 'Ver rendición' }));

      expect(onVerRendicion).toHaveBeenCalledWith({
        rendicionId: OTRA_ID,
        clienteId: OTRO_CLIENTE_ID,
      });
      expect(onAbierta).not.toHaveBeenCalled();
    });

    it('si el 409 no trae el clienteId, no ofrece un enlace que podría dar 404', async () => {
      const { clienteId: _omitido, ...sinCliente } = existente;
      fetchMock.mockResolvedValue(
        errorJson(409, 'CONFLICT', {
          motivo: 'RENDICION_DUPLICADA',
          rendicionExistente: sinCliente,
        }),
      );
      const { user } = renderPanel('SOCIEDAD');

      await enviarFactura(user);

      await waitFor(() =>
        expect(campo('Número de factura')).toHaveAccessibleDescription(
          expect.stringContaining('Ese número de factura ya existe para este emisor.'),
        ),
      );
      expect(screen.queryByRole('button', { name: 'Ver rendición' })).not.toBeInTheDocument();
    });
  });
});
