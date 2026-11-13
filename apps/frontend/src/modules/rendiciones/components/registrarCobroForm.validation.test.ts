import { hoyEnBuenosAires } from '@realpolitik/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ordenDeCamposCobro,
  registrarCobroResolver,
  valoresInicialesCobro,
  type RegistrarCobroFormValues,
} from '@/modules/rendiciones/components/registrarCobroForm.validation';

// El formulario del cobro (HU3.10): valida con `RegistrarCobroSchema` de shared, la misma regla que
// aplica el backend. La fecha va primero; la nota vacía se manda como null.

/** El día siguiente a `dia` (`AAAA-MM-DD`): una fecha futura que no se vuelve válida con el tiempo. */
const diaSiguiente = (dia: string): string =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  // 13/11/2026, 12:00 en Buenos Aires.
  vi.useFakeTimers({ now: new Date('2026-11-13T15:00:00.000Z'), toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const resolver = (valores: RegistrarCobroFormValues) =>
  registrarCobroResolver(valores, undefined, {
    criteriaMode: 'firstError',
    fields: {},
    shouldUseNativeValidation: false,
  }) as {
    values: Record<string, unknown>;
    errors: Record<string, { message?: string } | undefined>;
  };

describe('valoresInicialesCobro', () => {
  it('sin cobro: la fecha de hoy (Buenos Aires) y la nota vacía', () => {
    expect(valoresInicialesCobro(null)).toEqual({ fecha: '2026-11-13', nota: '' });
  });

  it('a las 22:00 en Buenos Aires, hoy sigue siendo el día de Buenos Aires', () => {
    vi.setSystemTime(new Date('2026-11-14T01:00:00.000Z'));
    expect(valoresInicialesCobro(null).fecha).toBe('2026-11-13');
  });

  it('con cobro: los valores guardados', () => {
    expect(valoresInicialesCobro({ fecha: '2026-11-10', nota: 'Avisó por mail' })).toEqual({
      fecha: '2026-11-10',
      nota: 'Avisó por mail',
    });
  });

  it('con cobro sin nota: la nota vacía', () => {
    expect(valoresInicialesCobro({ fecha: '2026-11-10', nota: null }).nota).toBe('');
  });
});

describe('registrarCobroResolver', () => {
  it('el orden de los campos pone la fecha primero', () => {
    expect(ordenDeCamposCobro).toEqual(['fecha', 'nota']);
  });

  it('entrega fecha y nota recortada', () => {
    expect(resolver({ fecha: '2026-11-10', nota: '  Avisó por mail  ' })).toEqual({
      values: { fecha: '2026-11-10', nota: 'Avisó por mail' },
      errors: {},
    });
  });

  it.each(['', '   '])('la nota %j se manda como null', (nota) => {
    expect(resolver({ fecha: '2026-11-10', nota }).values).toEqual({
      fecha: '2026-11-10',
      nota: null,
    });
  });

  it('acepta hoy', () => {
    expect(resolver({ fecha: '2026-11-13', nota: '' }).errors).toEqual({});
  });

  it('una fecha futura: error en fecha, con el mensaje de shared', () => {
    const { errors } = resolver({ fecha: diaSiguiente(hoyEnBuenosAires()), nota: '' });
    expect(errors.fecha?.message).toBe('La fecha del cobro no puede ser posterior a hoy.');
    expect(errors.nota).toBeUndefined();
  });

  it.each(['', '2026-02-30', '10/11/2026'])('la fecha %j: error en fecha', (fecha) => {
    expect(resolver({ fecha, nota: '' }).errors.fecha?.message).toBe(
      'Ingresá una fecha válida (AAAA-MM-DD).',
    );
  });

  it('una nota de 300 caracteres es válida y una de 301, no', () => {
    expect(resolver({ fecha: '2026-11-10', nota: 'a'.repeat(300) }).errors).toEqual({});
    expect(resolver({ fecha: '2026-11-10', nota: 'a'.repeat(301) }).errors.nota?.message).toBe(
      'La nota debe tener entre 1 y 300 caracteres.',
    );
  });
});
