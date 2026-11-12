// El limitador con operaciones controladas a mano: cada una termina cuando el test lo decide, así
// el orden y los estados intermedios son deterministas (sin temporizadores ni esperas reales).

import { describe, expect, it } from 'vitest';

import { CapacidadAgotadaError, LimitadorDeConcurrencia } from './limitadorDeConcurrencia';

/** Una operación que no termina hasta que se la resuelve o rechaza desde el test. */
function controlada<T = string>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  let iniciada = false;
  const promesa = new Promise<T>((resolve, reject) => {
    resolver = resolve;
    rechazar = reject;
  });
  const operacion = () => {
    iniciada = true;
    return promesa;
  };
  return {
    operacion,
    resolver,
    rechazar,
    get iniciada() {
      return iniciada;
    },
  };
}

/** Deja correr las microtareas pendientes (continuaciones de promesas). */
const vaciarMicrotareas = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('LimitadorDeConcurrencia', () => {
  it('ejecuta hasta el máximo a la vez y deja esperando a las siguientes', async () => {
    const limitador = new LimitadorDeConcurrencia({ maximoSimultaneas: 2, maximoEnEspera: 2 });
    const ops = [controlada(), controlada(), controlada(), controlada()];

    const resultados = ops.map((op) => limitador.ejecutar(op.operacion));
    await vaciarMicrotareas();

    expect(ops.map((op) => op.iniciada)).toEqual([true, true, false, false]);
    expect([limitador.enCurso, limitador.enEspera]).toEqual([2, 2]);

    ops[0]?.resolver('a');
    await vaciarMicrotareas();
    // La que termina pasa su lugar a la primera en espera (orden de llegada).
    expect(ops.map((op) => op.iniciada)).toEqual([true, true, true, false]);
    expect([limitador.enCurso, limitador.enEspera]).toEqual([2, 1]);

    ops[1]?.resolver('b');
    ops[2]?.resolver('c');
    await vaciarMicrotareas();
    ops[3]?.resolver('d');

    await expect(Promise.all(resultados)).resolves.toEqual(['a', 'b', 'c', 'd']);
    expect([limitador.enCurso, limitador.enEspera]).toEqual([0, 0]);
  });

  it('con todo ocupado y la espera llena, rechaza al instante sin ejecutar la operación', async () => {
    const limitador = new LimitadorDeConcurrencia({ maximoSimultaneas: 1, maximoEnEspera: 1 });
    const enCurso = controlada();
    const enEspera = controlada();
    const sobrante = controlada();

    const primera = limitador.ejecutar(enCurso.operacion);
    const segunda = limitador.ejecutar(enEspera.operacion);
    await expect(limitador.ejecutar(sobrante.operacion)).rejects.toBeInstanceOf(
      CapacidadAgotadaError,
    );

    expect(sobrante.iniciada).toBe(false);
    expect([limitador.enCurso, limitador.enEspera]).toEqual([1, 1]);

    enCurso.resolver('ok');
    await vaciarMicrotareas();
    enEspera.resolver('ok');
    await expect(Promise.all([primera, segunda])).resolves.toEqual(['ok', 'ok']);
  });

  it('sin espera (maximoEnEspera 0), rechaza apenas se llena', async () => {
    const limitador = new LimitadorDeConcurrencia({ maximoSimultaneas: 1, maximoEnEspera: 0 });
    const op = controlada();
    const primera = limitador.ejecutar(op.operacion);

    await expect(limitador.ejecutar(() => Promise.resolve('x'))).rejects.toBeInstanceOf(
      CapacidadAgotadaError,
    );
    op.resolver('ok');
    await expect(primera).resolves.toBe('ok');
  });

  it('libera el lugar cuando la operación falla, y propaga el error tal cual', async () => {
    const limitador = new LimitadorDeConcurrencia({ maximoSimultaneas: 1, maximoEnEspera: 1 });
    const falla = controlada();
    const siguiente = controlada();
    const error = new Error('fallo de la operación');

    const primera = limitador.ejecutar(falla.operacion);
    const segunda = limitador.ejecutar(siguiente.operacion);
    falla.rechazar(error);

    await expect(primera).rejects.toBe(error);
    await vaciarMicrotareas();
    expect(siguiente.iniciada).toBe(true);
    siguiente.resolver('ok');
    await expect(segunda).resolves.toBe('ok');
    expect([limitador.enCurso, limitador.enEspera]).toEqual([0, 0]);
  });

  it('libera el lugar también si la operación lanza de forma sincrónica', async () => {
    const limitador = new LimitadorDeConcurrencia({ maximoSimultaneas: 1, maximoEnEspera: 0 });

    await expect(
      limitador.ejecutar(() => {
        throw new Error('sincrónico');
      }),
    ).rejects.toThrow('sincrónico');
    await expect(limitador.ejecutar(() => Promise.resolve('libre'))).resolves.toBe('libre');
    expect(limitador.enCurso).toBe(0);
  });

  it('después de una saturación vuelve a aceptar: no queda bloqueado', async () => {
    const limitador = new LimitadorDeConcurrencia({ maximoSimultaneas: 2, maximoEnEspera: 3 });
    for (let ronda = 0; ronda < 3; ronda += 1) {
      const ops = Array.from({ length: 5 }, () => controlada<number>());
      const resultados = ops.map((op) => limitador.ejecutar(op.operacion));
      await expect(limitador.ejecutar(() => Promise.resolve(-1))).rejects.toBeInstanceOf(
        CapacidadAgotadaError,
      );

      for (const [indice, op] of ops.entries()) {
        await vaciarMicrotareas();
        op.resolver(indice);
      }

      await expect(Promise.all(resultados)).resolves.toEqual([0, 1, 2, 3, 4]);
      expect([limitador.enCurso, limitador.enEspera]).toEqual([0, 0]);
    }
  });

  it('el error de capacidad no incluye nada de la operación', async () => {
    const limitador = new LimitadorDeConcurrencia({ maximoSimultaneas: 1, maximoEnEspera: 0 });
    const op = controlada();
    void limitador.ejecutar(op.operacion);

    const error = await limitador
      .ejecutar(() => Promise.resolve('contraseña-ficticia'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CapacidadAgotadaError);
    expect((error as Error).message).not.toContain('contraseña');
    op.resolver('ok');
  });

  it.each([
    ['simultáneas 0', { maximoSimultaneas: 0, maximoEnEspera: 1 }],
    ['simultáneas no entera', { maximoSimultaneas: 1.5, maximoEnEspera: 1 }],
    ['espera negativa', { maximoSimultaneas: 1, maximoEnEspera: -1 }],
  ])('rechaza una configuración con %s', (_caso, opciones) => {
    expect(() => new LimitadorDeConcurrencia(opciones)).toThrow(RangeError);
  });
});
