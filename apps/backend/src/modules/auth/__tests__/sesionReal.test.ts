// Unidad: la limpieza de `sesionesDePrueba()` cuando `preparar()` falla a mitad de camino, con
// `lib/prisma` y `crearSesion` FALSOS (ninguna base real). La limpieza tiene que borrar las cuentas
// de la corrida que hayan quedado, solo esas, y no tocar la base si `preparar()` no llegó a escribir.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const falso = vi.hoisted(() => ({
  create: vi.fn(),
  deleteMany: vi.fn(),
  crearSesion: vi.fn(),
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: { usuario: { create: falso.create, deleteMany: falso.deleteMany } },
}));
vi.mock('../sesiones.service', () => ({ crearSesion: falso.crearSesion }));

import { sesionesDePrueba } from './sesionReal';
import { IDENTIDADES } from './sesionSimulada';

/** Lo que `startsWith` de Prisma haría con estos emails. */
const borraria = (where: { email: { startsWith: string } }, emails: string[]) =>
  emails.filter((email) => email.startsWith(where.email.startsWith));

const emailsCreados = () =>
  falso.create.mock.calls.map(([{ data }]) => (data as { email: string }).email);

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  falso.create.mockImplementation(({ data }: { data: { email: string } }) =>
    Promise.resolve({ id: `id-${++n}`, email: data.email }),
  );
  falso.crearSesion.mockImplementation((id: string) => Promise.resolve({ token: `token-${id}` }));
  falso.deleteMany.mockResolvedValue({ count: 0 });
});

describe('sesionesDePrueba: limpieza ante una preparación parcial', () => {
  it('la primera cuenta se crea y su sesión falla: limpiar() la borra (antes quedaba sin borrar)', async () => {
    falso.crearSesion.mockRejectedValueOnce(new Error('falla al crear la sesión'));
    const sesiones = sesionesDePrueba();

    await expect(sesiones.preparar()).rejects.toThrow('falla al crear la sesión');
    expect(falso.create).toHaveBeenCalledOnce();

    await sesiones.limpiar();
    expect(falso.deleteMany).toHaveBeenCalledOnce();
    const [{ where }] = falso.deleteMany.mock.calls[0] as [
      { where: { email: { startsWith: string } } },
    ];
    expect(borraria(where, emailsCreados())).toEqual(emailsCreados());
  });

  const pasos = IDENTIDADES.flatMap((identidad, i) => [
    [`falla el alta de la cuenta ${i + 1} (${identidad})`, 'create', i] as const,
    [`falla la sesión de la cuenta ${i + 1} (${identidad})`, 'crearSesion', i] as const,
  ]);

  it.each(pasos)('%s: limpiar() borra todas las cuentas de la corrida', async (_caso, paso, i) => {
    const espia = paso === 'create' ? falso.create : falso.crearSesion;
    const original = espia.getMockImplementation();
    let llamada = 0;
    espia.mockImplementation((...args: unknown[]) => {
      if (llamada++ === i) return Promise.reject(new Error(`falla en ${paso}`));
      return (original as (...a: unknown[]) => unknown)(...args);
    });
    const sesiones = sesionesDePrueba();

    await expect(sesiones.preparar()).rejects.toThrow(`falla en ${paso}`);
    await sesiones.limpiar();

    expect(falso.deleteMany).toHaveBeenCalledOnce();
    const [{ where }] = falso.deleteMany.mock.calls[0] as [
      { where: { email: { startsWith: string } } },
    ];
    // Incluye el alta que falló: puede haberse confirmado aunque la respuesta se perdiera.
    expect(borraria(where, emailsCreados())).toEqual(emailsCreados());
  });

  it('si preparar() nunca corrió (p. ej., una guarda lo impidió), limpiar() no toca la base', async () => {
    const sesiones = sesionesDePrueba();
    await sesiones.limpiar();
    expect(falso.deleteMany).not.toHaveBeenCalled();
    expect(falso.create).not.toHaveBeenCalled();
  });

  it('limpiar() es idempotente: se puede llamar de nuevo y vuelve a borrar solo lo de la corrida', async () => {
    const sesiones = sesionesDePrueba();
    await sesiones.preparar();
    expect(falso.create).toHaveBeenCalledTimes(IDENTIDADES.length);

    await sesiones.limpiar();
    falso.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(sesiones.limpiar()).resolves.toBeUndefined();

    expect(falso.deleteMany).toHaveBeenCalledTimes(2);
    expect(falso.deleteMany.mock.calls[1]).toEqual(falso.deleteMany.mock.calls[0]);
    expect(falso.create).toHaveBeenCalledTimes(IDENTIDADES.length); // no escribe nada más
  });

  it('no alcanza cuentas ajenas: ni las de otra corrida cuya marca empieza igual ni otras', async () => {
    const sesiones = sesionesDePrueba();
    await sesiones.preparar();
    await sesiones.limpiar();
    const [{ where }] = falso.deleteMany.mock.calls[0] as [
      { where: { email: { startsWith: string } } },
    ];

    const ajenas = [
      `${sesiones.prefijo}9-administrador@pruebas.example`, // otra corrida: su marca empieza igual
      'qa-admin@empresa.example',
      'consulta@pruebas.example',
      `api-test-0123456789abcdef@pruebas.example`,
    ];
    expect(borraria(where, [...emailsCreados(), ...ajenas])).toEqual(emailsCreados());
    expect(where).toEqual({ email: { startsWith: `${sesiones.prefijo}-` } });
  });
});
