import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

import { ClienteForm, type ErroresDeEnvio } from '@/modules/clientes/components/ClienteForm';
import { elegirOpcion } from '@/test/select';

// Comportamiento observable del formulario: cuándo aparecen los errores, a dónde va el foco y
// cómo se ve un fallo del envío. Las reglas en sí (formato del CUIT, email…) son de shared.

const MENSAJE_CUIT_INVALIDO =
  'El CUIT ingresado no es válido (dígito verificador incorrecto o prefijo inválido).';
const MENSAJE_EMAIL_INVALIDO = 'El email de contacto no tiene un formato válido.';

type Enviar = (datos: unknown) => Promise<ErroresDeEnvio | undefined>;

function renderForm(onSubmit: Enviar = () => Promise.resolve(undefined)) {
  const enviar = vi.fn(onSubmit);
  render(
    <ClienteForm onSubmit={enviar} onCancel={() => undefined} textoEnviar="Registrar cliente" />,
  );
  return { user: userEvent.setup(), enviar };
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta);
const botonEnviar = () => screen.getByRole('button', { name: 'Registrar cliente' });
const camposInvalidos = () =>
  [...document.querySelectorAll('[aria-invalid="true"]')] as HTMLElement[];

/** Completa un alta válida de un cliente privado. */
async function completarValido(user: UserEvent) {
  await user.type(campo('Razón social'), 'Empresa de Ejemplo S.A.');
  await user.type(campo('Denominación'), 'Empresa Ejemplo');
  await user.type(campo('CUIT'), '20-12345678-6');
  await elegirOpcion(user, campo('Sector'), 'PRIVADO');
  await elegirOpcion(user, campo('Condición frente al IVA'), 'EXENTO');
  await user.type(campo('Email de contacto'), 'admin@empresa.example');
}

describe('ClienteForm: antes del primer envío', () => {
  it('pasar por campos obligatorios vacíos no marca ningún error', async () => {
    const { user } = renderForm();

    await user.click(campo('Razón social'));
    for (let i = 0; i < 6; i++) {
      await user.tab();
    }

    expect(camposInvalidos()).toHaveLength(0);
    expect(screen.queryByText(/^(Ingresá|Elegí) .*\.$/)).not.toBeInTheDocument();
  });

  it('un campo con contenido de formato inválido se valida al salir, y solo ese', async () => {
    const { user } = renderForm();

    await user.type(campo('Email de contacto'), 'no-es-un-email');
    expect(screen.queryByText(MENSAJE_EMAIL_INVALIDO)).not.toBeInTheDocument();
    await user.tab();

    expect(screen.getByText(MENSAJE_EMAIL_INVALIDO)).toBeInTheDocument();
    expect(campo('Email de contacto')).toBeInvalid();
    expect(camposInvalidos()).toHaveLength(1);
  });

  it('si el campo con error se vacía, el error se va: vacío no se marca antes de enviar', async () => {
    const { user } = renderForm();

    await user.type(campo('Email de contacto'), 'no-es-un-email');
    await user.tab();
    expect(campo('Email de contacto')).toBeInvalid();

    await user.clear(campo('Email de contacto'));
    await user.tab();

    expect(campo('Email de contacto')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(MENSAJE_EMAIL_INVALIDO)).not.toBeInTheDocument();
  });

  it('el CUIT avisa mientras se escribe, apenas tiene los 11 dígitos, sin salir del campo', async () => {
    const { user } = renderForm();

    await user.type(campo('CUIT'), '2012345678');
    expect(campo('CUIT')).not.toBeInvalid();

    await user.type(campo('CUIT'), '5');
    expect(screen.getByText(MENSAJE_CUIT_INVALIDO)).toBeInTheDocument();
    expect(campo('CUIT')).toHaveFocus();

    // Al corregirlo, el aviso se va en cuanto el valor es válido.
    await user.clear(campo('CUIT'));
    await user.type(campo('CUIT'), '20-12345678-6');
    expect(screen.queryByText(MENSAJE_CUIT_INVALIDO)).not.toBeInTheDocument();
    expect(campo('CUIT')).not.toBeInvalid();
  });

  it('la URL del portal y el WhatsApp con contenido inválido se validan al salir', async () => {
    const { user } = renderForm();

    await elegirOpcion(user, campo('Canal de entrega'), 'PORTAL_WEB');
    await user.type(campo('URL del portal'), 'esto no es una url');
    await user.tab();
    expect(campo('URL del portal')).toBeInvalid();

    await elegirOpcion(user, campo('Canal de entrega'), 'WHATSAPP');
    await user.type(campo('Número de WhatsApp'), 'abc');
    await user.tab();
    expect(campo('Número de WhatsApp')).toBeInvalid();
  });
});

describe('ClienteForm: primer envío', () => {
  it('muestra todos los errores relevantes y lleva el foco al primer campo inválido', async () => {
    const { user, enviar } = renderForm();

    await user.click(botonEnviar());

    expect(camposInvalidos().length).toBeGreaterThanOrEqual(6);
    expect(campo('Razón social')).toHaveFocus();
    expect(enviar).not.toHaveBeenCalled();
  });

  it('si el primer inválido es un select, el foco va al select', async () => {
    const { user } = renderForm();
    await user.type(campo('Razón social'), 'Empresa de Ejemplo S.A.');
    await user.type(campo('Denominación'), 'Empresa Ejemplo');
    await user.type(campo('CUIT'), '20-12345678-6');

    await user.click(botonEnviar());

    expect(campo('Sector')).toBeInvalid();
    expect(campo('Sector')).toHaveFocus();
  });

  describe('desplazamiento hasta el campo inválido', () => {
    // jsdom no implementa scrollIntoView: cada test lo define y lo retira al terminar.
    const scrollIntoView = vi.fn();
    beforeEach(() => {
      Element.prototype.scrollIntoView = scrollIntoView;
    });
    afterEach(() => {
      scrollIntoView.mockReset();
      vi.restoreAllMocks();
      // @ts-expect-error jsdom no lo define: se deja como estaba.
      delete Element.prototype.scrollIntoView;
    });

    it('muestra el campo si quedó fuera de la vista, con desplazamiento suave', async () => {
      const { user } = renderForm();

      await user.click(botonEnviar());

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    });

    it('respeta prefers-reduced-motion: el desplazamiento no se anima', async () => {
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query: string) =>
          ({
            matches: query.includes('prefers-reduced-motion'),
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          }) as unknown as MediaQueryList,
      );
      const { user } = renderForm();

      await user.click(botonEnviar());

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
    });
  });
});

describe('ClienteForm: después de un primer envío fallido', () => {
  it('revalida mientras se corrige: el error se va apenas el valor es válido, sin salir del campo', async () => {
    const { user } = renderForm();
    await user.click(botonEnviar());
    expect(screen.getByText('Ingresá la razón social.')).toBeInTheDocument();

    await user.type(campo('Razón social'), 'Empresa de Ejemplo');

    expect(screen.queryByText('Ingresá la razón social.')).not.toBeInTheDocument();
    expect(campo('Razón social')).not.toBeInvalid();
    expect(campo('Razón social')).toHaveFocus();
  });

  it('un valor que sigue siendo inválido sigue marcado mientras se escribe', async () => {
    const { user } = renderForm();
    await user.click(botonEnviar());

    await user.type(campo('Email de contacto'), 'sin-arroba');

    expect(screen.getByText(MENSAJE_EMAIL_INVALIDO)).toBeInTheDocument();
    await user.type(campo('Email de contacto'), '@ejemplo.example');
    expect(screen.queryByText(MENSAJE_EMAIL_INVALIDO)).not.toBeInTheDocument();
  });
});

describe('ClienteForm: aviso general del envío', () => {
  it('un fallo del servidor se avisa en una zona fija, antes de los campos, con role="alert"', async () => {
    const { user } = renderForm(() =>
      Promise.resolve({ general: 'No pudimos registrar el cliente. Probá de nuevo.' }),
    );
    await completarValido(user);

    await user.click(botonEnviar());

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos registrar el cliente. Probá de nuevo.');
    // Está antes que el primer campo y fuera del área con scroll: se ve sin buscarlo.
    expect(
      alerta.compareDocumentPosition(campo('Razón social')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(alerta.closest('[class*="overflow-y-auto"]')).toBeNull();
  });

  it('el mensaje queda mientras se reintenta, los datos se conservan y se puede volver a enviar', async () => {
    const respuestas: (ErroresDeEnvio | undefined)[] = [{ general: 'Falló el alta.' }, undefined];
    const { user, enviar } = renderForm(() => Promise.resolve(respuestas.shift()));
    await completarValido(user);

    await user.click(botonEnviar());
    expect(await screen.findByRole('alert')).toHaveTextContent('Falló el alta.');
    expect(campo('Razón social')).toHaveValue('Empresa de Ejemplo S.A.');
    expect(botonEnviar()).toBeEnabled();

    // Editar un dato no esconde el aviso: sigue hasta el próximo intento.
    await user.type(campo('Denominación'), ' 2');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(botonEnviar());
    await vi.waitFor(() => expect(enviar).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ClienteForm: guardando', () => {
  it('mientras guarda, el botón muestra "Guardando…", no se puede repetir y Cancelar se deshabilita', async () => {
    let terminar: () => void = () => undefined;
    const { user, enviar } = renderForm(
      () =>
        new Promise<undefined>((resolve) => {
          terminar = () => resolve(undefined);
        }),
    );
    await completarValido(user);

    await user.click(botonEnviar());

    const guardando = await screen.findByRole('button', { name: 'Guardando…' });
    expect(guardando).toBeDisabled();
    expect(guardando).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await user.click(guardando);
    expect(enviar).toHaveBeenCalledTimes(1);

    terminar();
    expect(await screen.findByRole('button', { name: 'Registrar cliente' })).toBeEnabled();
  });
});
