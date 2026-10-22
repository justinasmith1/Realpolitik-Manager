import {
  erroresParaElFormulario,
  MENSAJE_NO_EXISTE,
  mensajeFalloCambioEstado,
  mensajeNombreDuplicado,
} from '@/modules/tipos-documento/components/erroresDeTipoDocumento';

const ID = '22222222-2222-4222-a222-222222222222';
const INESPERADO = 'No pudimos crear el tipo de documento.';

describe('mensajeNombreDuplicado', () => {
  it('con un tipo activo dice cuál es', () => {
    expect(mensajeNombreDuplicado({ id: ID, nombre: 'Constancia ARCA', activo: true })).toBe(
      'Ya existe «Constancia ARCA» en el catálogo.',
    );
  });

  it('con un tipo desactivado dice dónde encontrarlo, sin ofrecer reactivarlo acá', () => {
    expect(mensajeNombreDuplicado({ id: ID, nombre: 'Print', activo: false })).toBe(
      'Ya existe «Print» en el catálogo, pero está desactivado. Podés reactivarlo desde la lista activando «Incluir desactivados».',
    );
  });

  it('sin el tipo existente no afirma si está activo o no', () => {
    expect(mensajeNombreDuplicado(null)).toBe('Ya existe un tipo de documento con ese nombre.');
  });
});

describe('erroresParaElFormulario', () => {
  it('el nombre duplicado va al campo Nombre', () => {
    const errores = erroresParaElFormulario(
      {
        tipo: 'nombre-duplicado',
        tipoDocumentoExistente: { id: ID, nombre: 'Print', activo: true },
      },
      INESPERADO,
    );

    expect(errores).toEqual({ campos: { nombre: 'Ya existe «Print» en el catálogo.' } });
  });

  it('los datos inválidos van a su campo, con el mensaje de shared o uno genérico', () => {
    const errores = erroresParaElFormulario(
      {
        tipo: 'datos-invalidos',
        detalles: [
          { campo: 'nombre', mensaje: 'El nombre no puede superar los 100 caracteres.' },
          { campo: 'descripcion', mensaje: 'Expected string, received number' },
        ],
      },
      INESPERADO,
    );

    expect(errores.campos).toEqual({
      nombre: 'El nombre no puede superar los 100 caracteres.',
      descripcion: 'Revisá este dato.',
    });
    expect(errores.general).toBe('Algunos datos no son válidos. Revisá los campos marcados.');
  });

  it('un error que no es de un campo del formulario va al aviso general, sin datos crudos', () => {
    const errores = erroresParaElFormulario(
      {
        tipo: 'datos-invalidos',
        detalles: [{ campo: 'body', mensaje: 'El JSON enviado está mal formado' }],
      },
      INESPERADO,
    );

    expect(errores).toEqual({ campos: {}, general: 'El JSON enviado está mal formado' });
  });

  it('sin detalles útiles, un aviso general genérico', () => {
    const errores = erroresParaElFormulario({ tipo: 'datos-invalidos', detalles: [] }, INESPERADO);

    expect(errores.general).toBe('Algunos datos no son válidos. Revisá los datos ingresados.');
  });

  it('un tipo que ya no existe se informa en el aviso general', () => {
    expect(erroresParaElFormulario({ tipo: 'no-existe' }, INESPERADO)).toEqual({
      general: MENSAJE_NO_EXISTE,
    });
    expect(MENSAJE_NO_EXISTE).toBe(
      'Este tipo de documento ya no existe. Actualizá el listado para continuar.',
    );
  });

  it('lo inesperado usa el mensaje de la acción', () => {
    expect(erroresParaElFormulario({ tipo: 'inesperado' }, INESPERADO)).toEqual({
      general: INESPERADO,
    });
  });
});

describe('mensajeFalloCambioEstado', () => {
  it('dice si el tipo ya no existe', () => {
    expect(mensajeFalloCambioEstado({ tipo: 'no-existe' }, 'desactivar')).toBe(
      'Este tipo de documento ya no existe.',
    );
  });

  it.each(['desactivar', 'reactivar'] as const)('lo inesperado nombra la acción: %s', (accion) => {
    expect(mensajeFalloCambioEstado({ tipo: 'inesperado' }, accion)).toBe(
      `No pudimos ${accion} el tipo de documento. Probá de nuevo en unos segundos.`,
    );
  });
});
