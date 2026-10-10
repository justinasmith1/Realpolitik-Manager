import type * as Shared from '@realpolitik/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ClienteForm } from '@/modules/clientes/components/ClienteForm';
import { elegirOpcion } from '@/test/select';

// Simula una evolución de shared: un campo obligatorio nuevo que este formulario todavía no
// muestra. El schema real sigue validando todo lo demás.
vi.mock('@realpolitik/shared', async (importOriginal) => {
  const shared = await importOriginal<typeof Shared>();
  return {
    ...shared,
    CreateClienteSchema: shared.CreateClienteSchema.superRefine((_datos, ctx) => {
      ctx.addIssue({ code: 'custom', path: ['campoNuevo'], message: 'Required' });
    }),
  };
});

describe('validación del formulario de cliente', () => {
  it('si shared rechaza un dato que el formulario no muestra, no envía y avisa', async () => {
    const onSubmit = vi.fn<(datos: unknown) => Promise<undefined>>();
    const user = userEvent.setup();
    render(
      <ClienteForm
        onSubmit={onSubmit}
        onCancel={() => undefined}
        textoEnviar="Registrar cliente"
      />,
    );

    await user.type(screen.getByLabelText('Razón social'), 'Empresa de Ejemplo S.A.');
    await user.type(screen.getByLabelText('Denominación'), 'Empresa Ejemplo');
    await user.type(screen.getByLabelText('CUIT'), '20-12345678-6');
    await elegirOpcion(user, screen.getByLabelText('Sector'), 'PRIVADO');
    await elegirOpcion(user, screen.getByLabelText('Condición frente al IVA'), 'EXENTO');
    await user.type(screen.getByLabelText('Email de contacto'), 'admin@empresa.example');
    await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Revisá los datos.');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
  });
});
