import { MENSAJE_NOMBRE_USUARIO_VACIO, MENSAJE_ROL_INVALIDO } from '@realpolitik/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import {
  ADVERTENCIA_CONTRASENA_TEMPORAL,
  MENSAJE_COPIA_FALLIDA,
  MENSAJE_COPIADA,
} from '@/modules/usuarios/components/ContrasenaTemporalDialog';
import {
  MENSAJE_EMAIL_EN_USO,
  MENSAJE_NO_CONFIRMADO,
  MENSAJE_ULTIMO_ADMINISTRADOR_DESACTIVAR,
  MENSAJE_ULTIMO_ADMINISTRADOR_ROL,
} from '@/modules/usuarios/components/erroresDeUsuario';
import { AVISO_CAMBIO_DE_ROL } from '@/modules/usuarios/components/UsuarioForm';
import {
  bruno,
  carla,
  crearServidor,
  dario,
  errorJson,
  ID_PROPIO,
  json,
  pedidosDe,
  renderUsuarios,
  TEMPORAL,
  urlDe,
  yo,
} from '@/modules/usuarios/test/servidorDeUsuarios';
import { elegirOpcion } from '@/test/select';

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();
const pedidos = () => pedidosDe(fetchMock);
const escrituras = () => pedidos().filter((p) => !p.startsWith('GET '));
const cuerpoDe = (clave: string) => {
  const llamada = fetchMock.mock.calls.find(([entrada, init]) => {
    const url = new URL(urlDe(entrada));
    return `${init?.method ?? 'GET'} ${url.pathname}` === clave;
  });
  return llamada?.[1]?.body === undefined
    ? undefined
    : (JSON.parse(llamada[1].body as string) as unknown);
};
const titulo = () => screen.getByRole('heading', { level: 1, name: 'Usuarios' });
/** El aviso de la página (un `Alert` fuera de los paneles y diálogos), si hay uno. */
const avisoDePagina = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="alert"]')].find(
    (aviso) => aviso.closest('[role="dialog"], [role="alertdialog"]') === null,
  );

const NO_CONFIRMADO = () =>
  errorJson(503, 'SERVICE_UNAVAILABLE', { motivo: 'RESULTADO_NO_CONFIRMADO' });

/** Una respuesta que llega cuando el test lo decide. */
function enPausa() {
  let responder: (respuesta: Response) => void = () => undefined;
  const respuesta = () => new Promise<Response>((resolve) => (responder = resolve)) as never;
  return { respuesta, responder: (r: Response) => act(() => responder(r)) };
}

async function listo() {
  const vista = renderUsuarios();
  await screen.findByRole('table', { name: 'Usuarios' });
  return vista;
}

async function abrirMenu(
  user: Awaited<ReturnType<typeof listo>>['user'],
  nombre: string,
  opcion: string,
) {
  await user.click(screen.getByRole('button', { name: `Acciones de ${nombre}` }));
  await user.click(await screen.findByRole('menuitem', { name: opcion }));
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

// ─── Alta ─────────────────────────────────────────────────────────────────────

describe('alta de un usuario', () => {
  async function abrirAlta() {
    const vista = await listo();
    await vista.user.click(screen.getByRole('button', { name: 'Nuevo usuario' }));
    const panel = within(await screen.findByRole('dialog', { name: 'Nuevo usuario' }));
    return { ...vista, panel };
  }

  it('panel con nombre, email y rol; nada se marca antes de enviar', async () => {
    crearServidor(fetchMock);
    const { user, panel } = await abrirAlta();
    expect(panel.getByText('Creá una cuenta y asignale un rol de acceso.')).toBeInTheDocument();
    await user.click(panel.getByLabelText('Nombre'));
    await user.tab();
    expect(panel.getByLabelText('Nombre')).not.toHaveAttribute('aria-invalid');
    expect(panel.getByRole('combobox', { name: 'Rol' })).toBeInTheDocument();
    expect(panel.getByText('Define qué puede hacer la persona en el sistema.')).toBeInTheDocument();
  });

  it('al enviar vacío: los errores de shared en cada campo y el foco en el primero, sin pedir nada', async () => {
    crearServidor(fetchMock);
    const { user, panel } = await abrirAlta();
    await user.click(panel.getByRole('button', { name: 'Crear usuario' }));

    expect(await panel.findByText(MENSAJE_NOMBRE_USUARIO_VACIO)).toBeInTheDocument();
    // Un email vacío es un email sin formato: el mensaje del inicio de sesión, el de shared.
    expect(panel.getByText('Ingresá un email válido.')).toBeInTheDocument();
    expect(panel.getByText(MENSAJE_ROL_INVALIDO)).toBeInTheDocument();
    expect(panel.getByLabelText('Nombre')).toHaveFocus();
    expect(panel.getByLabelText('Nombre')).toHaveAccessibleDescription(
      MENSAJE_NOMBRE_USUARIO_VACIO,
    );
    expect(escrituras()).toEqual([]);
  });

  it('un email sin formato se marca en su campo', async () => {
    crearServidor(fetchMock);
    const { user, panel } = await abrirAlta();
    await user.type(panel.getByLabelText('Nombre'), 'Eva');
    await user.type(panel.getByLabelText('Email'), 'eva-sin-arroba');
    await user.tab();
    await waitFor(() =>
      expect(panel.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true'),
    );
  });

  it('crea, cierra el panel y muestra la contraseña UNA vez; al cerrar no queda en ningún lado', async () => {
    crearServidor(fetchMock);
    const { user, panel, queryClient } = await abrirAlta();
    await user.type(panel.getByLabelText('Nombre'), '  Eva Luna ');
    await user.type(panel.getByLabelText('Email'), 'EVA@ejemplo.example');
    await elegirOpcion(user, panel.getByRole('combobox', { name: 'Rol' }), 'Consulta');
    expect(
      panel.getByText('Consulta la información en modo lectura, sin modificarla.'),
    ).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Crear usuario' }));

    const dialogo = await screen.findByRole('alertdialog', { name: 'Usuario creado' });
    expect(cuerpoDe('POST /usuarios')).toEqual({
      nombre: 'Eva Luna',
      email: 'eva@ejemplo.example',
      rol: 'CONSULTA',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nuevo usuario' })).not.toBeInTheDocument(),
    );
    expect(within(dialogo).getByText(TEMPORAL)).toHaveClass('font-mono');
    expect(dialogo).toHaveTextContent('Eva Luna (eva@ejemplo.example)');
    expect(within(dialogo).getByText(ADVERTENCIA_CONTRASENA_TEMPORAL)).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Copiar contraseña' })).toHaveFocus();
    // Ningún aviso de éxito duplica el diálogo, y el listado ya tiene la cuenta nueva.
    expect(avisoDePagina()).toBeUndefined();
    await waitFor(() => expect(pedidos().filter((p) => p === 'GET /usuarios')).toHaveLength(2));

    // Escape no la descarta por accidente: hay que cerrarla.
    fireEvent.keyDown(dialogo, { key: 'Escape' });
    expect(screen.getByRole('alertdialog', { name: 'Usuario creado' })).toBeInTheDocument();

    await user.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByText(TEMPORAL)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Nuevo usuario' })).toHaveFocus(),
    );
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state),
      ),
    ).not.toContain(TEMPORAL);
    expect(window.location.href).not.toContain(TEMPORAL);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(TEMPORAL);

    // No hay forma de volver a verla: ni el menú de la cuenta nueva la ofrece.
    await user.click(screen.getByRole('button', { name: 'Acciones de Eva Luna' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByText(/Ver contraseña/)).not.toBeInTheDocument();
  });

  it('"Copiar contraseña" la copia y lo anuncia; si el portapapeles falla, indica copiarla a mano', async () => {
    crearServidor(fetchMock);
    const { user, panel } = await abrirAlta();
    await user.type(panel.getByLabelText('Nombre'), 'Eva');
    await user.type(panel.getByLabelText('Email'), 'eva@ejemplo.example');
    await elegirOpcion(user, panel.getByRole('combobox', { name: 'Rol' }), 'Administrativo');
    await user.click(panel.getByRole('button', { name: 'Crear usuario' }));
    const dialogo = within(await screen.findByRole('alertdialog', { name: 'Usuario creado' }));

    await user.click(dialogo.getByRole('button', { name: 'Copiar contraseña' }));
    expect(await navigator.clipboard.readText()).toBe(TEMPORAL);
    expect(dialogo.getByRole('status')).toHaveTextContent(MENSAJE_COPIADA);
    // Lo que se anuncia es el resultado, nunca la contraseña.
    expect(dialogo.getByRole('status')).not.toHaveTextContent(TEMPORAL);

    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denegado'));
    await user.click(dialogo.getByRole('button', { name: 'Copiar contraseña' }));
    await waitFor(() =>
      expect(dialogo.getByRole('status')).toHaveTextContent(MENSAJE_COPIA_FALLIDA),
    );
  });

  it('email repetido (409): el error en el campo, el panel abierto y los datos intactos', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.forzadas.set('POST /usuarios', () =>
      errorJson(409, 'CONFLICT', { motivo: 'EMAIL_EN_USO', campo: 'email' }),
    );
    const { user, panel } = await abrirAlta();
    await user.type(panel.getByLabelText('Nombre'), 'Eva');
    await user.type(panel.getByLabelText('Email'), 'carla@ejemplo.example');
    await elegirOpcion(user, panel.getByRole('combobox', { name: 'Rol' }), 'Consulta');
    await user.click(panel.getByRole('button', { name: 'Crear usuario' }));

    expect(await panel.findByText(MENSAJE_EMAIL_EN_USO)).toBeInTheDocument();
    expect(panel.getByLabelText('Email')).toHaveFocus();
    expect(panel.getByLabelText('Nombre')).toHaveValue('Eva');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('sin confirmar: lo dice sin afirmar nada, no hay contraseña, no reintenta y vuelve a pedir el listado', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.forzadas.set('POST /usuarios', NO_CONFIRMADO);
    const { user, panel } = await abrirAlta();
    await user.type(panel.getByLabelText('Nombre'), 'Eva');
    await user.type(panel.getByLabelText('Email'), 'eva@ejemplo.example');
    await elegirOpcion(user, panel.getByRole('combobox', { name: 'Rol' }), 'Consulta');
    await user.click(panel.getByRole('button', { name: 'Crear usuario' }));

    expect(await panel.findByText(MENSAJE_NO_CONFIRMADO.crear)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(escrituras()).toEqual(['POST /usuarios']);
    await waitFor(() => expect(pedidos().filter((p) => p === 'GET /usuarios')).toHaveLength(2));
    expect(panel.getByLabelText('Email')).toHaveValue('eva@ejemplo.example');
  });

  it('sin doble envío: mientras se crea, otro clic o Enter no repiten el POST', async () => {
    const servidor = crearServidor(fetchMock);
    const pausa = enPausa();
    servidor.forzadas.set('POST /usuarios', pausa.respuesta);
    const { user, panel } = await abrirAlta();
    await user.type(panel.getByLabelText('Nombre'), 'Eva');
    await user.type(panel.getByLabelText('Email'), 'eva@ejemplo.example');
    await elegirOpcion(user, panel.getByRole('combobox', { name: 'Rol' }), 'Consulta');
    await user.click(panel.getByRole('button', { name: 'Crear usuario' }));
    await panel.findByRole('button', { name: 'Creando…' });
    await user.click(panel.getByRole('button', { name: 'Creando…' }));
    await user.type(panel.getByLabelText('Nombre'), '{Enter}');
    expect(escrituras()).toEqual(['POST /usuarios']);
  });
});

// ─── Edición ──────────────────────────────────────────────────────────────────

describe('edición de un usuario', () => {
  async function abrirEdicion(nombre: string) {
    const vista = await listo();
    await abrirMenu(vista.user, nombre, 'Editar');
    return vista;
  }

  it('el email se ve pero no se edita; sin cambios no se puede guardar', async () => {
    crearServidor(fetchMock);
    await abrirEdicion(bruno.nombre);
    const panel = within(await screen.findByRole('dialog', { name: 'Editar usuario' }));
    expect(panel.getByText(bruno.email)).toBeInTheDocument();
    expect(panel.queryByRole('textbox', { name: 'Email' })).not.toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(panel.getByText('Sin cambios para guardar.')).toBeInTheDocument();
  });

  it('cambiar solo el nombre envía solo el nombre (no reenvía el rol)', async () => {
    crearServidor(fetchMock);
    const { user } = await abrirEdicion(bruno.nombre);
    const panel = within(await screen.findByRole('dialog', { name: 'Editar usuario' }));
    await user.clear(panel.getByLabelText('Nombre'));
    await user.type(panel.getByLabelText('Nombre'), 'Bruno D. Díaz');
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(cuerpoDe(`PATCH /usuarios/${bruno.id}`)).toEqual({ nombre: 'Bruno D. Díaz' });
    expect(avisoDePagina()).toHaveTextContent('Se guardaron los cambios de Bruno D. Díaz.');
  });

  it('cambiar el rol avisa que se cierran sus sesiones y envía solo el rol', async () => {
    crearServidor(fetchMock);
    const { user } = await abrirEdicion(bruno.nombre);
    const panel = within(await screen.findByRole('dialog', { name: 'Editar usuario' }));
    expect(panel.queryByText(AVISO_CAMBIO_DE_ROL)).not.toBeInTheDocument();
    await elegirOpcion(user, panel.getByRole('combobox', { name: 'Rol' }), 'Consulta');
    expect(panel.getByText(AVISO_CAMBIO_DE_ROL)).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(cuerpoDe(`PATCH /usuarios/${bruno.id}`)).toEqual({ rol: 'CONSULTA' });
    expect(avisoDePagina()).toHaveTextContent('Se cerraron sus sesiones abiertas.');
  });

  it('la cuenta propia: el nombre sí, el rol no se ofrece ni se envía', async () => {
    crearServidor(fetchMock);
    const { user } = await abrirEdicion(yo.nombre);
    const panel = within(await screen.findByRole('dialog', { name: 'Editar tu cuenta' }));
    expect(panel.queryByRole('combobox', { name: 'Rol' })).not.toBeInTheDocument();
    expect(
      panel.getByText('Tu rol lo tiene que cambiar otra persona administradora.'),
    ).toBeInTheDocument();
    await user.clear(panel.getByLabelText('Nombre'));
    await user.type(panel.getByLabelText('Nombre'), 'Ana María Admin');
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(cuerpoDe(`PATCH /usuarios/${ID_PROPIO}`)).toEqual({ nombre: 'Ana María Admin' });
  });

  it('quitarle el rol al último administrador (409): lo explica en el panel, que sigue abierto', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.cuentas = [
      ...servidor.cuentas,
      {
        ...bruno,
        id: '0b0b0b0b-0000-4000-8000-0000000000cc',
        nombre: 'Otra Admin',
        rol: 'ADMINISTRADOR',
      },
    ];
    servidor.forzadas.set('PATCH /usuarios/0b0b0b0b-0000-4000-8000-0000000000cc', () =>
      errorJson(409, 'CONFLICT', { motivo: 'ULTIMO_ADMINISTRADOR', operacion: 'cambiar-rol' }),
    );
    const { user } = await abrirEdicion('Otra Admin');
    const panel = within(await screen.findByRole('dialog', { name: 'Editar usuario' }));
    await elegirOpcion(user, panel.getByRole('combobox', { name: 'Rol' }), 'Administrativo');
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    expect(await panel.findByText(MENSAJE_ULTIMO_ADMINISTRADOR_ROL)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Editar usuario' })).toBeInTheDocument();
  });

  it('un nombre inválido del servidor (400) va a su campo', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.forzadas.set(`PATCH /usuarios/${bruno.id}`, () =>
      errorJson(400, 'VALIDATION_ERROR', [
        { campo: 'nombre', mensaje: 'El nombre tiene caracteres que no se pueden usar.' },
      ]),
    );
    const { user } = await abrirEdicion(bruno.nombre);
    const panel = within(await screen.findByRole('dialog', { name: 'Editar usuario' }));
    await user.type(panel.getByLabelText('Nombre'), ' II');
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));
    expect(
      await panel.findByText('El nombre tiene caracteres que no se pueden usar.'),
    ).toBeInTheDocument();
    expect(panel.getByLabelText('Nombre')).toHaveValue(`${bruno.nombre} II`);
  });
});

// ─── Desactivar y reactivar ───────────────────────────────────────────────────

describe('desactivar y reactivar', () => {
  it('cancelar no envía nada; confirmar desactiva, avisa y lleva el foco al título', async () => {
    crearServidor(fetchMock);
    const { user } = await listo();
    await abrirMenu(user, bruno.nombre, 'Desactivar');
    const dialogo = within(
      await screen.findByRole('alertdialog', { name: '¿Desactivar esta cuenta?' }),
    );
    expect(
      dialogo.getByText(
        `${bruno.nombre} no podrá iniciar sesión y sus sesiones actuales se cerrarán. Podrás reactivar la cuenta más adelante.`,
      ),
    ).toBeInTheDocument();
    await user.click(dialogo.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(escrituras()).toEqual([]);

    await abrirMenu(user, bruno.nombre, 'Desactivar');
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Desactivar usuario',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(cuerpoDe(`PATCH /usuarios/${bruno.id}/estado`)).toEqual({ activo: false });
    // El servidor de prueba revoca una sesión al desactivar.
    expect(avisoDePagina()).toHaveTextContent(
      `Se desactivó la cuenta de ${bruno.nombre}. Se cerraron sus sesiones abiertas.`,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('row', { name: new RegExp(`^${bruno.nombre}`) }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(titulo()).toHaveFocus());
  });

  it('desactivar sin sesiones abiertas: el aviso no dice que se cerraron', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.forzadas.set(`PATCH /usuarios/${bruno.id}/estado`, () =>
      json({ usuario: { ...bruno, activo: false }, cambio: true, sesionesRevocadas: 0 }),
    );
    const { user } = await listo();
    await abrirMenu(user, bruno.nombre, 'Desactivar');
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Desactivar usuario',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(avisoDePagina()).toHaveTextContent(`Se desactivó la cuenta de ${bruno.nombre}.`);
    expect(avisoDePagina()).not.toHaveTextContent('Se cerraron sus sesiones abiertas.');
  });

  it('reactivar una desactivada, con su texto', async () => {
    crearServidor(fetchMock);
    const vista = renderUsuarios('/usuarios?desactivados=1');
    await screen.findByRole('row', { name: new RegExp(`^${dario.nombre}`) });
    await abrirMenu(vista.user, dario.nombre, 'Reactivar');
    const dialogo = within(
      await screen.findByRole('alertdialog', { name: '¿Reactivar esta cuenta?' }),
    );
    expect(
      dialogo.getByText(
        `${dario.nombre} podrá volver a iniciar sesión con sus credenciales vigentes. Las sesiones anteriores no se recuperarán.`,
      ),
    ).toBeInTheDocument();
    await vista.user.click(dialogo.getByRole('button', { name: 'Reactivar usuario' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(cuerpoDe(`PATCH /usuarios/${dario.id}/estado`)).toEqual({ activo: true });
    expect(avisoDePagina()).toHaveTextContent(`Se reactivó la cuenta de ${dario.nombre}.`);
  });

  it('el último administrador (409): mensaje claro en la página, no uno genérico', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.forzadas.set(`PATCH /usuarios/${bruno.id}/estado`, () =>
      errorJson(409, 'CONFLICT', { motivo: 'ULTIMO_ADMINISTRADOR', operacion: 'desactivar' }),
    );
    const { user } = await listo();
    await abrirMenu(user, bruno.nombre, 'Desactivar');
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Desactivar usuario',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(avisoDePagina()).toHaveTextContent(MENSAJE_ULTIMO_ADMINISTRADOR_DESACTIVAR);
  });

  it('sin confirmar: advierte, vuelve a pedir el listado y no repite el PATCH', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.forzadas.set(`PATCH /usuarios/${bruno.id}/estado`, NO_CONFIRMADO);
    const { user } = await listo();
    await abrirMenu(user, bruno.nombre, 'Desactivar');
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Desactivar usuario',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(avisoDePagina()).toHaveTextContent(MENSAJE_NO_CONFIRMADO.desactivar);
    expect(escrituras()).toEqual([`PATCH /usuarios/${bruno.id}/estado`]);
    await waitFor(() => expect(pedidos().filter((p) => p === 'GET /usuarios')).toHaveLength(2));
  });

  it('mientras se aplica no se puede cancelar ni repetir', async () => {
    const servidor = crearServidor(fetchMock);
    const pausa = enPausa();
    servidor.forzadas.set(`PATCH /usuarios/${bruno.id}/estado`, pausa.respuesta);
    const { user } = await listo();
    await abrirMenu(user, bruno.nombre, 'Desactivar');
    const dialogo = within(await screen.findByRole('alertdialog'));
    await user.click(dialogo.getByRole('button', { name: 'Desactivar usuario' }));
    await user.click(await dialogo.findByRole('button', { name: 'Desactivando…' }));
    expect(dialogo.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(escrituras()).toEqual([`PATCH /usuarios/${bruno.id}/estado`]);
  });
});

// ─── Restablecer la contraseña ────────────────────────────────────────────────

describe('restablecer la contraseña', () => {
  it('nada se envía antes de confirmar; al confirmar, la contraseña nueva se ve una vez', async () => {
    crearServidor(fetchMock);
    const { user } = await listo();
    await abrirMenu(user, carla.nombre, 'Restablecer contraseña');
    const confirmacion = within(
      await screen.findByRole('alertdialog', { name: '¿Restablecer la contraseña?' }),
    );
    expect(
      confirmacion.getByText(
        `Se generará una nueva contraseña temporal para ${carla.nombre}. Sus sesiones actuales se cerrarán y deberá elegir una contraseña propia cuando vuelva a ingresar.`,
      ),
    ).toBeInTheDocument();
    expect(escrituras()).toEqual([]);

    await user.click(confirmacion.getByRole('button', { name: 'Restablecer contraseña' }));
    const dialogo = await screen.findByRole('alertdialog', { name: 'Contraseña restablecida' });
    expect(escrituras()).toEqual([`POST /usuarios/${carla.id}/restablecer-password`]);
    expect(cuerpoDe(`POST /usuarios/${carla.id}/restablecer-password`)).toBeUndefined();
    expect(within(dialogo).getByText(TEMPORAL)).toBeInTheDocument();
    expect(dialogo).toHaveTextContent(carla.email);
    await waitFor(() =>
      expect(within(dialogo).getByRole('button', { name: 'Copiar contraseña' })).toHaveFocus(),
    );

    await user.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByText(TEMPORAL)).not.toBeInTheDocument();
    await waitFor(() => expect(titulo()).toHaveFocus());
  });

  it('sin confirmar: no hay contraseña, no se afirma que siga la anterior y no se reintenta', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.forzadas.set(`POST /usuarios/${carla.id}/restablecer-password`, NO_CONFIRMADO);
    const { user } = await listo();
    await abrirMenu(user, carla.nombre, 'Restablecer contraseña');
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Restablecer contraseña',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(avisoDePagina()).toHaveTextContent(MENSAJE_NO_CONFIRMADO.restablecer);
    expect(avisoDePagina()).not.toHaveTextContent(/sigue|vigente/);
    expect(escrituras()).toEqual([`POST /usuarios/${carla.id}/restablecer-password`]);
  });

  it('servicio ocupado (503 sin motivo): queda en el diálogo y se puede volver a confirmar a mano', async () => {
    const servidor = crearServidor(fetchMock);
    servidor.forzadas.set(`POST /usuarios/${carla.id}/restablecer-password`, () =>
      errorJson(503, 'SERVICE_UNAVAILABLE'),
    );
    const { user } = await listo();
    await abrirMenu(user, carla.nombre, 'Restablecer contraseña');
    const dialogo = within(await screen.findByRole('alertdialog'));
    await user.click(dialogo.getByRole('button', { name: 'Restablecer contraseña' }));
    expect(await dialogo.findByText(/El servicio está ocupado/)).toBeInTheDocument();
    expect(escrituras()).toHaveLength(1);

    servidor.forzadas.delete(`POST /usuarios/${carla.id}/restablecer-password`);
    await user.click(dialogo.getByRole('button', { name: 'Restablecer contraseña' }));
    expect(
      await screen.findByRole('alertdialog', { name: 'Contraseña restablecida' }),
    ).toBeInTheDocument();
    expect(escrituras()).toHaveLength(2);
  });
});
