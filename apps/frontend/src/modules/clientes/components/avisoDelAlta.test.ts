import { avisoDeAltaConFallos } from '@/modules/clientes/components/avisoDelAlta';

// El aviso de la página cuando el cliente se creó pero alguna de sus notas (indicaciones de
// armado, observaciones internas) no se pudo guardar. El cliente existe: el aviso no sugiere
// volver a crearlo, dice qué se guardó y qué no, y manda a "Editar".

const REGISTRADO = 'Se registró el cliente Empresa de Ejemplo S.A. (CUIT 20-12345678-6)';

describe('avisoDeAltaConFallos', () => {
  it('falla solo la indicación y no se guardó ninguna otra nota', () => {
    expect(
      avisoDeAltaConFallos(REGISTRADO, {
        motivos: { indicaciones: 'Probá de nuevo en unos segundos.' },
        guardadas: [],
      }),
    ).toBe(
      `${REGISTRADO}, pero no pudimos guardar sus indicaciones de armado. Probá de nuevo en unos segundos. Podés cargarlas desde "Editar".`,
    );
  });

  it('falla solo la observación', () => {
    expect(
      avisoDeAltaConFallos(REGISTRADO, {
        motivos: { observaciones: 'Probá de nuevo en unos segundos.' },
        guardadas: [],
      }),
    ).toBe(
      `${REGISTRADO}, pero no pudimos guardar sus observaciones internas. Probá de nuevo en unos segundos. Podés cargarlas desde "Editar".`,
    );
  });

  it('falla una nota y la otra sí se guardó: lo dice', () => {
    expect(
      avisoDeAltaConFallos(REGISTRADO, {
        motivos: { indicaciones: 'Probá de nuevo en unos segundos.' },
        guardadas: ['observaciones'],
      }),
    ).toBe(
      `${REGISTRADO} y se guardaron sus observaciones internas, pero no pudimos guardar sus indicaciones de armado. Probá de nuevo en unos segundos. Podés cargarlas desde "Editar".`,
    );
  });

  it('fallan las dos: las nombra y da el motivo de cada una', () => {
    expect(
      avisoDeAltaConFallos(REGISTRADO, {
        motivos: {
          indicaciones: 'Probá de nuevo en unos segundos.',
          observaciones: 'El cliente ya no existe.',
        },
        guardadas: [],
      }),
    ).toBe(
      `${REGISTRADO}, pero no pudimos guardar sus indicaciones de armado ni sus observaciones internas. Indicaciones de armado: Probá de nuevo en unos segundos. Observaciones internas: El cliente ya no existe. Podés cargarlas desde "Editar".`,
    );
  });

  it('nunca sugiere volver a registrar el cliente', () => {
    const aviso = avisoDeAltaConFallos(REGISTRADO, {
      motivos: { observaciones: 'Probá de nuevo en unos segundos.' },
      guardadas: [],
    });

    expect(aviso).not.toMatch(/volv[eé]|registr[aá]r? de nuevo|crear/i);
    expect(aviso.startsWith(REGISTRADO)).toBe(true);
  });
});
