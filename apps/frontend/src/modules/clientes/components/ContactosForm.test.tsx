import type { Contacto } from '@realpolitik/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ContactosForm } from '@/modules/clientes/components/ContactosForm';
import type { ErroresDeContactos } from '@/modules/clientes/components/erroresDeContactos';

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const ID_A = 'c1111111-1111-4111-a111-111111111111';
const ID_B = 'c2222222-2222-4222-a222-222222222222';
const ID_C = 'c3333333-3333-4333-a333-333333333333';

const contacto = (id: string, nombre: string, email: string): Contacto => ({
  id,
  clienteId: CLIENTE,
  nombre,
  area: 'Tesorería',
  email,
  recibeRendiciones: false,
});

const ana = contacto(ID_A, 'Ana Pérez', 'ana@ejemplo.example');
const bruno = contacto(ID_B, 'Bruno Gómez', 'bruno@ejemplo.example');

type OnSave = (contactos: unknown[]) => Promise<ErroresDeContactos | undefined>;

function renderForm(iniciales: Contacto[] = [], onSave: OnSave = () => Promise.resolve(undefined)) {
  const guardar = vi.fn<OnSave>(onSave);
  const onCancel = vi.fn();
  render(<ContactosForm contactosIniciales={iniciales} onSave={guardar} onCancel={onCancel} />);
  return { user: userEvent.setup(), onSave: guardar, onCancel };
}

const botonGuardar = () => screen.getByRole('button', { name: 'Guardar contactos' });
const grupo = (n: number) => within(screen.getByRole('group', { name: `Contacto ${n}` }));

describe('ContactosForm: datos', () => {
  it('muestra los contactos recibidos con sus datos', () => {
    renderForm([ana, bruno]);

    expect(grupo(1).getByLabelText('Nombre')).toHaveValue('Ana Pérez');
    expect(grupo(1).getByLabelText('Email')).toHaveValue('ana@ejemplo.example');
    expect(grupo(2).getByLabelText('Nombre')).toHaveValue('Bruno Gómez');
  });

  it('envía la lista completa: con id los que ya existían y sin id los nuevos', async () => {
    const { user, onSave } = renderForm([ana]);

    await user.click(screen.getByRole('button', { name: 'Agregar contacto' }));
    await user.type(grupo(2).getByLabelText('Nombre'), '  Carla Díaz ');
    await user.type(grupo(2).getByLabelText('Área'), 'Compras');
    await user.type(grupo(2).getByLabelText('Email'), 'carla@ejemplo.example');
    await user.click(botonGuardar());

    expect(onSave).toHaveBeenCalledTimes(1);
    const [enviados] = onSave.mock.calls[0] ?? [];
    expect(enviados).toStrictEqual([
      {
        id: ID_A,
        nombre: 'Ana Pérez',
        area: 'Tesorería',
        email: 'ana@ejemplo.example',
        recibeRendiciones: false,
      },
      {
        nombre: '  Carla Díaz ',
        area: 'Compras',
        email: 'carla@ejemplo.example',
        recibeRendiciones: false,
      },
    ]);
  });

  it('un contacto eliminado se omite de la lista enviada, tras confirmar', async () => {
    const { user, onSave } = renderForm([ana, bruno]);

    await user.click(screen.getByRole('button', { name: 'Eliminar contacto Ana Pérez' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(screen.queryByDisplayValue('Ana Pérez')).not.toBeInTheDocument();
    await user.click(botonGuardar());

    const [enviados] = onSave.mock.calls[0] ?? [];
    expect(enviados).toStrictEqual([expect.objectContaining({ id: ID_B })]);
  });

  it('se puede guardar una lista vacía (elimina todos)', async () => {
    const { user, onSave } = renderForm([]);

    await user.click(botonGuardar());

    expect(onSave).toHaveBeenCalledWith([]);
  });
});

describe('ContactosForm: validación con los mensajes de shared', () => {
  async function conUnContactoVacio() {
    const ctx = renderForm();
    await ctx.user.click(screen.getByRole('button', { name: 'Agregar contacto' }));
    return ctx;
  }

  it('muestra el mensaje real de cada campo y no envía nada', async () => {
    const { user, onSave } = await conUnContactoVacio();
    await user.type(grupo(1).getByLabelText('Nombre'), 'A');
    await user.type(grupo(1).getByLabelText('Email'), 'no-es-email');
    await user.click(botonGuardar());

    expect(screen.getByText('El nombre debe tener al menos 2 caracteres.')).toBeInTheDocument();
    expect(screen.getByText('El área debe tener al menos 2 caracteres.')).toBeInTheDocument();
    expect(
      screen.getByText('El email del contacto no tiene un formato válido.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Dato inválido')).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('marca un email de más de 254 caracteres con su mensaje', async () => {
    const { user } = await conUnContactoVacio();
    await user.type(grupo(1).getByLabelText('Nombre'), 'Ana');
    await user.type(grupo(1).getByLabelText('Área'), 'Compras');
    await user.click(grupo(1).getByLabelText('Email'));
    await user.paste(`${'a'.repeat(250)}@x.example`);
    await user.click(botonGuardar());

    expect(
      screen.getByText('El email del contacto no puede superar los 254 caracteres.'),
    ).toBeInTheDocument();
  });

  it('conecta cada campo con su error: aria-invalid, aria-describedby y required', async () => {
    const { user } = await conUnContactoVacio();
    const nombre = grupo(1).getByLabelText('Nombre');
    const email = grupo(1).getByLabelText('Email');
    // Obligatorios desde el principio, y sin marca de error hasta enviar.
    expect(nombre).toBeRequired();
    expect(email).toBeRequired();
    expect(nombre).not.toHaveAttribute('aria-invalid');
    expect(nombre).not.toHaveAccessibleDescription();

    await user.click(botonGuardar());

    expect(nombre).toHaveAttribute('aria-invalid', 'true');
    expect(nombre).toHaveAccessibleDescription('El nombre debe tener al menos 2 caracteres.');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('El email del contacto no tiene un formato válido.');
  });

  it('lleva el foco al primer campo con error', async () => {
    const { user } = await conUnContactoVacio();

    await user.click(botonGuardar());

    expect(grupo(1).getByLabelText('Nombre')).toHaveFocus();
  });

  it('al corregir el campo, se va su error', async () => {
    const { user } = await conUnContactoVacio();
    await user.click(botonGuardar());
    const nombre = grupo(1).getByLabelText('Nombre');

    await user.type(nombre, 'Ana');

    expect(nombre).not.toHaveAttribute('aria-invalid');
    expect(
      screen.queryByText('El nombre debe tener al menos 2 caracteres.'),
    ).not.toBeInTheDocument();
  });
});

describe('ContactosForm: emails repetidos en la lista', () => {
  it('los marca en línea en cada contacto involucrado, sin enviar', async () => {
    const { user, onSave } = renderForm([ana, bruno]);

    const email = grupo(2).getByLabelText('Email');
    await user.clear(email);
    await user.type(email, '  ANA@Ejemplo.Example ');
    await user.click(botonGuardar());

    const mensaje = 'Este email está repetido en otro contacto de la lista.';
    expect(grupo(1).getByLabelText('Email')).toHaveAccessibleDescription(mensaje);
    expect(grupo(2).getByLabelText('Email')).toHaveAccessibleDescription(mensaje);
    expect(grupo(1).getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(grupo(1).getByLabelText('Nombre')).not.toHaveAttribute('aria-invalid');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('un intercambio de emails entre dos contactos NO es un repetido', async () => {
    const { user, onSave } = renderForm([ana, bruno]);

    const primero = grupo(1).getByLabelText('Email');
    const segundo = grupo(2).getByLabelText('Email');
    await user.clear(primero);
    await user.type(primero, 'bruno@ejemplo.example');
    await user.clear(segundo);
    await user.type(segundo, 'ana@ejemplo.example');
    await user.click(botonGuardar());

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('ContactosForm: errores del servidor', () => {
  it('marca el campo indicado con el mensaje del servidor y lo enfoca, sin perder lo escrito', async () => {
    const { user } = renderForm([ana, bruno], () =>
      Promise.resolve({ contactos: { 1: { email: 'El email ya está en uso.' } } }),
    );
    await user.type(grupo(1).getByLabelText('Nombre'), ' Extra');

    await user.click(botonGuardar());

    const email = await vi.waitFor(() => {
      const campo = grupo(2).getByLabelText('Email');
      expect(campo).toHaveAttribute('aria-invalid', 'true');
      return campo;
    });
    expect(email).toHaveAccessibleDescription('El email ya está en uso.');
    expect(email).toHaveFocus();
    expect(grupo(1).getByLabelText('Nombre')).toHaveValue('Ana Pérez Extra');
  });

  it('muestra el mensaje general con role=alert y conserva todos los valores', async () => {
    const { user } = renderForm([ana, bruno], () =>
      Promise.resolve({ general: 'No pudimos guardar los contactos.' }),
    );
    await user.type(grupo(2).getByLabelText('Área'), ' Norte');

    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar los contactos.');
    expect(grupo(2).getByLabelText('Área')).toHaveValue('Tesorería Norte');
    expect(botonGuardar()).toBeEnabled();
  });

  it('el aviso general queda fuera de la lista de contactos, para que no se pierda al hacer scroll', async () => {
    const { user } = renderForm(
      [ana, bruno, contacto(ID_C, 'Carla Díaz', 'carla@ejemplo.example')],
      () => Promise.resolve({ general: 'No pudimos guardar los contactos.' }),
    );

    await user.click(botonGuardar());

    const aviso = await screen.findByRole('alert');
    // La lista de contactos puede ser larga y desplazarse; el aviso no es parte de ella: está
    // en una zona fija del formulario, antes de la lista, y se ve sin tener que hacer scroll.
    const lista = screen.getByRole('group', { name: 'Contacto 1' }).parentElement;
    expect(lista).not.toContainElement(aviso);
    expect(botonGuardar().closest('form')).toContainElement(aviso);
    expect(aviso.compareDocumentPosition(lista as HTMLElement)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('el aviso general se va al reintentar con éxito', async () => {
    const respuestas: (ErroresDeContactos | undefined)[] = [{ general: 'Falló.' }, undefined];
    const { user } = renderForm([ana], () => Promise.resolve(respuestas.shift()));

    await user.click(botonGuardar());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(botonGuardar());

    await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('ContactosForm: accesibilidad', () => {
  it('cada botón de eliminar nombra al contacto', () => {
    renderForm([ana, bruno]);

    expect(screen.getByRole('button', { name: 'Eliminar contacto Ana Pérez' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Eliminar contacto Bruno Gómez' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
  });

  it('un contacto sin nombre se nombra por su posición, y el nombre se actualiza al escribirlo', async () => {
    const { user } = renderForm([ana]);

    await user.click(screen.getByRole('button', { name: 'Agregar contacto' }));
    expect(screen.getByRole('button', { name: 'Eliminar contacto 2' })).toBeInTheDocument();

    await user.type(grupo(2).getByLabelText('Nombre'), 'Carla Díaz');

    expect(
      screen.getByRole('button', { name: 'Eliminar contacto Carla Díaz' }),
    ).toBeInTheDocument();
  });

  it('la confirmación de eliminar dice a qué contacto se refiere y se opera con teclado', async () => {
    const { user } = renderForm([ana, bruno]);

    screen.getByRole('button', { name: 'Eliminar contacto Bruno Gómez' }).focus();
    await user.keyboard('{Enter}');

    const dialogo = await screen.findByRole('alertdialog');
    expect(dialogo).toHaveTextContent('Bruno Gómez');
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Bruno Gómez')).toBeInTheDocument();
  });

  it('cada contacto es un grupo con nombre propio', () => {
    renderForm([ana, bruno]);

    expect(screen.getByRole('group', { name: 'Contacto 1' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Contacto 2' })).toBeInTheDocument();
  });

  it('el checkbox se asocia a su etiqueta y se envía su valor', async () => {
    const { user, onSave } = renderForm([ana]);

    await user.click(grupo(1).getByRole('checkbox', { name: 'Recibe rendiciones' }));
    await user.click(botonGuardar());

    const [enviados] = onSave.mock.calls[0] ?? [];
    expect(enviados).toStrictEqual([expect.objectContaining({ recibeRendiciones: true })]);
  });
});
