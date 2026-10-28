import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

import { NuevoClienteSheet } from '@/modules/clientes/components/NuevoClienteSheet';
import { elegirOpcion } from '@/test/select';

// La pausa de éxito (500 ms) no es el tema de estos tests: se prueba en `*.exito.test.tsx`.
vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

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
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
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
  await elegirOpcion(user, campo('Sector'), valores.sector);
  if (valores.sector === 'PUBLICO' && valores.subtipo !== '') {
    await elegirOpcion(user, campo('Subtipo público'), valores.subtipo);
  }
  await elegirOpcion(user, campo('Condición frente al IVA'), valores.iva);
  await escribir('Email de contacto', valores.email);
}

/** Cuerpo JSON del único POST enviado. */
function cuerpoEnviado(): unknown {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(init?.body as string);
}

describe('NuevoClienteSheet', () => {
  it('muestra un panel "Nuevo cliente" con solo los campos del alta', () => {
    renderAlta();

    expect(screen.getByRole('dialog', { name: 'Nuevo cliente' })).toBeInTheDocument();
    for (const etiqueta of [
      'Razón social',
      'Denominación',
      'CUIT',
      'Sector',
      'Condición frente al IVA',
      'Email de contacto',
      'Canal principal',
      'Periodicidad',
    ]) {
      expect(campo(etiqueta)).toBeInTheDocument();
    }
    // El subtipo aparece recién al elegir Público.
    expect(screen.queryByLabelText('Subtipo público')).not.toBeInTheDocument();
    // Portal web y WhatsApp aparecen según el canal elegido (por defecto es Correo).
    expect(screen.queryByLabelText('URL del portal')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Número de WhatsApp')).not.toBeInTheDocument();
    // Los cuatro campos de texto del alta, más las indicaciones de armado y las observaciones.
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
    expect(screen.getAllByRole('combobox')).toHaveLength(4);
    expect(screen.queryByLabelText(/teléfono|estado/i)).not.toBeInTheDocument();
  });

  it('muestra las opciones con nombres legibles y sin una elegida de antemano', async () => {
    const { user } = renderAlta();

    expect(campo('Sector')).toHaveTextContent('Elegí el sector');
    expect(campo('Condición frente al IVA')).toHaveTextContent('Elegí la condición');

    await user.click(campo('Sector'));
    expect(
      within(await screen.findByRole('listbox'))
        .getAllByRole('option')
        .map((opcion) => opcion.textContent),
    ).toEqual(['Público', 'Privado']);
    await user.keyboard('{Escape}');

    await user.click(campo('Condición frente al IVA'));
    expect(
      within(await screen.findByRole('listbox'))
        .getAllByRole('option')
        .map((opcion) => opcion.textContent),
    ).toContain('Responsable inscripto');
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
    expect(campo('Subtipo público')).toHaveTextContent('Elegí el subtipo');
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
    await elegirOpcion(user, campo('Sector'), 'PRIVADO');
    expect(screen.queryByLabelText('Subtipo público')).not.toBeInTheDocument();

    // Si vuelve a público, el subtipo anterior no reaparece.
    await elegirOpcion(user, campo('Sector'), 'PUBLICO');
    expect(campo('Subtipo público')).toHaveTextContent('Elegí el subtipo');

    await elegirOpcion(user, campo('Sector'), 'PRIVADO');
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
      canalEntrega: 'CORREO',
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

    const registrando = screen.getByRole('button', { name: 'Registrando…' });
    expect(registrando).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await user.click(registrando);
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

// ─── Periodicidad de rendición (HU1.5) ────────────────────────────────────────

describe('NuevoClienteSheet: periodicidad', () => {
  const periodicidad = () => campo('Periodicidad');
  const diaLimite = () => campo('Día límite');
  const mesInicio = () => campo('Mes de inicio del ciclo');

  /** Envía un alta válida y devuelve el cuerpo del POST. */
  async function registrarYLeerCuerpo(user: UserEvent) {
    await user.click(botonRegistrar());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    return cuerpoEnviado() as Record<string, unknown>;
  }

  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse(clienteCreado, 201));
  });

  it('arranca en "Sin configurar", opcional, sin día ni mes', async () => {
    const { user } = renderAlta();

    expect(periodicidad()).toHaveTextContent('Sin configurar');
    expect(periodicidad()).not.toBeRequired();
    expect(screen.getByText('Opcional')).toBeInTheDocument();
    expect(periodicidad()).toHaveAccessibleDescription(
      'Cada cuánto se rinde. Podés configurarla más adelante.',
    );
    expect(screen.queryByLabelText('Día límite')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mes de inicio del ciclo')).not.toBeInTheDocument();
    // Las opciones se muestran con su nombre, no con el valor técnico.
    await user.click(periodicidad());
    expect(
      within(await screen.findByRole('listbox'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Sin configurar', 'Mensual', 'Bimestral', 'Por campaña']);
  });

  it('sin periodicidad, el alta no envía la clave (ni null ni campos del formulario)', async () => {
    const { user } = renderAlta();

    await completar(user);
    const cuerpo = await registrarYLeerCuerpo(user);

    expect(cuerpo).not.toHaveProperty('periodicidad');
    for (const auxiliar of [
      'periodicidadTipo',
      'periodicidadDiaLimite',
      'periodicidadMesInicioCiclo',
    ]) {
      expect(cuerpo).not.toHaveProperty(auxiliar);
    }
  });

  it.each([
    ['MENSUAL', 'Mensual'],
    ['POR_CAMPANIA', 'Por campaña'],
  ] as const)(
    '%s muestra solo el día límite y envía el día como número y el mes en null',
    async (tipo, _etiqueta) => {
      const { user } = renderAlta();

      await completar(user);
      await elegirOpcion(user, periodicidad(), tipo);
      expect(diaLimite()).toBeRequired();
      expect(screen.queryByLabelText('Mes de inicio del ciclo')).not.toBeInTheDocument();
      await user.type(diaLimite(), '10');
      const cuerpo = await registrarYLeerCuerpo(user);

      expect(cuerpo.periodicidad).toStrictEqual({ tipo, diaLimite: 10, mesInicioCiclo: null });
      expect(cuerpo).not.toHaveProperty('periodicidadDiaLimite');
    },
  );

  it('BIMESTRAL muestra día y mes, y envía ambos como números', async () => {
    const { user } = renderAlta();

    await completar(user);
    await elegirOpcion(user, periodicidad(), 'BIMESTRAL');
    expect(mesInicio()).toBeRequired();
    expect(mesInicio()).toHaveTextContent('Elegí el mes');
    await user.type(diaLimite(), '28');
    await elegirOpcion(user, mesInicio(), 'Marzo');
    const cuerpo = await registrarYLeerCuerpo(user);

    expect(cuerpo.periodicidad).toStrictEqual({
      tipo: 'BIMESTRAL',
      diaLimite: 28,
      mesInicioCiclo: 3,
    });
  });

  it('con un tipo elegido pide el día límite', async () => {
    const { user } = renderAlta();

    await completar(user);
    await elegirOpcion(user, periodicidad(), 'MENSUAL');
    await user.click(botonRegistrar());

    expect(screen.getByText('Ingresá el día límite.')).toBeInTheDocument();
    expect(diaLimite()).toHaveAttribute('aria-invalid', 'true');
    expect(diaLimite()).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // La regla es de shared; acá solo se comprueba que el formulario no redondea ni interpreta.
  it.each(['0', '29', '10.5', 'diez', '1e1'])(
    'rechaza el día límite "%s" con el mensaje de shared y no envía',
    async (dia) => {
      const { user } = renderAlta();

      await completar(user);
      await elegirOpcion(user, periodicidad(), 'MENSUAL');
      await user.type(diaLimite(), dia);
      await user.click(botonRegistrar());

      expect(diaLimite()).toHaveAttribute('aria-invalid', 'true');
      expect(diaLimite()).toHaveAccessibleDescription(
        expect.stringMatching(/El día límite debe (ser un número entero|estar) entre 1 y 28\./),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('BIMESTRAL sin mes marca el mes y no envía', async () => {
    const { user } = renderAlta();

    await completar(user);
    await elegirOpcion(user, periodicidad(), 'BIMESTRAL');
    await user.type(diaLimite(), '10');
    await user.click(botonRegistrar());

    expect(screen.getByText('Elegí el mes de inicio del ciclo.')).toBeInTheDocument();
    expect(mesInicio()).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('al pasar de BIMESTRAL a MENSUAL descarta el mes: no reaparece ni viaja', async () => {
    const { user } = renderAlta();

    await completar(user);
    await elegirOpcion(user, periodicidad(), 'BIMESTRAL');
    await user.type(diaLimite(), '10');
    await elegirOpcion(user, mesInicio(), 'Marzo');
    await elegirOpcion(user, periodicidad(), 'MENSUAL');
    expect(screen.queryByLabelText('Mes de inicio del ciclo')).not.toBeInTheDocument();
    // El día sigue valiendo para el tipo nuevo.
    expect(diaLimite()).toHaveValue('10');

    await elegirOpcion(user, periodicidad(), 'BIMESTRAL');
    expect(mesInicio()).toHaveTextContent('Elegí el mes');
    await elegirOpcion(user, periodicidad(), 'MENSUAL');
    const cuerpo = await registrarYLeerCuerpo(user);

    expect(cuerpo.periodicidad).toStrictEqual({
      tipo: 'MENSUAL',
      diaLimite: 10,
      mesInicioCiclo: null,
    });
  });

  it('al volver a "Sin configurar" se van el día, el mes y sus errores, y no se envía nada', async () => {
    const { user } = renderAlta();

    await completar(user);
    await elegirOpcion(user, periodicidad(), 'BIMESTRAL');
    await user.type(diaLimite(), '29');
    await user.click(botonRegistrar());
    expect(diaLimite()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Elegí el mes de inicio del ciclo.')).toBeInTheDocument();

    await elegirOpcion(user, periodicidad(), '');

    expect(screen.queryByLabelText('Día límite')).not.toBeInTheDocument();
    expect(screen.queryByText(/día límite|mes de inicio/i)).not.toBeInTheDocument();
    // Al volver a elegir un tipo, el día anterior no reaparece.
    await elegirOpcion(user, periodicidad(), 'MENSUAL');
    expect(diaLimite()).toHaveValue('');
    expect(diaLimite()).not.toHaveAttribute('aria-invalid');
    await elegirOpcion(user, periodicidad(), '');

    const cuerpo = await registrarYLeerCuerpo(user);
    expect(cuerpo).not.toHaveProperty('periodicidad');
  });

  it('si el servidor rechaza la periodicidad, marca el campo del formulario que corresponde', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Los datos enviados no son válidos',
            details: [{ campo: 'periodicidad.diaLimite', mensaje: 'Required' }],
          },
        },
        400,
      ),
    );
    const { user } = renderAlta();

    await completar(user);
    await elegirOpcion(user, periodicidad(), 'MENSUAL');
    await user.type(diaLimite(), '10');
    await user.click(botonRegistrar());

    expect(await screen.findByRole('alert')).toHaveTextContent('Algunos datos no son válidos.');
    expect(diaLimite()).toHaveAttribute('aria-invalid', 'true');
    expect(diaLimite()).toHaveAccessibleDescription(expect.stringContaining('Revisá este dato.'));
  });

  it('guarda las indicaciones de armado junto al registrar el nuevo cliente (HU2.4)', async () => {
    fetchMock.mockImplementation((entrada) => {
      const url =
        typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (url.endsWith('/indicaciones-armado')) {
        return Promise.resolve(jsonResponse({ indicacionesArmado: 'Factura primero.' }, 200));
      }
      return Promise.resolve(jsonResponse(clienteCreado, 201));
    });

    const { user, onCreado } = renderAlta();

    await completar(user);
    const textarea = screen.getByPlaceholderText(
      /Escribí aquí cómo exige el cliente armar el legajo/i,
    );
    await user.type(textarea, 'Factura primero.');
    await user.click(botonRegistrar());

    await waitFor(() => {
      expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ id: clienteCreado.id }));
    });

    const llamadas = fetchMock.mock.calls.map(([req]) =>
      typeof req === 'string' ? req : req instanceof URL ? req.href : req.url,
    );
    expect(
      llamadas.some((url) => url.endsWith(`/clientes/${clienteCreado.id}/indicaciones-armado`)),
    ).toBe(true);
  });
});

describe('NuevoClienteSheet: indicaciones de armado (HU2.4)', () => {
  const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
    typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const pedidosDeIndicaciones = () =>
    fetchMock.mock.calls.filter(([entrada]) => urlDe(entrada).endsWith('/indicaciones-armado'));
  const indicaciones = () => screen.getByLabelText('Instrucciones para el legajo');

  /** El alta responde 201; el PUT de indicaciones, lo que se indique. */
  function servirAlta(respuestaIndicaciones: () => Response) {
    fetchMock.mockImplementation((entrada) =>
      Promise.resolve(
        urlDe(entrada).endsWith('/indicaciones-armado')
          ? respuestaIndicaciones()
          : jsonResponse(clienteCreado, 201),
      ),
    );
  }

  async function escribirIndicaciones(user: UserEvent, texto: string) {
    await user.click(indicaciones());
    await user.paste(texto);
  }

  it('sin indicaciones no envía el PUT', async () => {
    servirAlta(() => jsonResponse({ indicacionesArmado: null }, 200));
    const { user, onCreado } = renderAlta();

    await completar(user);
    await user.click(botonRegistrar());

    await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
    expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ id: clienteCreado.id }));
    expect(pedidosDeIndicaciones()).toHaveLength(0);
  });

  it('envía las indicaciones recortadas y avisa el alta sin fallo', async () => {
    servirAlta(() => jsonResponse({ indicacionesArmado: 'Factura primero.' }, 200));
    const { user, onCreado } = renderAlta();

    await completar(user);
    await escribirIndicaciones(user, '  Factura primero.  ');
    await user.click(botonRegistrar());

    await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
    expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ id: clienteCreado.id }));
    const [, init] = pedidosDeIndicaciones()[0] ?? [];
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ indicacionesArmado: 'Factura primero.' });
  });

  it.each([
    [
      400,
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos',
          details: [
            {
              campo: 'indicacionesArmado',
              mensaje: 'Las indicaciones de armado no pueden contener caracteres de control.',
            },
          ],
        },
      },
      'Las indicaciones de armado no pueden contener caracteres de control.',
    ],
    [
      409,
      {
        error: {
          code: 'CONFLICT',
          message: 'El cliente no está activo',
          details: { motivo: 'CLIENTE_NO_ACTIVO', estado: 'INACTIVO' },
        },
      },
      'El cliente está inactivo: reactivalo para editar sus indicaciones.',
    ],
    [
      500,
      { error: { code: 'INTERNAL_ERROR', message: 'Error' } },
      'Probá de nuevo en unos segundos.',
    ],
  ])(
    'si el PUT responde %i, el alta se da por hecha y el motivo llega a quien abrió el panel',
    async (status, cuerpo, motivo) => {
      servirAlta(() => jsonResponse(cuerpo, status));
      const { user, onCreado } = renderAlta();

      await completar(user);
      await escribirIndicaciones(user, 'Factura primero.');
      await user.click(botonRegistrar());

      await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
      expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ id: clienteCreado.id }), {
        motivos: { indicaciones: motivo },
        guardadas: [],
      });
    },
  );

  it('con más de 1000 caracteres marca el límite en el campo y no envía nada', async () => {
    const { user, onCreado } = renderAlta();

    await completar(user);
    await escribirIndicaciones(user, 'x'.repeat(1001));

    // Pasarse del límite se marca enseguida, sin esperar al envío.
    expect(indicaciones()).toHaveAttribute('aria-invalid', 'true');
    expect(indicaciones()).toHaveAccessibleDescription(
      expect.stringContaining('Las indicaciones de armado no pueden superar los 1000 caracteres.'),
    );

    await user.click(botonRegistrar());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCreado).not.toHaveBeenCalled();
    expect(indicaciones()).toHaveFocus();
  });

  it('con exactamente 1000 caracteres registra el cliente', async () => {
    servirAlta(() => jsonResponse({ indicacionesArmado: 'x'.repeat(1000) }, 200));
    const { user, onCreado } = renderAlta();

    await completar(user);
    await escribirIndicaciones(user, 'x'.repeat(1000));
    expect(indicaciones()).not.toHaveAttribute('aria-invalid');
    await user.click(botonRegistrar());

    await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
    expect(pedidosDeIndicaciones()).toHaveLength(1);
  });
});

describe('NuevoClienteSheet: observaciones internas (HU2.10)', () => {
  const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
    typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const putsDe = (sufijo: string) =>
    fetchMock.mock.calls.filter(
      ([entrada, init]) => init?.method === 'PUT' && urlDe(entrada).endsWith(sufijo),
    );
  const pedidosDeObservaciones = () => putsDe('/observaciones');
  const observaciones = () => screen.getByRole('textbox', { name: 'Observaciones internas' });
  const indicaciones = () => screen.getByLabelText('Instrucciones para el legajo');

  interface Respuestas {
    observaciones?: () => Response | Promise<Response>;
    indicaciones?: () => Response | Promise<Response>;
  }

  /** El alta responde 201; el PUT de cada nota, lo que se indique (por defecto, 200). */
  function servirAlta({ observaciones: puedeObs, indicaciones: puedeInd }: Respuestas = {}) {
    fetchMock.mockImplementation((entrada) => {
      const url = urlDe(entrada);
      if (url.endsWith('/observaciones')) {
        return Promise.resolve(puedeObs?.() ?? jsonResponse({ observaciones: 'Nota.' }, 200));
      }
      if (url.endsWith('/indicaciones-armado')) {
        return Promise.resolve(
          puedeInd?.() ?? jsonResponse({ indicacionesArmado: 'Factura primero.' }, 200),
        );
      }
      return Promise.resolve(jsonResponse(clienteCreado, 201));
    });
  }

  async function escribir(user: UserEvent, campoDeTexto: HTMLElement, texto: string) {
    await user.click(campoDeTexto);
    await user.paste(texto);
  }

  it('el campo arranca vacío, editable y sin esperar nada guardado', () => {
    renderAlta();

    expect(observaciones()).toHaveValue('');
    expect(observaciones()).toBeEnabled();
  });

  it('sin observaciones no envía el PUT', async () => {
    servirAlta();
    const { user, onCreado } = renderAlta();

    await completar(user);
    await user.click(botonRegistrar());

    await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
    expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ id: clienteCreado.id }));
    expect(pedidosDeObservaciones()).toHaveLength(0);
  });

  it('un texto de solo espacios no se envía: equivale a no haber escrito nada', async () => {
    servirAlta();
    const { user, onCreado } = renderAlta();

    await completar(user);
    await escribir(user, observaciones(), '   \n  ');
    await user.click(botonRegistrar());

    await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
    expect(pedidosDeObservaciones()).toHaveLength(0);
  });

  it('crea el cliente y después envía la nota recortada, y avisa el alta sin fallo', async () => {
    servirAlta();
    const { user, onCreado } = renderAlta();

    await completar(user);
    await escribir(user, observaciones(), '  Pausó la pauta.\nRetoma en marzo.  ');
    await user.click(botonRegistrar());

    await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
    expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ id: clienteCreado.id }));
    const escrituras = fetchMock.mock.calls
      .filter(([, init]) => init?.method !== undefined && init.method !== 'GET')
      .map(([entrada, init]) => `${init?.method} ${new URL(urlDe(entrada)).pathname}`);
    expect(escrituras).toEqual([
      'POST /clientes',
      `PUT /clientes/${clienteCreado.id}/observaciones`,
    ]);
    expect(JSON.parse(pedidosDeObservaciones()[0]?.[1]?.body as string)).toEqual({
      observaciones: 'Pausó la pauta.\nRetoma en marzo.',
    });
  });

  it('con las dos notas, las guarda a las dos y avisa el alta sin fallo', async () => {
    servirAlta();
    const { user, onCreado } = renderAlta();

    await completar(user);
    await escribir(user, indicaciones(), 'Factura primero.');
    await escribir(user, observaciones(), 'Nota.');
    await user.click(botonRegistrar());

    await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
    expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ id: clienteCreado.id }));
    expect(putsDe('/indicaciones-armado')).toHaveLength(1);
    expect(pedidosDeObservaciones()).toHaveLength(1);
  });

  it.each([
    [
      400,
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos',
          details: [
            {
              campo: 'observaciones',
              mensaje: 'Las observaciones no pueden contener caracteres de control.',
            },
          ],
        },
      },
      'Las observaciones no pueden contener caracteres de control.',
    ],
    [404, { error: { code: 'NOT_FOUND', message: 'No existe' } }, 'El cliente ya no existe.'],
    [
      500,
      { error: { code: 'INTERNAL_ERROR', message: 'Error' } },
      'Probá de nuevo en unos segundos.',
    ],
  ])(
    'si el PUT de la nota responde %i, el alta se da por hecha y el motivo llega a quien abrió el panel',
    async (status, cuerpo, motivo) => {
      servirAlta({ observaciones: () => jsonResponse(cuerpo, status) });
      const { user, onCreado } = renderAlta();

      await completar(user);
      await escribir(user, observaciones(), 'Nota.');
      await user.click(botonRegistrar());

      await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
      expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ id: clienteCreado.id }), {
        motivos: { observaciones: motivo },
        guardadas: [],
      });
    },
  );

  it('si fallan las indicaciones, la nota se intenta igual y se informa que se guardó', async () => {
    servirAlta({
      indicaciones: () =>
        jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Error' } }, 500),
    });
    const { user, onCreado } = renderAlta();

    await completar(user);
    await escribir(user, indicaciones(), 'Factura primero.');
    await escribir(user, observaciones(), 'Nota.');
    await user.click(botonRegistrar());

    await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
    expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ id: clienteCreado.id }), {
      motivos: { indicaciones: 'Probá de nuevo en unos segundos.' },
      guardadas: ['observaciones'],
    });
    expect(pedidosDeObservaciones()).toHaveLength(1);
  });

  it('si fallan las dos notas, llegan los dos motivos', async () => {
    const falla = () => jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Error' } }, 500);
    servirAlta({ indicaciones: falla, observaciones: falla });
    const { user, onCreado } = renderAlta();

    await completar(user);
    await escribir(user, indicaciones(), 'Factura primero.');
    await escribir(user, observaciones(), 'Nota.');
    await user.click(botonRegistrar());

    await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
    expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ id: clienteCreado.id }), {
      motivos: {
        indicaciones: 'Probá de nuevo en unos segundos.',
        observaciones: 'Probá de nuevo en unos segundos.',
      },
      guardadas: [],
    });
  });

  it('con más de 1000 caracteres marca el límite en el campo y no crea nada', async () => {
    const { user, onCreado } = renderAlta();

    await completar(user);
    await escribir(user, observaciones(), 'x'.repeat(1001));

    // Pasarse del límite se marca enseguida, sin esperar al envío.
    expect(observaciones()).toHaveAttribute('aria-invalid', 'true');
    expect(observaciones()).toHaveAccessibleDescription(
      expect.stringContaining('Las observaciones no pueden superar los 1000 caracteres.'),
    );

    await user.click(botonRegistrar());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCreado).not.toHaveBeenCalled();
    expect(observaciones()).toHaveFocus();
  });

  it('con una tabulación no crea nada y lleva el foco al campo', async () => {
    const { user, onCreado } = renderAlta();

    await completar(user);
    await user.click(observaciones());
    await user.paste('Cambió\tel mail');
    await user.click(botonRegistrar());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCreado).not.toHaveBeenCalled();
    expect(observaciones()).toHaveFocus();
  });

  it('con exactamente 1000 caracteres registra el cliente', async () => {
    servirAlta();
    const { user, onCreado } = renderAlta();

    await completar(user);
    await escribir(user, observaciones(), 'x'.repeat(1000));
    expect(observaciones()).not.toHaveAttribute('aria-invalid');
    await user.click(botonRegistrar());

    await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
    expect(pedidosDeObservaciones()).toHaveLength(1);
  });

  it('mientras guarda la nota no se cierra el panel', async () => {
    let terminar: (respuesta: Response) => void = () => undefined;
    servirAlta({
      observaciones: () =>
        new Promise<Response>((resolver) => {
          terminar = resolver;
        }),
    });
    const { user, onCreado, onAbiertoChange } = renderAlta();
    await completar(user);
    await escribir(user, observaciones(), 'Nota.');

    await user.click(botonRegistrar());
    await waitFor(() => expect(pedidosDeObservaciones()).toHaveLength(1));
    await user.keyboard('{Escape}');

    expect(onAbiertoChange).not.toHaveBeenCalled();

    terminar(jsonResponse({ observaciones: 'Nota.' }, 200));
    await waitFor(() => expect(onCreado).toHaveBeenCalledTimes(1));
  });
});
