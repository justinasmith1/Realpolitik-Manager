import type { NuevoCliente } from '@/modules/clientes/api/clientes.api';
import {
  camposModificados,
  construirCambiosCliente,
  hayCambios,
} from '@/modules/clientes/components/cambiosDeEdicion';
import {
  valoresInicialesClienteForm,
  type CampoClienteForm,
  type ClienteFormValues,
} from '@/modules/clientes/components/clienteForm.validation';

// Datos ficticios: el formulario completo, ya validado (lo que entrega el resolver).
const publico: NuevoCliente = {
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@municipio.example',
  canalEntrega: 'CORREO',
};

const inicialSinPeriodicidad: ClienteFormValues = {
  ...valoresInicialesClienteForm,
  razonSocial: 'Municipio de Ejemplo',
};
const inicialConPeriodicidad: ClienteFormValues = {
  ...inicialSinPeriodicidad,
  periodicidadTipo: 'MENSUAL',
  periodicidadDiaLimite: '10',
};

const modificados = (...campos: CampoClienteForm[]) => new Set(campos);

describe('camposModificados', () => {
  it('toma solo los campos marcados en true de dirtyFields', () => {
    expect(camposModificados({ razonSocial: true, cuit: false, sector: undefined })).toEqual(
      new Set(['razonSocial']),
    );
  });
});

describe('construirCambiosCliente', () => {
  it('sin campos modificados devuelve {}: no hay nada que enviar', () => {
    const cambios = construirCambiosCliente(publico, modificados(), inicialSinPeriodicidad);

    expect(cambios).toEqual({});
    expect(hayCambios(cambios)).toBe(false);
  });

  it('un campo suelto viaja solo, con el valor normalizado', () => {
    expect(
      construirCambiosCliente(publico, modificados('emailContacto'), inicialSinPeriodicidad),
    ).toEqual({ emailContacto: 'compras@municipio.example' });
  });

  it('un subtipo modificado en un cliente que quedó privado no viaja (no aplica)', () => {
    const privado: NuevoCliente = { ...publico, sector: 'PRIVADO', subtipo: undefined };

    expect(
      construirCambiosCliente(privado, modificados('subtipo'), inicialSinPeriodicidad),
    ).toEqual({});
  });

  it('la URL de un canal que no es el actual no viaja', () => {
    expect(
      construirCambiosCliente(publico, modificados('portalUrl'), inicialSinPeriodicidad),
    ).toEqual({});
  });

  it('periodicidad: "Sin configurar" sobre una existente es null; sobre ninguna, no viaja', () => {
    expect(
      construirCambiosCliente(publico, modificados('periodicidadTipo'), inicialConPeriodicidad),
    ).toEqual({ periodicidad: null });
    expect(
      construirCambiosCliente(publico, modificados('periodicidadTipo'), inicialSinPeriodicidad),
    ).toEqual({});
  });

  it('periodicidad: cualquier parte modificada envía el objeto completo', () => {
    const conPeriodicidad: NuevoCliente = {
      ...publico,
      periodicidad: { tipo: 'BIMESTRAL', diaLimite: 15, mesInicioCiclo: 3 },
    };

    expect(
      construirCambiosCliente(
        conPeriodicidad,
        modificados('periodicidadMesInicioCiclo'),
        inicialConPeriodicidad,
      ),
    ).toEqual({ periodicidad: { tipo: 'BIMESTRAL', diaLimite: 15, mesInicioCiclo: 3 } });
  });
});
