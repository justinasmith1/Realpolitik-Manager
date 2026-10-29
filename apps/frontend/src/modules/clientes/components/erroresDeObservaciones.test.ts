import { motivoFalloObservaciones } from '@/modules/clientes/components/erroresDeObservaciones';

describe('motivoFalloObservaciones', () => {
  it('un texto rechazado usa el mensaje del servidor', () => {
    expect(
      motivoFalloObservaciones({
        tipo: 'datos-invalidos',
        detalles: [
          {
            campo: 'observaciones',
            mensaje: 'Las observaciones no pueden superar los 1000 caracteres.',
          },
        ],
      }),
    ).toBe('Las observaciones no pueden superar los 1000 caracteres.');
  });

  it('sin un mensaje pensado para personas, pide revisar el texto', () => {
    expect(motivoFalloObservaciones({ tipo: 'datos-invalidos', detalles: [] })).toBe(
      'Revisá el texto de las observaciones.',
    );
    expect(
      motivoFalloObservaciones({
        tipo: 'datos-invalidos',
        detalles: [{ campo: 'observaciones', mensaje: 'Required' }],
      }),
    ).toBe('Revisá el texto de las observaciones.');
  });

  it('un cliente que ya no existe', () => {
    expect(motivoFalloObservaciones({ tipo: 'no-existe' })).toBe('El cliente ya no existe.');
  });

  it('un error inesperado no muestra detalles técnicos', () => {
    expect(motivoFalloObservaciones({ tipo: 'inesperado' })).toBe(
      'Probá de nuevo en unos segundos.',
    );
  });
});
