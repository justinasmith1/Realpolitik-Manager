import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

import { NuevoClienteSheet } from '@/modules/clientes/components/NuevoClienteSheet';

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

/** Respuesta 201 de la API con los datos ya normalizados (datos ficticios). */
const clienteCreado = {
  id: 'c3d4e5f6-a7b8-4901-8def-012345678901',
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@municipio.example',
  emailsAdicionales: [],
  estado: 'ACTIVO',
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

function renderAlta() {
  const onCreado = vi.fn();
  const onAbiertoChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NuevoClienteSheet abierto onAbiertoChange={onAbiertoChange} onCreado={onCreado} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onCreado, onAbiertoChange };
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta);
const botonRegistrar = () => screen.getByRole('button', { name: 'Registrar cliente' });

interface Datos {
  razonSocial?: string;
  denominacion?: string;
  cuit?: string;
  sector?: 'PUBLICO' | 'PRIVADO';
  subtipo?: string;
  iva?: string;
  email?: string;
}

/** Completa el formulario con un cliente público válido, salvo lo que se indique. */
async function completar(user: UserEvent, datos: Datos = {}) {
  const valores = {
    razonSocial: '  Municipio de Ejemplo  ',
    denominacion: 'Muni Ejemplo',
    cuit: '30500012745',
    sector: 'PUBLICO',
    subtipo: 'MUNICIPAL',
    iva: 'EXENTO',
    email: 'Compras@Municipio.Example',
    ...datos,
  };
  // Un texto vacío deja el campo como está (user.type no admite '').
  const escribir = async (etiqueta: string, texto: string) => {
    if (texto !== '') {
      await user.type(campo(etiqueta), texto);
    }
  };
  await escribir('Razón social', valores.razonSocial);
  await escribir('Denominación', valores.denominacion);
  await escribir('CUIT', valores.cuit);
  await user.selectOptions(campo('Sector'), valores.sector);
  if (valores.sector === 'PUBLICO' && valores.subtipo !== '') {
    await user.selectOptions(campo('Subtipo público'), valores.subtipo);
  }
  await user.selectOptions(campo('Condición frente al IVA'), valores.iva);
  await escribir('Email de contacto', valores.email);
}

/** Cuerpo JSON del único POST enviado. */
function cuerpoEnviado(): unknown {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(init?.body as string);
}

describe('NuevoClienteSheet', () => {
  it('muestra un panel "Nuevo cliente" con solo los campos de HU1.1', () => {
    renderAlta();

    expect(screen.getByRole('dialog', { name: 'Nuevo cliente' })).toBeInTheDocument();
    for (const etiqueta of [
      'Razón social',
      'Denominación',
      'CUIT',
      'Sector',
      'Condición frente al IVA',
      'Email de contacto',
    ]) {
      expect(campo(etiqueta)).toBeInTheDocument();
    }
    // El subtipo aparece recién al elegir Público.
    expect(screen.queryByLabelText('Subtipo público')).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.queryByLabelText(/teléfono|portal|estado|periodicidad/i)).not.toBeInTheDocument();
  });

  it('muestra las opciones con nombres legibles y sin una elegida de antemano', () => {
    renderAlta();

    expect(campo('Sector')).toHaveValue('');
    expect(campo('Condición frente al IVA')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Público' })).toHaveValue('PUBLICO');
    expect(screen.getByRole('option', { name: 'Responsable inscripto' })).toHaveValue(
      'RESPONSABLE_INSCRIPTO',
    );
  });

  it('con el formulario vacío marca cada dato faltante y no envía nada', async () => {
    const { user } = renderAlta();

    await user.click(botonRegistrar());

    for (const mensaje of [
      'Ingresá la razón social.',
      'Ingresá la denominación.',
      'Ingresá el CUIT.',
      'Elegí el sector.',
      'Elegí la condición frente al IVA.',
      'Ingresá el email de contacto.',
    ]) {
      expect(screen.getByText(mensaje)).toBeInTheDocument();
    }
    expect(campo('Razón social')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('Razón social')).toHaveAccessibleDescription('Ingresá la razón social.');
    expect(campo('Razón social')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechaza un texto de solo espacios como dato faltante', async () => {
    const { user } = renderAlta();

    await completar(user, { razonSocial: '   ' });
    await user.click(botonRegistrar());

    expect(screen.getByText('Ingresá la razón social.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('avisa que el CUIT es inválido al salir del campo y no permite enviar', async () => {
    const { user } = renderAlta();
    const mensaje =
      'El CUIT ingresado no es válido (dígito verificador incorrecto o prefijo inválido).';

    await user.type(campo('CUIT'), '20-12345678-5');
    await user.tab();

    expect(screen.getByText(mensaje)).toBeInTheDocument();
    expect(campo('CUIT')).toHaveAttribute('aria-invalid', 'true');

    await completar(user, { cuit: '' });
    await user.click(botonRegistrar());

    expect(screen.getByText(mensaje)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechaza un email con formato inválido', async () => {
    const { user } = renderAlta();

    await completar(user, { email: 'no-es-un-email' });
    await user.click(botonRegistrar());

    expect(
      screen.getByText('El email de contacto no tiene un formato válido.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('para un cliente público pide el subtipo', async () => {
    const { user } = renderAlta();

    await completar(user, { subtipo: '' });
    expect(campo('Subtipo público')).toHaveValue('');
    await user.click(botonRegistrar());

    expect(screen.getByText('Elegí el subtipo.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('al pasar a privado descarta el subtipo elegido y no lo envía', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...clienteCreado, sector: 'PRIVADO', subtipo: undefined }, 201),
    );
    const { user } = renderAlta();

    await completar(user, { sector: 'PUBLICO', subtipo: 'SINDICAL_OBRA_SOCIAL' });
    await user.selectOptions(campo('Sector'), 'PRIVADO');
    expect(screen.queryByLabelText('Subtipo público')).not.toBeInTheDocument();

    // Si vuelve a público, el subtipo anterior no reaparece.
    await user.selectOptions(campo('Sector'), 'PUBLICO');
    expect(campo('Subtipo público')).toHaveValue('');

    await user.selectOptions(campo('Sector'), 'PRIVADO');
    await user.click(botonRegistrar());

    expect(cuerpoEnviado()).not.toHaveProperty('subtipo');
  });

  it('envía solo los datos de HU1.1, normalizados por shared, y entrega el cliente creado', async () => {
    fetchMock.mockResolvedValue(jsonResponse(clienteCreado, 201));
    const { user, onCreado } = renderAlta();

    await completar(user);
    await user.click(botonRegistrar());

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example/clientes');
    expect(init?.method).toBe('POST');
    // Igualdad exacta: sin estado, id, fechas, emailsAdicionales ni otros campos.
    expect(cuerpoEnviado()).toEqual({
      razonSocial: 'Municipio de Ejemplo',
      denominacion: 'Muni Ejemplo',
      cuit: '30-50001274-5',
      sector: 'PUBLICO',
      subtipo: 'MUNICIPAL',
      ivaCondicion: 'EXENTO',
      emailContacto: 'compras@municipio.example',
    });
    expect(onCreado).toHaveBeenCalledTimes(1);
    expect(onCreado).toHaveBeenCalledWith(
      expect.objectContaining({ id: clienteCreado.id, cuit: '30-50001274-5', estado: 'ACTIVO' }),
    );
  });

  it('mientras guarda deshabilita el envío y no lo repite', async () => {
    let responder: (respuesta: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        responder = resolve;
      }),
    );
    const { user, onCreado } = renderAlta();

    await completar(user);
    await user.click(botonRegistrar());

    const guardando = screen.getByRole('button', { name: 'Guardando…' });
    expect(guardando).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await user.click(guardando);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    responder(jsonResponse(clienteCreado, 201));
    await vi.waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
  });

  it('con CUIT duplicado muestra qué cliente lo tiene y conserva el formulario', async () => {
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
    const { user, onCreado, onAbiertoChange } = renderAlta();

    await completar(user);
    await user.click(botonRegistrar());

    const mensaje =
      'Ya existe un cliente registrado con este CUIT: Cliente Existente S.A. (inactivo).';
    expect(await screen.findByText(mensaje)).toBeInTheDocument();
    expect(campo('CUIT')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('CUIT')).toHaveFocus();
    expect(campo('Razón social')).toHaveValue('  Municipio de Ejemplo  ');
    expect(screen.getByRole('dialog', { name: 'Nuevo cliente' })).toBeInTheDocument();
    expect(onCreado).not.toHaveBeenCalled();
    expect(onAbiertoChange).not.toHaveBeenCalled();
  });

  it('si el servidor rechaza datos, marca los campos indicados', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Los datos enviados no son válidos',
            details: [{ campo: 'cuit', mensaje: 'Required' }],
          },
        },
        400,
      ),
    );
    const { user } = renderAlta();

    await completar(user);
    await user.click(botonRegistrar());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Algunos datos no son válidos. Revisá los campos marcados.',
    );
    expect(campo('CUIT')).toHaveAccessibleDescription(expect.stringContaining('Revisá este dato.'));
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
  });

  it.each([
    [
      'un error del servidor',
      () => fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 })),
    ],
    ['un fallo de red', () => fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
  ])(
    'ante %s avisa sin detalles técnicos, conserva los datos y permite reintentar',
    async (_caso, fallar) => {
      fallar();
      const { user, onCreado } = renderAlta();

      await completar(user);
      await user.click(botonRegistrar());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'No pudimos registrar el cliente. Probá de nuevo en unos segundos.',
      );
      expect(screen.queryByText(/boom|Failed to fetch|HTTP 500/)).not.toBeInTheDocument();
      expect(campo('Email de contacto')).toHaveValue('Compras@Municipio.Example');
      expect(onCreado).not.toHaveBeenCalled();

      fetchMock.mockResolvedValueOnce(jsonResponse(clienteCreado, 201));
      await user.click(botonRegistrar());

      await vi.waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('Cancelar pide cerrar el panel', async () => {
    const { user, onAbiertoChange } = renderAlta();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onAbiertoChange).toHaveBeenCalledWith(false);
  });
});
