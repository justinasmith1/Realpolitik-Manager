import type { TipoDocumento } from '@realpolitik/shared';

import {
  cambiosDeTipoDocumento,
  hayCambios,
  sinCambiosRespectoDe,
  tipoDocumentoAValoresForm,
  tipoDocumentoFormResolver,
  type TipoDocumentoFormValues,
} from '@/modules/tipos-documento/components/tipoDocumentoForm.validation';

const tipo: TipoDocumento = {
  id: '11111111-1111-4111-a111-111111111111',
  nombre: 'Constancia ARCA',
  descripcion: 'Inscripción',
  activo: true,
  creadoEn: new Date('2026-10-21T12:00:00.000Z'),
  actualizadoEn: new Date('2026-10-21T12:00:00.000Z'),
};

/** El resolver es sincrónico, pero RHF lo tipa como posible promesa. */
async function validar(valores: TipoDocumentoFormValues) {
  return await tipoDocumentoFormResolver(valores, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  });
}

describe('tipoDocumentoFormResolver (reglas de shared)', () => {
  it('con datos válidos entrega lo que se enviaría: recortado y la descripción vacía como null', async () => {
    const resultado = await validar({ nombre: '  Factura  ', descripcion: '   ' });

    expect(resultado.errors).toEqual({});
    expect(resultado.values).toEqual({ nombre: 'Factura', descripcion: null });
  });

  it('el nombre es obligatorio (también si solo tiene espacios)', async () => {
    for (const nombre of ['', '   ']) {
      const { errors } = await validar({ nombre, descripcion: '' });
      expect(errors.nombre?.message).toBe('El nombre es obligatorio.');
    }
  });

  it('el nombre admite hasta 100 caracteres', async () => {
    const valido = await validar({ nombre: 'x'.repeat(100), descripcion: '' });
    const largo = await validar({ nombre: 'x'.repeat(101), descripcion: '' });

    expect(valido.errors).toEqual({});
    expect(largo.errors.nombre?.message).toBe('El nombre no puede superar los 100 caracteres.');
  });

  it('la descripción admite hasta 500 caracteres', async () => {
    const valida = await validar({ nombre: 'OC', descripcion: 'x'.repeat(500) });
    const larga = await validar({ nombre: 'OC', descripcion: 'x'.repeat(501) });

    expect(valida.errors).toEqual({});
    expect(larga.errors.descripcion?.message).toMatch(/500 caracteres/);
  });

  it('rechaza caracteres de control en los dos campos (la descripción es de una sola línea)', async () => {
    const { errors } = await validar({ nombre: 'Fac\u0000tura', descripcion: 'Una\nlínea' });

    expect(errors.nombre).toBeDefined();
    expect(errors.descripcion).toBeDefined();
  });
});

describe('tipoDocumentoAValoresForm', () => {
  it('usa los datos del tipo, con la descripción null como texto vacío', () => {
    expect(tipoDocumentoAValoresForm(tipo)).toEqual({
      nombre: 'Constancia ARCA',
      descripcion: 'Inscripción',
    });
    expect(tipoDocumentoAValoresForm({ ...tipo, descripcion: null }).descripcion).toBe('');
  });
});

describe('sinCambiosRespectoDe', () => {
  const iniciales = { nombre: 'Constancia ARCA', descripcion: '' };

  const conNombre = (nombre: string) => ({ ...iniciales, nombre });

  it('igual a los iniciales, o con espacios en los bordes, es "sin cambios"', () => {
    const conEspacios = { nombre: ' Constancia ARCA ', descripcion: '  ' };

    expect(sinCambiosRespectoDe(iniciales, iniciales)).toBe(true);
    expect(sinCambiosRespectoDe(conEspacios, iniciales)).toBe(true);
  });

  it('cambiar mayúsculas o acentos del nombre es un cambio', () => {
    expect(sinCambiosRespectoDe(conNombre('constancia arca'), iniciales)).toBe(false);
    expect(sinCambiosRespectoDe(conNombre('Constancía ARCA'), iniciales)).toBe(false);
  });

  it('cargar una descripción es un cambio', () => {
    expect(sinCambiosRespectoDe({ ...iniciales, descripcion: 'Nueva' }, iniciales)).toBe(false);
  });
});

describe('cambiosDeTipoDocumento', () => {
  it('solo el nombre, si solo cambió el nombre', () => {
    expect(
      cambiosDeTipoDocumento({ nombre: 'Constancia de ARCA', descripcion: 'Inscripción' }, tipo),
    ).toEqual({ nombre: 'Constancia de ARCA' });
  });

  it('solo la descripción, si solo cambió la descripción', () => {
    const datos = { nombre: 'Constancia ARCA', descripcion: 'Otra' };

    expect(cambiosDeTipoDocumento(datos, tipo)).toEqual({ descripcion: 'Otra' });
  });

  it('una descripción vaciada viaja como null (borrarla)', () => {
    expect(cambiosDeTipoDocumento({ nombre: 'Constancia ARCA', descripcion: null }, tipo)).toEqual({
      descripcion: null,
    });
  });

  it('cambiar solo mayúsculas del propio nombre se envía (la unicidad la decide el backend)', () => {
    expect(
      cambiosDeTipoDocumento({ nombre: 'constancia arca', descripcion: 'Inscripción' }, tipo),
    ).toEqual({ nombre: 'constancia arca' });
  });

  it('sin cambios devuelve {}: no hay nada que enviar', () => {
    const cambios = cambiosDeTipoDocumento(
      { nombre: 'Constancia ARCA', descripcion: 'Inscripción' },
      tipo,
    );

    expect(cambios).toEqual({});
    expect(hayCambios(cambios)).toBe(false);
    expect(hayCambios({ descripcion: null })).toBe(true);
  });
});
