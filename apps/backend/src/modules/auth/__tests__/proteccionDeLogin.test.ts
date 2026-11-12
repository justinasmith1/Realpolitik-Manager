// Protección del login con un reloj controlado: sin esperas reales.

import { describe, expect, it } from 'vitest';

import {
  BLOQUEO_POR_ORIGEN_MS,
  DEMORAS_POR_CUENTA_MS,
  FALLOS_ANTES_DE_DEMORA,
  FALLOS_POR_ORIGEN,
  limitePorOrigenAplicable,
  OLVIDO_DE_FALLOS_MS,
  ProteccionDeLogin,
  type ResultadoDeReserva,
} from '../proteccionDeLogin';

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;

function conReloj(inicio = 1_000_000) {
  const reloj = { ahora: inicio };
  const proteccion = new ProteccionDeLogin({ ahora: () => reloj.ahora });
  return { reloj, proteccion };
}

function permitido(resultado: ResultadoDeReserva) {
  if (!resultado.permitido) throw new Error(`se esperaba permitido, fue ${resultado.motivo}`);
  return resultado.intento;
}

/** Si se permitiría un intento ahora; si se permite, lo libera (no deja una reserva colgada). */
function puede(proteccion: ProteccionDeLogin, email: string, ip: string): ResultadoDeReserva {
  const resultado = proteccion.reservar(email, ip);
  if (resultado.permitido) resultado.intento.liberar();
  return resultado;
}

/** Registra `n` fallos seguidos de `email` desde `ip`. */
function fallar(proteccion: ProteccionDeLogin, email: string, n: number, ip = '10.0.0.1') {
  for (let i = 0; i < n; i += 1) permitido(proteccion.reservar(email, ip)).fallo();
}

describe('demora por cuenta', () => {
  it(`no hay espera hasta el ${FALLOS_ANTES_DE_DEMORA}.º fallo seguido`, () => {
    const { proteccion } = conReloj();
    fallar(proteccion, 'a@x.example', FALLOS_ANTES_DE_DEMORA - 1);

    expect(proteccion.reservar('a@x.example', '10.0.0.1').permitido).toBe(true);
  });

  it('desde el 5.º fallo espera 30 s, 1, 2, 4, 8 y como máximo 15 min', () => {
    const { reloj, proteccion } = conReloj();
    const esperas: number[] = [];
    fallar(proteccion, 'a@x.example', FALLOS_ANTES_DE_DEMORA - 1);
    for (let i = 0; i < 8; i += 1) {
      permitido(proteccion.reservar('a@x.example', `10.0.0.${i}`)).fallo();
      const rechazo = proteccion.reservar('a@x.example', '10.0.9.9');
      if (rechazo.permitido) throw new Error('debía esperar');
      expect(rechazo.motivo).toBe('demora-cuenta');
      esperas.push(rechazo.retryAfterMs);
      reloj.ahora += rechazo.retryAfterMs;
    }

    expect(esperas).toEqual([...DEMORAS_POR_CUENTA_MS, 15 * MINUTO, 15 * MINUTO]);
    expect(Math.max(...esperas)).toBe(15 * MINUTO);
  });

  it('un intento durante la espera no se verifica ni cuenta como fallo', () => {
    const { reloj, proteccion } = conReloj();
    fallar(proteccion, 'a@x.example', FALLOS_ANTES_DE_DEMORA);
    for (let i = 0; i < 10; i += 1)
      expect(proteccion.reservar('a@x.example', '10.0.0.1').permitido).toBe(false);

    reloj.ahora += DEMORAS_POR_CUENTA_MS[0] ?? 0;
    permitido(proteccion.reservar('a@x.example', '10.0.0.1')).fallo();
    const siguiente = proteccion.reservar('a@x.example', '10.0.0.1');

    // 6.º fallo real (los 10 rechazados no contaron): la espera es la segunda, 1 minuto.
    expect(siguiente).toEqual({ permitido: false, motivo: 'demora-cuenta', retryAfterMs: MINUTO });
  });

  it('el límite vence solo: pasada la espera se puede volver a intentar', () => {
    const { reloj, proteccion } = conReloj();
    fallar(proteccion, 'a@x.example', FALLOS_ANTES_DE_DEMORA);

    reloj.ahora += 30 * SEGUNDO - 1;
    expect(proteccion.reservar('a@x.example', '10.0.0.1').permitido).toBe(false);
    reloj.ahora += 1;
    expect(proteccion.reservar('a@x.example', '10.0.0.1').permitido).toBe(true);
  });

  it('un login correcto vuelve la cuenta a cero', () => {
    const { proteccion } = conReloj();
    fallar(proteccion, 'a@x.example', FALLOS_ANTES_DE_DEMORA - 1);
    permitido(proteccion.reservar('a@x.example', '10.0.0.1')).exito();
    fallar(proteccion, 'a@x.example', FALLOS_ANTES_DE_DEMORA - 1);

    expect(proteccion.reservar('a@x.example', '10.0.0.1').permitido).toBe(true);
  });

  it('tras 1 h sin fallos, los anteriores se olvidan', () => {
    const { reloj, proteccion } = conReloj();
    fallar(proteccion, 'a@x.example', FALLOS_ANTES_DE_DEMORA - 1);
    reloj.ahora += OLVIDO_DE_FALLOS_MS;
    fallar(proteccion, 'a@x.example', FALLOS_ANTES_DE_DEMORA - 1);

    expect(proteccion.reservar('a@x.example', '10.0.0.1').permitido).toBe(true);
  });

  it('es la misma para un email que existe y para uno que no (la clave es el email escrito)', () => {
    const { proteccion } = conReloj();
    fallar(proteccion, 'no-existe@x.example', FALLOS_ANTES_DE_DEMORA);

    expect(proteccion.reservar('no-existe@x.example', '10.0.0.1')).toMatchObject({
      motivo: 'demora-cuenta',
    });
    expect(proteccion.reservar('otra@x.example', '10.0.0.1').permitido).toBe(true);
  });
});

describe('límite por origen', () => {
  it(`${FALLOS_POR_ORIGEN} fallos en 15 min bloquean esa IP 15 min para cualquier cuenta`, () => {
    const { reloj, proteccion } = conReloj();
    for (let i = 0; i < FALLOS_POR_ORIGEN - 1; i += 1)
      fallar(proteccion, `c${i}@x.example`, 1, '203.0.113.5');
    expect(puede(proteccion, 'nueva@x.example', '203.0.113.5').permitido).toBe(true);

    fallar(proteccion, 'ultima@x.example', 1, '203.0.113.5');

    expect(puede(proteccion, 'nueva@x.example', '203.0.113.5')).toEqual({
      permitido: false,
      motivo: 'limite-origen',
      retryAfterMs: BLOQUEO_POR_ORIGEN_MS,
    });
    expect(puede(proteccion, 'nueva@x.example', '198.51.100.7').permitido).toBe(true);
    reloj.ahora += BLOQUEO_POR_ORIGEN_MS;
    expect(puede(proteccion, 'nueva@x.example', '203.0.113.5').permitido).toBe(true);
  });

  it('los fallos fuera de la ventana de 15 min no suman', () => {
    const { reloj, proteccion } = conReloj();
    for (let i = 0; i < FALLOS_POR_ORIGEN - 1; i += 1)
      fallar(proteccion, `c${i}@x.example`, 1, '203.0.113.5');
    reloj.ahora += 15 * MINUTO;
    fallar(proteccion, 'otra@x.example', 1, '203.0.113.5');

    expect(puede(proteccion, 'nueva@x.example', '203.0.113.5').permitido).toBe(true);
  });
});

describe('concurrencia por cuenta (reserva sincrónica)', () => {
  it('un segundo intento simultáneo de la misma cuenta se rechaza sin verificar', () => {
    const { proteccion } = conReloj();
    const primero = permitido(proteccion.reservar('a@x.example', '10.0.0.1'));

    expect(proteccion.reservar('a@x.example', '10.0.0.2')).toMatchObject({
      permitido: false,
      motivo: 'concurrencia',
    });
    expect(proteccion.reservar('b@x.example', '10.0.0.1').permitido).toBe(true);

    primero.liberar();
    expect(proteccion.reservar('a@x.example', '10.0.0.2').permitido).toBe(true);
  });

  it('cincuenta reservas en el mismo tick: solo una pasa', () => {
    const { proteccion } = conReloj();
    const resultados = Array.from({ length: 50 }, () =>
      proteccion.reservar('a@x.example', '10.0.0.1'),
    );

    expect(resultados.filter((r) => r.permitido)).toHaveLength(1);
  });

  it('liberar no cuenta como fallo y cerrar dos veces no hace nada', () => {
    const { proteccion } = conReloj();
    for (let i = 0; i < 20; i += 1) {
      const intento = permitido(proteccion.reservar('a@x.example', '10.0.0.1'));
      intento.liberar();
      intento.fallo(); // ya cerrado: se ignora
    }

    expect(proteccion.reservar('a@x.example', '10.0.0.1').permitido).toBe(true);
    expect(proteccion.tamanio.cuentas).toBe(0);
  });
});

describe('memoria acotada', () => {
  // Antes este test exigía que se descartaran las más viejas para hacer lugar: era el defecto del
  // review del PR #47 (inundar el mapa borraba la demora de una cuenta). El tope se mantiene; lo que
  // cambia es que las claves nuevas esperan en lugar de desalojar entradas vigentes.
  it('no guarda más de maximoDeClaves entradas por mapa: las claves nuevas reciben saturación', () => {
    const reloj = { ahora: 1_000_000 };
    const proteccion = new ProteccionDeLogin({ ahora: () => reloj.ahora, maximoDeClaves: 100 });

    const { saturadas } = inundar(proteccion, 'c', 1000);

    expect(saturadas).toBe(900);
    expect(proteccion.tamanio).toEqual({ cuentas: 100, origenes: 100, enCurso: 0 });
  });

  it('las entradas vencidas se podan al escribir, sin temporizadores', () => {
    const { reloj, proteccion } = conReloj();
    for (let i = 0; i < 300; i += 1)
      fallar(proteccion, `c${i}@x.example`, 1, `10.1.${Math.floor(i / 250)}.${i % 250}`);
    expect(proteccion.tamanio.cuentas).toBe(300);

    reloj.ahora += OLVIDO_DE_FALLOS_MS;
    fallar(proteccion, 'nueva@x.example', 1, '10.9.9.9');

    expect(proteccion.tamanio).toEqual({ cuentas: 1, origenes: 1, enCurso: 0 });
  });
});

/**
 * Un fallo por cada email inventado, cada uno desde su IP. Devuelve cuántos intentos se rechazaron
 * por saturación (y no por otro motivo: cualquier otro rechazo hace fallar el test).
 */
function inundar(proteccion: ProteccionDeLogin, prefijo: string, cantidad: number) {
  let saturadas = 0;
  let ultimaEspera = 0;
  for (let i = 0; i < cantidad; i += 1) {
    const ip = `172.16.${Math.floor(i / 250)}.${i % 250}`;
    const resultado = proteccion.reservar(`${prefijo}${i}@inventado.example`, ip);
    if (resultado.permitido) {
      resultado.intento.fallo();
    } else {
      expect(resultado.motivo).toBe('saturacion');
      saturadas += 1;
      ultimaEspera = resultado.retryAfterMs;
    }
  }
  return { saturadas, ultimaEspera };
}

describe('saturación de los contadores (review del PR #47)', () => {
  const VICTIMA = 'victima@estudio.example';

  function conCapacidad(maximoDeClaves: number, limitePorOrigen = false) {
    const reloj = { ahora: 1_000_000 };
    const proteccion = new ProteccionDeLogin({
      ahora: () => reloj.ahora,
      maximoDeClaves,
      limitePorOrigen,
    });
    return { reloj, proteccion };
  }

  it('regresión: inundar el mapa con emails inventados no borra la demora de una cuenta penalizada', () => {
    const { proteccion } = conCapacidad(100);
    fallar(proteccion, VICTIMA, FALLOS_ANTES_DE_DEMORA);
    const antes = proteccion.reservar(VICTIMA, '10.0.0.1');
    expect(antes).toMatchObject({ permitido: false, motivo: 'demora-cuenta' });

    // Con el algoritmo anterior, el email 100 desalojaba a la víctima y recuperaba sus intentos.
    inundar(proteccion, 'ataque', 5000);

    const despues = proteccion.reservar(VICTIMA, '10.0.0.1');
    expect(despues).toMatchObject({ permitido: false, motivo: 'demora-cuenta' });
    if (antes.permitido || despues.permitido) return;
    expect(despues.retryAfterMs).toBe(antes.retryAfterMs);
  });

  it('los fallos contados sin espera tampoco se pierden: la cuenta sigue el escalonamiento', () => {
    const { reloj, proteccion } = conCapacidad(50);
    fallar(proteccion, VICTIMA, FALLOS_ANTES_DE_DEMORA - 1);

    inundar(proteccion, 'ataque', 2000);
    reloj.ahora += 10 * MINUTO; // menos que el olvido de 1 h

    // El fallo siguiente es el 5.º: espera 30 s. Si el contador se hubiera perdido, no esperaría.
    permitido(proteccion.reservar(VICTIMA, '10.0.0.1')).fallo();
    expect(puede(proteccion, VICTIMA, '10.0.0.1')).toMatchObject({
      permitido: false,
      motivo: 'demora-cuenta',
      retryAfterMs: DEMORAS_POR_CUENTA_MS[0],
    });
  });

  it('una cuenta que vuelve tras su espera no reinicia el escalonamiento', () => {
    const { reloj, proteccion } = conCapacidad(100);
    fallar(proteccion, VICTIMA, FALLOS_ANTES_DE_DEMORA);
    inundar(proteccion, 'ataque', 3000);

    reloj.ahora += DEMORAS_POR_CUENTA_MS[0] ?? 0;
    permitido(proteccion.reservar(VICTIMA, '10.0.0.1')).fallo(); // 6.º fallo

    expect(puede(proteccion, VICTIMA, '10.0.0.1')).toMatchObject({
      permitido: false,
      motivo: 'demora-cuenta',
      retryAfterMs: DEMORAS_POR_CUENTA_MS[1],
    });
  });

  it('una clave nueva con el mapa lleno recibe 429 de saturación, con Retry-After hasta el primer vencimiento', () => {
    const { reloj, proteccion } = conCapacidad(10);
    inundar(proteccion, 'lleno', 10);
    reloj.ahora += 5 * MINUTO;

    expect(proteccion.reservar('nueva@estudio.example', '10.0.0.1')).toEqual({
      permitido: false,
      motivo: 'saturacion',
      retryAfterMs: OLVIDO_DE_FALLOS_MS - 5 * MINUTO,
    });
    // Una cuenta que ya tiene entrada sigue pudiendo intentar.
    expect(puede(proteccion, 'lleno3@inventado.example', '10.0.0.1').permitido).toBe(true);
  });

  it('las entradas vencidas se liberan: después del olvido vuelve a haber lugar', () => {
    const { reloj, proteccion } = conCapacidad(10);
    inundar(proteccion, 'lleno', 10);
    expect(puede(proteccion, 'nueva@estudio.example', '10.0.0.1').permitido).toBe(false);

    reloj.ahora += OLVIDO_DE_FALLOS_MS;

    expect(puede(proteccion, 'nueva@estudio.example', '10.0.0.1').permitido).toBe(true);
    permitido(proteccion.reservar('nueva@estudio.example', '10.0.0.1')).fallo();
    expect(proteccion.tamanio.cuentas).toBe(1);
  });

  it('la poda respeta las entradas vigentes y libera solo las vencidas', () => {
    const { reloj, proteccion } = conCapacidad(10);
    inundar(proteccion, 'viejo', 5);
    reloj.ahora += 50 * MINUTO;
    inundar(proteccion, 'reciente', 5);
    reloj.ahora += 10 * MINUTO; // las 5 viejas cumplen la hora; las recientes no

    const { saturadas } = inundar(proteccion, 'otra', 10);

    expect(saturadas).toBe(5);
    expect(proteccion.tamanio.cuentas).toBe(10);
    expect(puede(proteccion, 'reciente2@inventado.example', '10.0.0.1').permitido).toBe(true);
  });

  it('el mapa no crece: miles de claves distintas no pasan el tope', () => {
    const { reloj, proteccion } = conCapacidad(200, true);
    for (let ronda = 0; ronda < 5; ronda += 1) {
      inundar(proteccion, `ronda${ronda}-`, 2000);
      reloj.ahora += 20 * MINUTO;
      expect(proteccion.tamanio.cuentas).toBeLessThanOrEqual(200);
      expect(proteccion.tamanio.origenes).toBeLessThanOrEqual(200);
    }
  });

  it('concurrencia: los intentos en curso de claves nuevas reservan su lugar', () => {
    const { proteccion } = conCapacidad(3);
    const enCurso = [1, 2, 3].map((i) =>
      permitido(proteccion.reservar(`simultaneo${i}@estudio.example`, `10.0.0.${i}`)),
    );

    // Las tres reservas ocupan el lugar aunque todavía no haya ningún fallo guardado.
    expect(proteccion.reservar('cuarto@estudio.example', '10.0.0.4')).toMatchObject({
      permitido: false,
      motivo: 'saturacion',
    });

    for (const intento of enCurso) intento.fallo();
    expect(proteccion.tamanio).toEqual({ cuentas: 3, origenes: 0, enCurso: 0 });
  });

  it('concurrencia: un intento liberado sin veredicto devuelve su lugar', () => {
    const { proteccion } = conCapacidad(1);
    const primero = permitido(proteccion.reservar('a@estudio.example', '10.0.0.1'));
    expect(proteccion.reservar('b@estudio.example', '10.0.0.1')).toMatchObject({
      motivo: 'saturacion',
    });

    primero.liberar();

    expect(puede(proteccion, 'b@estudio.example', '10.0.0.1').permitido).toBe(true);
  });

  it('límite por origen: un origen bloqueado conserva el bloqueo aunque se llene el mapa de orígenes', () => {
    const { proteccion } = conCapacidad(30, true);
    for (let i = 0; i < FALLOS_POR_ORIGEN; i += 1) {
      permitido(proteccion.reservar(`o${i}@x.example`, '10.9.9.9')).fallo();
    }
    expect(puede(proteccion, 'otra@x.example', '10.9.9.9')).toMatchObject({
      motivo: 'limite-origen',
    });

    inundar(proteccion, 'ataque', 500);

    expect(puede(proteccion, 'otra@x.example', '10.9.9.9')).toMatchObject({
      permitido: false,
      motivo: 'limite-origen',
    });
  });

  it('sin saturación, los límites normales siguen igual', () => {
    const { proteccion } = conCapacidad(10_000, true);
    fallar(proteccion, VICTIMA, FALLOS_ANTES_DE_DEMORA);
    expect(puede(proteccion, VICTIMA, '10.0.0.1')).toMatchObject({ motivo: 'demora-cuenta' });
    expect(puede(proteccion, 'otra@estudio.example', '10.0.0.1').permitido).toBe(true);
  });
});

describe('límite por origen cuando la IP no identifica al cliente', () => {
  it('desactivado: 20 fallos desde la IP compartida no bloquean a las demás cuentas', () => {
    const reloj = { ahora: 1_000_000 };
    const proteccion = new ProteccionDeLogin({ ahora: () => reloj.ahora, limitePorOrigen: false });
    const ipDelProxy = '100.64.0.1';

    // Una sola persona falla mucho más que el umbral, con cuentas distintas, desde la IP del proxy.
    for (let i = 0; i < FALLOS_POR_ORIGEN * 3; i += 1) {
      permitido(proteccion.reservar(`atacante-${i}@example.com`, ipDelProxy)).fallo();
    }

    // Otra persona, que llega por el mismo proxy, sigue pudiendo entrar.
    expect(puede(proteccion, 'ana@example.com', ipDelProxy).permitido).toBe(true);
    expect(proteccion.tamanio.origenes).toBe(0);
  });

  it('desactivado: la demora por cuenta y la concurrencia siguen protegiendo', () => {
    const proteccion = new ProteccionDeLogin({ ahora: () => 1_000_000, limitePorOrigen: false });
    fallar(proteccion, 'victima@example.com', FALLOS_ANTES_DE_DEMORA);
    expect(puede(proteccion, 'victima@example.com', '100.64.0.1')).toMatchObject({
      permitido: false,
      motivo: 'demora-cuenta',
    });

    const enCurso = permitido(proteccion.reservar('otra@example.com', '100.64.0.1'));
    expect(proteccion.reservar('otra@example.com', '100.64.0.1')).toMatchObject({
      permitido: false,
      motivo: 'concurrencia',
    });
    enCurso.liberar();
  });

  it('se aplica fuera de producción, y en producción solo con los saltos de proxy configurados', () => {
    expect(limitePorOrigenAplicable({ nodeEnv: 'development', saltosDeProxyConfiables: 0 })).toBe(
      true,
    );
    expect(limitePorOrigenAplicable({ nodeEnv: 'test', saltosDeProxyConfiables: 0 })).toBe(true);
    expect(limitePorOrigenAplicable({ nodeEnv: 'production', saltosDeProxyConfiables: 0 })).toBe(
      false,
    );
    expect(limitePorOrigenAplicable({ nodeEnv: 'production', saltosDeProxyConfiables: 2 })).toBe(
      true,
    );
  });
});
