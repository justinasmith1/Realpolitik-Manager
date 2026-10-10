import { ClienteSchema, type Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditarClienteSheet } from '@/modules/clientes/components/EditarClienteSheet';
import { elegirOpcion, etiquetaDeOpcion } from '@/test/select';

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
  periodicidad: null,
  estado: 'ACTIVO',
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const cliente = {
  ...clienteJson,
  creadoEn: new Date(clienteJson.creadoEn),
  actualizadoEn: new Date(clienteJson.actualizadoEn),
} as Cliente;

function renderEdicion(aEditar: Cliente = cliente) {
  const onActualizado = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EditarClienteSheet cliente={aEditar} onClose={onClose} onActualizado={onActualizado} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onActualizado, onClose };
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta);
const botonGuardar = () => screen.getByRole('button', { name: 'Guardar cambios' });

/** Un cambio cualquiera que no interviene en lo que prueba el test, para poder guardar. */
async function cambiarDenominacion(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(campo('Denominación'));
  await user.type(campo('Denominación'), 'Muni Nueva');
}

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
    expect(campo('Sector')).toHaveTextContent(etiquetaDeOpcion('PUBLICO'));
    expect(campo('Subtipo público')).toHaveTextContent(etiquetaDeOpcion('MUNICIPAL'));
    expect(campo('Condición frente al IVA')).toHaveTextContent(etiquetaDeOpcion('EXENTO'));
    expect(campo('Email de contacto')).toHaveValue('compras@municipio.example');
    expect(campo('Canal de entrega')).toHaveTextContent(etiquetaDeOpcion('PORTAL_WEB'));
    expect(campo('URL del portal')).toHaveValue('https://portal.ejemplo.gob.ar');
    expect(botonGuardar()).toBeInTheDocument();
  });

  it('al guardar hace PATCH /clientes/:id con SOLO el campo modificado', async () => {
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
    // Ni los otros campos del formulario ni el teléfono o los emails adicionales: si otra
    // persona los cambió mientras el panel estaba abierto, sus cambios se conservan.
    expect(cuerpoEnviado()).toEqual({ razonSocial: 'Municipio Renombrado' });
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

    await cambiarDenominacion(user);
    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos guardar los cambios. Probá de nuevo en unos segundos.',
    );
    expect(onActualizado).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('describe el panel sin decir que todo es obligatorio', () => {
    renderEdicion();

    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toHaveAccessibleDescription(
      'Modificá los datos de Municipio de Ejemplo y guardá los cambios.',
    );
  });
});

// ─── Periodicidad de rendición (HU1.5) ────────────────────────────────────────

describe('EditarClienteSheet: periodicidad', () => {
  const conPeriodicidad = (periodicidad: Cliente['periodicidad']): Cliente => ({
    ...cliente,
    periodicidad,
  });
  const bimestral = { tipo: 'BIMESTRAL', diaLimite: 15, mesInicioCiclo: 3 } as const;

  /** Cuerpo del PATCH, después de que la edición terminó. */
  async function guardarYLeerCuerpo(user: ReturnType<typeof userEvent.setup>) {
    await user.click(botonGuardar());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    return cuerpoEnviado() as Record<string, unknown>;
  }

  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse(clienteJson, 200));
  });

  it('sin periodicidad precarga "Sin configurar" y no muestra día ni mes', () => {
    renderEdicion();

    expect(campo('Periodicidad')).toHaveTextContent('Sin configurar');
    expect(screen.queryByLabelText('Día límite')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mes de inicio del ciclo')).not.toBeInTheDocument();
  });

  it.each([
    ['MENSUAL', { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null }],
    ['POR_CAMPANIA', { tipo: 'POR_CAMPANIA', diaLimite: 5, mesInicioCiclo: null }],
  ] as const)('precarga una periodicidad %s con su día y sin mes', (tipo, periodicidad) => {
    renderEdicion(conPeriodicidad(periodicidad));

    expect(campo('Periodicidad')).toHaveTextContent(etiquetaDeOpcion(tipo));
    expect(campo('Día límite')).toHaveValue(String(periodicidad.diaLimite));
    expect(screen.queryByLabelText('Mes de inicio del ciclo')).not.toBeInTheDocument();
  });

  it('precarga una periodicidad BIMESTRAL con su día y su mes', async () => {
    const { user } = renderEdicion(conPeriodicidad(bimestral));

    expect(campo('Periodicidad')).toHaveTextContent(etiquetaDeOpcion('BIMESTRAL'));
    expect(campo('Día límite')).toHaveValue('15');
    expect(campo('Mes de inicio del ciclo')).toHaveTextContent(etiquetaDeOpcion('3'));
    // El mes cargado figura como la opción elegida al abrir la lista.
    await user.click(campo('Mes de inicio del ciclo'));
    expect(
      await screen.findByRole('option', { name: 'Marzo', selected: true }),
    ).toBeInTheDocument();
  });

  it('si nunca tuvo periodicidad y sigue sin configurar, no la envía', async () => {
    const { user } = renderEdicion();

    await cambiarDenominacion(user);
    const cuerpo = await guardarYLeerCuerpo(user);

    expect(cuerpo).not.toHaveProperty('periodicidad');
  });

  it('configurar una periodicidad envía el objeto con números', async () => {
    const { user } = renderEdicion();

    await elegirOpcion(user, campo('Periodicidad'), 'POR_CAMPANIA');
    await user.type(campo('Día límite'), '7');
    const cuerpo = await guardarYLeerCuerpo(user);

    expect(cuerpo.periodicidad).toStrictEqual({
      tipo: 'POR_CAMPANIA',
      diaLimite: 7,
      mesInicioCiclo: null,
    });
  });

  it('modificar una periodicidad existente envía la nueva completa', async () => {
    const { user } = renderEdicion(conPeriodicidad(bimestral));

    await user.clear(campo('Día límite'));
    await user.type(campo('Día límite'), '20');
    await elegirOpcion(user, campo('Mes de inicio del ciclo'), 'Noviembre');
    const cuerpo = await guardarYLeerCuerpo(user);

    expect(cuerpo.periodicidad).toStrictEqual({
      tipo: 'BIMESTRAL',
      diaLimite: 20,
      mesInicioCiclo: 11,
    });
  });

  it('al pasar de BIMESTRAL a MENSUAL el mes guardado no viaja', async () => {
    const { user } = renderEdicion(conPeriodicidad(bimestral));

    await elegirOpcion(user, campo('Periodicidad'), 'MENSUAL');
    const cuerpo = await guardarYLeerCuerpo(user);

    expect(cuerpo.periodicidad).toStrictEqual({
      tipo: 'MENSUAL',
      diaLimite: 15,
      mesInicioCiclo: null,
    });
  });

  it('si tenía periodicidad y pasa a "Sin configurar", envía periodicidad: null', async () => {
    const { user } = renderEdicion(conPeriodicidad(bimestral));

    await elegirOpcion(user, campo('Periodicidad'), '');
    const cuerpo = await guardarYLeerCuerpo(user);

    expect(cuerpo).toHaveProperty('periodicidad', null);
    expect(cuerpo).not.toHaveProperty('periodicidadTipo');
  });

  it('ante un error del servidor queda abierto y conserva la periodicidad elegida', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500));
    const { user, onActualizado, onClose } = renderEdicion(conPeriodicidad(bimestral));

    await elegirOpcion(user, campo('Mes de inicio del ciclo'), 'Junio');
    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos guardar los cambios. Probá de nuevo en unos segundos.',
    );
    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument();
    expect(campo('Periodicidad')).toHaveTextContent(etiquetaDeOpcion('BIMESTRAL'));
    expect(campo('Día límite')).toHaveValue('15');
    expect(campo('Mes de inicio del ciclo')).toHaveTextContent(etiquetaDeOpcion('6'));
    expect(onActualizado).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─── Errores del servidor y URL del portal (endurecimiento de entrada) ──────────

describe('EditarClienteSheet: errores del servidor por campo', () => {
  const rechazo = (...details: { campo: string; mensaje: string }[]) =>
    jsonResponse(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos',
          details,
        },
      },
      400,
    );

  it('rechaza en el formulario una URL que no es http(s), sin llegar al servidor', async () => {
    const { user, onActualizado } = renderEdicion();

    await user.clear(campo('URL del portal'));
    await user.type(campo('URL del portal'), 'javascript:alert(1)');
    await user.click(botonGuardar());

    expect(
      await screen.findByText(
        'La URL del portal debe ser una URL HTTP o HTTPS válida (por ejemplo, https://portal.ejemplo.com).',
      ),
    ).toBeInTheDocument();
    expect(campo('URL del portal')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onActualizado).not.toHaveBeenCalled();
  });

  it('rechaza en el formulario una URL con usuario y contraseña', async () => {
    const { user } = renderEdicion();

    await user.clear(campo('URL del portal'));
    await user.type(campo('URL del portal'), 'https://usuario:clave@portal.ejemplo.gob.ar');
    await user.click(botonGuardar());

    expect(
      await screen.findByText('La URL del portal no puede incluir usuario ni contraseña.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un 400 sobre portalUrl se muestra en ese campo con el texto del servidor', async () => {
    fetchMock.mockResolvedValue(
      rechazo({
        campo: 'portalUrl',
        mensaje: 'Para cargar la URL del portal, el canal tiene que ser Portal web.',
      }),
    );
    const { user, onActualizado } = renderEdicion();

    await user.clear(campo('URL del portal'));
    await user.type(campo('URL del portal'), 'https://otro-portal.ejemplo.gob.ar');
    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Algunos datos no son válidos. Revisá los campos marcados.',
    );
    expect(campo('URL del portal')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('URL del portal')).toHaveAccessibleDescription(
      expect.stringContaining('Para cargar la URL del portal, el canal tiene que ser Portal web.'),
    );
    expect(onActualizado).not.toHaveBeenCalled();
  });

  it('un 400 sobre el canal de entrega se muestra en el selector del canal', async () => {
    fetchMock.mockResolvedValue(rechazo({ campo: 'canalEntrega', mensaje: 'Required' }));
    const { user } = renderEdicion();

    await elegirOpcion(user, campo('Canal de entrega'), 'CORREO');
    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(campo('Canal de entrega')).toHaveAttribute('aria-invalid', 'true');
    // El texto por defecto de Zod, en inglés, no se muestra.
    expect(campo('Canal de entrega')).toHaveAccessibleDescription(
      expect.stringContaining('Revisá este dato.'),
    );
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
  });

  it('un 400 sobre el email de contacto se muestra en ese campo', async () => {
    fetchMock.mockResolvedValue(
      rechazo({
        campo: 'emailContacto',
        mensaje: 'El email de contacto no puede superar los 254 caracteres.',
      }),
    );
    const { user } = renderEdicion();

    await user.clear(campo('Email de contacto'));
    await user.type(campo('Email de contacto'), 'nuevo@municipio.example');
    await user.click(botonGuardar());

    await screen.findByRole('alert');
    expect(campo('Email de contacto')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('Email de contacto')).toHaveAccessibleDescription(
      expect.stringContaining('El email de contacto no puede superar los 254 caracteres.'),
    );
  });

  it('un 400 sobre un dato que el formulario no tiene va al aviso general, sin marcar campos', async () => {
    fetchMock.mockResolvedValue(
      rechazo({ campo: 'telefono', mensaje: 'El teléfono no tiene un formato válido.' }),
    );
    const { user, onClose } = renderEdicion();

    await cambiarDenominacion(user);
    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El teléfono no tiene un formato válido.',
    );
    for (const etiqueta of ['URL del portal', 'Email de contacto', 'CUIT', 'Razón social']) {
      expect(campo(etiqueta)).not.toHaveAttribute('aria-invalid', 'true');
    }
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─── Solo lo modificado (dirty-only) ──────────────────────────────────────────

describe('EditarClienteSheet: el PATCH lleva solo lo modificado', () => {
  const { subtipo: _subtipo, portalUrl: _portalUrl, ...sinSubtipoNiPortal } = clienteJson;
  const privadoPorCorreo: Cliente = ClienteSchema.parse({
    ...sinSubtipoNiPortal,
    sector: 'PRIVADO',
    canalEntrega: 'CORREO',
  });

  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse(clienteJson, 200));
  });

  async function guardarYLeerCuerpo(user: ReturnType<typeof userEvent.setup>) {
    await user.click(botonGuardar());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    return cuerpoEnviado();
  }

  it('sin cambios, "Guardar cambios" está deshabilitado, avisa por qué y no se envía nada', async () => {
    const { user } = renderEdicion();

    expect(botonGuardar()).toBeDisabled();
    expect(botonGuardar()).toHaveAccessibleDescription('Sin cambios para guardar.');
    await user.click(botonGuardar());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('se habilita con el primer cambio y vuelve a deshabilitarse si todo regresa a como estaba', async () => {
    const { user } = renderEdicion();

    await user.type(campo('Razón social'), ' 2');
    expect(botonGuardar()).toBeEnabled();
    expect(screen.queryByText('Sin cambios para guardar.')).not.toBeInTheDocument();

    await user.type(campo('Razón social'), '{Backspace}{Backspace}');
    expect(campo('Razón social')).toHaveValue('Municipio de Ejemplo');
    expect(botonGuardar()).toBeDisabled();
  });

  it('un campo que se cambió y se devolvió a su valor original no viaja', async () => {
    const { user } = renderEdicion();

    await user.type(campo('Razón social'), ' X');
    await user.type(campo('Razón social'), '{Backspace}{Backspace}');
    await user.clear(campo('Email de contacto'));
    await user.type(campo('Email de contacto'), 'nuevo@municipio.example');

    expect(await guardarYLeerCuerpo(user)).toEqual({ emailContacto: 'nuevo@municipio.example' });
  });

  it('envía los valores normalizados por shared (CUIT canónico, email en minúsculas)', async () => {
    const { user } = renderEdicion();

    await user.clear(campo('CUIT'));
    await user.type(campo('CUIT'), '20123456786');
    await user.clear(campo('Email de contacto'));
    await user.type(campo('Email de contacto'), 'Nuevo@Municipio.EXAMPLE');

    expect(await guardarYLeerCuerpo(user)).toEqual({
      cuit: '20-12345678-6',
      emailContacto: 'nuevo@municipio.example',
    });
  });

  describe('sector y subtipo', () => {
    it('PRIVADO → PUBLICO envía el sector con su subtipo', async () => {
      const { user } = renderEdicion(privadoPorCorreo);

      await elegirOpcion(user, campo('Sector'), 'PUBLICO');
      await elegirOpcion(user, campo('Subtipo público'), 'SINDICAL_OBRA_SOCIAL');

      expect(await guardarYLeerCuerpo(user)).toEqual({
        sector: 'PUBLICO',
        subtipo: 'SINDICAL_OBRA_SOCIAL',
      });
    });

    it('PUBLICO → PRIVADO envía solo el sector (el subtipo lo limpia el servidor)', async () => {
      const { user } = renderEdicion();

      await elegirOpcion(user, campo('Sector'), 'PRIVADO');

      expect(await guardarYLeerCuerpo(user)).toEqual({ sector: 'PRIVADO' });
    });

    it('con el mismo sector, cambiar el subtipo envía solo el subtipo', async () => {
      const { user } = renderEdicion();

      await elegirOpcion(user, campo('Subtipo público'), 'PROVINCIAL_ORGANISMO');

      expect(await guardarYLeerCuerpo(user)).toEqual({ subtipo: 'PROVINCIAL_ORGANISMO' });
    });

    it('ir a PRIVADO y volver a PUBLICO con el mismo subtipo no es un cambio', async () => {
      const { user } = renderEdicion();

      await elegirOpcion(user, campo('Sector'), 'PRIVADO');
      await elegirOpcion(user, campo('Sector'), 'PUBLICO');
      await elegirOpcion(user, campo('Subtipo público'), 'MUNICIPAL');

      expect(botonGuardar()).toBeDisabled();
    });
  });

  describe('canal de entrega', () => {
    it('CORREO → PORTAL_WEB envía el canal con la URL', async () => {
      const { user } = renderEdicion(privadoPorCorreo);

      await elegirOpcion(user, campo('Canal de entrega'), 'PORTAL_WEB');
      await user.type(campo('URL del portal'), 'https://portal.empresa.example');

      expect(await guardarYLeerCuerpo(user)).toEqual({
        canalEntrega: 'PORTAL_WEB',
        portalUrl: 'https://portal.empresa.example',
      });
    });

    it('PORTAL_WEB → WHATSAPP envía el canal con el número (en E.164)', async () => {
      const { user } = renderEdicion();

      await elegirOpcion(user, campo('Canal de entrega'), 'WHATSAPP');
      await user.type(campo('Número de WhatsApp'), '+54 9 351 123 4567');

      expect(await guardarYLeerCuerpo(user)).toEqual({
        canalEntrega: 'WHATSAPP',
        whatsappNumero: '+5493511234567',
      });
    });

    it('cambiar a CORREO envía solo el canal (los datos de los otros canales los limpia el servidor)', async () => {
      const { user } = renderEdicion();

      await elegirOpcion(user, campo('Canal de entrega'), 'CORREO');

      expect(await guardarYLeerCuerpo(user)).toEqual({ canalEntrega: 'CORREO' });
    });

    it('con el mismo canal, cambiar la URL envía solo la URL', async () => {
      const { user } = renderEdicion();

      await user.clear(campo('URL del portal'));
      await user.type(campo('URL del portal'), 'https://nuevo.ejemplo.gob.ar');

      expect(await guardarYLeerCuerpo(user)).toEqual({
        portalUrl: 'https://nuevo.ejemplo.gob.ar',
      });
    });
  });

  describe('periodicidad', () => {
    const mensual = { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null } as const;

    it('existente → "Sin configurar" envía periodicidad: null y nada más', async () => {
      const { user } = renderEdicion({ ...cliente, periodicidad: mensual });

      await elegirOpcion(user, campo('Periodicidad'), '');

      expect(await guardarYLeerCuerpo(user)).toEqual({ periodicidad: null });
    });

    it('sin periodicidad → una nueva envía el objeto completo', async () => {
      const { user } = renderEdicion();

      await elegirOpcion(user, campo('Periodicidad'), 'MENSUAL');
      await user.type(campo('Día límite'), '5');

      expect(await guardarYLeerCuerpo(user)).toEqual({
        periodicidad: { tipo: 'MENSUAL', diaLimite: 5, mesInicioCiclo: null },
      });
    });

    it('cambiar solo el día envía la periodicidad completa', async () => {
      const { user } = renderEdicion({ ...cliente, periodicidad: mensual });

      await user.clear(campo('Día límite'));
      await user.type(campo('Día límite'), '20');

      expect(await guardarYLeerCuerpo(user)).toEqual({
        periodicidad: { tipo: 'MENSUAL', diaLimite: 20, mesInicioCiclo: null },
      });
    });

    it('sin tocar la periodicidad, no viaja (aunque el cliente tenga una)', async () => {
      const { user } = renderEdicion({ ...cliente, periodicidad: mensual });

      await cambiarDenominacion(user);

      expect(await guardarYLeerCuerpo(user)).toEqual({ denominacion: 'Muni Nueva' });
    });
  });

  it('si el servidor falla, el panel queda abierto con lo escrito y se puede reintentar', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500))
      .mockResolvedValueOnce(jsonResponse(clienteJson, 200));
    const { user, onActualizado } = renderEdicion();

    await cambiarDenominacion(user);
    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(campo('Denominación')).toHaveValue('Muni Nueva');
    expect(botonGuardar()).toBeEnabled();

    await user.click(botonGuardar());
    await vi.waitFor(() => expect(onActualizado).toHaveBeenCalledTimes(1));
    const segundo = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as unknown;
    expect(segundo).toEqual({ denominacion: 'Muni Nueva' });
  });
});
