import { erroresDeNotasParaElFormulario } from '@/modules/clientes/components/erroresDeNotasDelCliente';

// Qué se le dice a la operadora cuando el PATCH del cliente salió bien (o no hacía falta) y alguna
// de las dos notas (indicaciones de armado, observaciones internas) no se pudo guardar.

const SIN_GUARDAR = {
  seGuardoElCliente: false,
  seGuardaronIndicaciones: false,
  seGuardaronObservaciones: false,
};

describe('erroresDeNotasParaElFormulario', () => {
  it('solo falla la nota y nada más se guardó: "No pudimos guardar…"', () => {
    expect(
      erroresDeNotasParaElFormulario({
        ...SIN_GUARDAR,
        falloObservaciones: { tipo: 'inesperado' },
      }),
    ).toEqual({
      general: 'No pudimos guardar las observaciones internas. Probá de nuevo en unos segundos.',
    });
  });

  it('con el cliente ya guardado, lo dice', () => {
    expect(
      erroresDeNotasParaElFormulario({
        ...SIN_GUARDAR,
        seGuardoElCliente: true,
        falloObservaciones: { tipo: 'inesperado' },
      }),
    ).toEqual({
      general:
        'Se guardaron los datos del cliente, pero no las observaciones internas. Probá de nuevo en unos segundos.',
    });
  });

  it('conserva el mensaje de HU2.4 cuando falla solo la indicación', () => {
    expect(
      erroresDeNotasParaElFormulario({
        ...SIN_GUARDAR,
        seGuardoElCliente: true,
        falloIndicaciones: { tipo: 'cliente-no-activo', estado: 'SUSPENDIDO' },
      }),
    ).toEqual({
      general:
        'Se guardaron los datos del cliente, pero no las indicaciones de armado. El cliente está suspendido: reactivalo para editar sus indicaciones.',
    });
  });

  it('un texto rechazado por el servidor se marca en su campo, con el encabezado aparte', () => {
    expect(
      erroresDeNotasParaElFormulario({
        ...SIN_GUARDAR,
        falloObservaciones: {
          tipo: 'datos-invalidos',
          detalles: [
            {
              campo: 'observaciones',
              mensaje: 'Las observaciones no pueden superar los 1000 caracteres.',
            },
          ],
        },
      }),
    ).toEqual({
      observaciones: 'Las observaciones no pueden superar los 1000 caracteres.',
      general: 'No pudimos guardar las observaciones internas.',
    });
  });

  it('sin un mensaje utilizable del servidor, pide revisar el texto', () => {
    expect(
      erroresDeNotasParaElFormulario({
        ...SIN_GUARDAR,
        falloObservaciones: { tipo: 'datos-invalidos', detalles: [] },
      }).observaciones,
    ).toBe('Revisá el texto de las observaciones.');
  });

  it('si el cliente ya no existe, lo dice', () => {
    expect(
      erroresDeNotasParaElFormulario({
        ...SIN_GUARDAR,
        falloObservaciones: { tipo: 'no-existe' },
      }).general,
    ).toBe('No pudimos guardar las observaciones internas. El cliente ya no existe.');
  });

  it('falla una nota y la otra sí se guardó: dice cuál', () => {
    expect(
      erroresDeNotasParaElFormulario({
        ...SIN_GUARDAR,
        seGuardaronObservaciones: true,
        falloIndicaciones: { tipo: 'inesperado' },
      }).general,
    ).toBe(
      'Se guardaron las observaciones internas, pero no las indicaciones de armado. Probá de nuevo en unos segundos.',
    );
  });

  it('con el cliente y una nota guardados, enumera las dos cosas', () => {
    expect(
      erroresDeNotasParaElFormulario({
        ...SIN_GUARDAR,
        seGuardoElCliente: true,
        seGuardaronObservaciones: true,
        falloIndicaciones: { tipo: 'inesperado' },
      }).general,
    ).toBe(
      'Se guardaron los datos del cliente y las observaciones internas, pero no las indicaciones de armado. Probá de nuevo en unos segundos.',
    );
  });

  it('fallan las dos notas: las nombra y da el motivo de cada una', () => {
    expect(
      erroresDeNotasParaElFormulario({
        ...SIN_GUARDAR,
        seGuardoElCliente: true,
        falloIndicaciones: { tipo: 'inesperado' },
        falloObservaciones: { tipo: 'no-existe' },
      }).general,
    ).toBe(
      'Se guardaron los datos del cliente, pero no las indicaciones de armado ni las observaciones internas. Indicaciones de armado: Probá de nuevo en unos segundos. Observaciones internas: El cliente ya no existe.',
    );
  });

  it('fallan las dos y una es un texto inválido: esa va al campo y la otra al aviso', () => {
    expect(
      erroresDeNotasParaElFormulario({
        ...SIN_GUARDAR,
        falloIndicaciones: { tipo: 'inesperado' },
        falloObservaciones: {
          tipo: 'datos-invalidos',
          detalles: [
            {
              campo: 'observaciones',
              mensaje: 'Las observaciones no pueden superar los 1000 caracteres.',
            },
          ],
        },
      }),
    ).toEqual({
      observaciones: 'Las observaciones no pueden superar los 1000 caracteres.',
      general:
        'No pudimos guardar las indicaciones de armado ni las observaciones internas. Probá de nuevo en unos segundos.',
    });
  });
});
