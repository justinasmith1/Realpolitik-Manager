// Protección del inicio de sesión contra fuerza bruta (ADR-0006 §3), en memoria del proceso.
//
// | Control                 | Clave                               | Regla                                                  |
// | ----------------------- | ----------------------------------- | ------------------------------------------------------ |
// | Demora por cuenta       | email normalizado, exista o no      | desde el 5.º fallo seguido: 30 s, 1, 2, 4, 8 y 15 min |
// | Límite por origen       | IP vista por el backend (`req.ip`)  | 20 fallos en 15 min → 15 min sin intentos             |
// | Concurrencia por cuenta | email normalizado                   | 1 verificación en curso                                |
//
// La capacidad global de argon2 la limita `limiteDeHash` (no hay una segunda cola).
//
// La usa también el cambio de contraseña (`PUT /auth/password`), con el email de la cuenta: la
// contraseña actual incorrecta cuenta como un fallo de login (ADR-0006 §3) y la concurrencia por
// cuenta impide calcular dos cambios de la misma cuenta a la vez.
//
// - **Se evalúa antes del hash** y de forma SINCRÓNICA: la reserva (chequear y marcar "en curso")
//   ocurre en el mismo tick, así 50 pedidos simultáneos no leen todos "cero fallos".
// - **Sin enumeración**: la clave es el email escrito, exista o no la cuenta.
// - **Sin bloqueos permanentes**: la espera máxima es de 15 minutos y vence sola. Un intento durante
//   la espera no se verifica ni cuenta como fallo. Los fallos se olvidan tras 1 h sin fallos.
// - **Memoria acotada sin desalojar penalizaciones**: cada mapa guarda como mucho `maximoDeClaves`
//   (10 000) claves. Solo se podan las entradas VENCIDAS (sin espera vigente y, en las cuentas, sin
//   fallos en la última hora), sin temporizadores. Una cuenta con fallos contados o con una espera
//   vigente nunca se descarta para hacer lugar: si el mapa sigue lleno, una clave NUEVA recibe 429
//   (`saturacion`) antes de calcular ningún hash, con `Retry-After` hasta que vence la primera
//   entrada. Antes se descartaba la más vieja aunque tuviera una espera vigente: inundar el mapa con
//   emails inventados borraba la demora de una cuenta atacada (review del PR #47).
//   Costo aceptado: mientras alguien mantiene el mapa lleno, las cuentas que todavía no tienen
//   entrada no pueden intentar (denegación temporal, como mucho hasta que vencen las entradas). No
//   es una protección contra ataques distribuidos. Unos pocos MB como máximo; durante los intentos
//   en curso el tope puede pasarse en tantas claves como intentos simultáneos haya.
// - **Una sola instancia**: no se comparte entre réplicas ni sobrevive a un reinicio. Si se escala,
//   los contadores pasan a una tabla de PostgreSQL.
// - **El límite por origen depende de `req.ip`**, que depende de `trust proxy` (ver
//   `TRUST_PROXY_SALTOS`). Detrás de un proxy sin configurar, todos comparten la IP del proxy.
//
// Riesgo aceptado (ADR-0006 §3): quien conoce un email puede mantener esa cuenta en la espera
// máxima mientras dure el ataque. Es temporal y queda en el registro de eventos.

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;

/** Fallos seguidos a partir de los cuales hay que esperar antes del siguiente intento. */
export const FALLOS_ANTES_DE_DEMORA = 5;
/** Espera tras el 5.º fallo, el 6.º… (la última se repite). */
export const DEMORAS_POR_CUENTA_MS = Object.freeze([
  30 * SEGUNDO,
  MINUTO,
  2 * MINUTO,
  4 * MINUTO,
  8 * MINUTO,
  15 * MINUTO,
]);
/** Sin fallos durante este tiempo, la cuenta vuelve a cero. */
export const OLVIDO_DE_FALLOS_MS = HORA;

export const FALLOS_POR_ORIGEN = 20;
export const VENTANA_POR_ORIGEN_MS = 15 * MINUTO;
export const BLOQUEO_POR_ORIGEN_MS = 15 * MINUTO;

/** Espera sugerida al segundo intento simultáneo de la misma cuenta. */
export const ESPERA_POR_CONCURRENCIA_MS = SEGUNDO;

export const MAXIMO_DE_CLAVES = 10_000;

/**
 * `saturacion`: el mapa de la clave (cuenta u origen) está lleno de entradas vigentes y la clave es
 * nueva. Se responde como un 429 más (`DEMASIADOS_INTENTOS`), sin decir si la cuenta existe.
 */
export type MotivoDeLimite = 'demora-cuenta' | 'limite-origen' | 'concurrencia' | 'saturacion';

/** Un intento reservado. Se cierra UNA vez: con `fallo`, con `exito` o, si no se pudo decidir, con `liberar`. */
export interface IntentoReservado {
  /** Credenciales incorrectas: cuenta para la demora y para el origen. */
  fallo(): void;
  /** Login correcto: la cuenta vuelve a cero (el origen no). */
  exito(): void;
  /** Sin veredicto (base caída, capacidad agotada, error): no cuenta como fallo. */
  liberar(): void;
}

export type ResultadoDeReserva =
  | { permitido: true; intento: IntentoReservado }
  | { permitido: false; motivo: MotivoDeLimite; retryAfterMs: number };

interface EstadoDeCuenta {
  fallos: number;
  ultimoFallo: number;
  esperaHasta: number;
}

interface EstadoDeOrigen {
  fallos: number;
  desde: number;
  bloqueadoHasta: number;
}

export interface OpcionesDeProteccion {
  /** Reloj en milisegundos (inyectable en tests). */
  ahora?: () => number;
  maximoDeClaves?: number;
  /**
   * Si se aplica el límite por origen. `false` cuando `req.ip` no identifica al cliente (ver
   * `limitePorOrigenAplicable`): detrás de un proxy sin `trust proxy`, todos comparten una IP y el
   * límite dejaría que una sola persona bloquee el ingreso de todas. La demora por cuenta y el tope
   * de concurrencia siguen activos siempre.
   */
  limitePorOrigen?: boolean;
}

/**
 * El límite por origen solo sirve si la IP que ve el backend es la del cliente. En producción el
 * backend está detrás de al menos un proxy (Railway, y Vercel delante): con `TRUST_PROXY_SALTOS=0`
 * `req.ip` es la del proxy, la misma para todos, y 20 fallos de cualquiera bloquearían el login de
 * todo el estudio. Por eso en producción se aplica solo con los saltos configurados (medidos en la
 * activación, ADR-0006 §4); fuera de producción la IP del socket es la del cliente.
 */
export function limitePorOrigenAplicable(entorno: {
  nodeEnv: 'development' | 'test' | 'production';
  saltosDeProxyConfiables: number;
}): boolean {
  return entorno.nodeEnv !== 'production' || entorno.saltosDeProxyConfiables > 0;
}

type Lugar = { hay: true } | { hay: false; libreEnMs: number };

/**
 * Mapa acotado que NUNCA descarta una entrada vigente para hacer lugar. `venceEn` dice desde cuándo
 * una entrada ya no hace falta; solo esas se podan. Las claves nuevas con un intento en curso
 * reservan su lugar (`reservar`/`soltar`), así varios intentos simultáneos no pasan el tope.
 */
class RegistroAcotado<V> {
  readonly #entradas = new Map<string, V>();
  /** Claves que no estaban guardadas cuando empezó su intento, con cuántos intentos en curso tienen. */
  readonly #reservadas = new Map<string, number>();

  constructor(
    private readonly maximo: number,
    private readonly venceEn: (valor: V) => number,
  ) {}

  get tamanio(): number {
    return this.#entradas.size;
  }

  leer(clave: string, ahora: number): V | undefined {
    const valor = this.#entradas.get(clave);
    if (valor !== undefined && ahora >= this.venceEn(valor)) {
      this.#entradas.delete(clave);
      return undefined;
    }
    return valor;
  }

  /** Si `clave` tiene lugar. Si el mapa está lleno, poda las vencidas; si sigue lleno, no lo hay. */
  lugarPara(clave: string, ahora: number): Lugar {
    if (this.#entradas.has(clave) || this.#reservadas.has(clave)) return { hay: true };
    if (this.#ocupadas() < this.maximo) return { hay: true };
    const proximoVencimiento = this.#podarVencidas(ahora);
    if (this.#ocupadas() < this.maximo) return { hay: true };
    return { hay: false, libreEnMs: Math.max(SEGUNDO, proximoVencimiento - ahora) };
  }

  reservar(clave: string): void {
    if (this.#entradas.has(clave)) return;
    this.#reservadas.set(clave, (this.#reservadas.get(clave) ?? 0) + 1);
  }

  soltar(clave: string): void {
    const cantidad = this.#reservadas.get(clave);
    if (cantidad === undefined) return;
    if (cantidad <= 1) this.#reservadas.delete(clave);
    else this.#reservadas.set(clave, cantidad - 1);
  }

  escribir(clave: string, valor: V, ahora: number): void {
    this.#entradas.delete(clave);
    this.#entradas.set(clave, valor);
    // Las más viejas primero (orden de escritura), hasta la primera vigente: nunca borra una vigente.
    for (const [vieja, valorViejo] of this.#entradas) {
      if (ahora < this.venceEn(valorViejo)) break;
      this.#entradas.delete(vieja);
    }
    if (this.#ocupadas() > this.maximo) this.#podarVencidas(ahora);
  }

  borrar(clave: string): void {
    this.#entradas.delete(clave);
  }

  #ocupadas(): number {
    let reservadasNuevas = 0;
    for (const clave of this.#reservadas.keys()) {
      if (!this.#entradas.has(clave)) reservadasNuevas += 1;
    }
    return this.#entradas.size + reservadasNuevas;
  }

  /** Borra todas las entradas vencidas y devuelve cuándo vence la próxima de las que quedan. */
  #podarVencidas(ahora: number): number {
    let proximo = Number.POSITIVE_INFINITY;
    for (const [clave, valor] of this.#entradas) {
      const vence = this.venceEn(valor);
      if (ahora >= vence) this.#entradas.delete(clave);
      else if (vence < proximo) proximo = vence;
    }
    return proximo;
  }
}

export class ProteccionDeLogin {
  readonly #ahora: () => number;
  readonly #cuentas: RegistroAcotado<EstadoDeCuenta>;
  readonly #origenes: RegistroAcotado<EstadoDeOrigen>;
  readonly #enCurso = new Set<string>();
  readonly #limitePorOrigen: boolean;

  constructor({
    ahora = Date.now,
    maximoDeClaves = MAXIMO_DE_CLAVES,
    limitePorOrigen = true,
  }: OpcionesDeProteccion = {}) {
    this.#ahora = ahora;
    this.#limitePorOrigen = limitePorOrigen;
    // Una cuenta hace falta mientras tenga fallos sin olvidar o una espera vigente; un origen,
    // mientras dure su ventana o su bloqueo.
    this.#cuentas = new RegistroAcotado(maximoDeClaves, (c) =>
      Math.max(c.ultimoFallo + OLVIDO_DE_FALLOS_MS, c.esperaHasta),
    );
    this.#origenes = new RegistroAcotado(maximoDeClaves, (o) =>
      Math.max(o.desde + VENTANA_POR_ORIGEN_MS, o.bloqueadoHasta),
    );
  }

  /** Entradas guardadas (para tests y diagnóstico). */
  get tamanio(): { cuentas: number; origenes: number; enCurso: number } {
    return {
      cuentas: this.#cuentas.tamanio,
      origenes: this.#origenes.tamanio,
      enCurso: this.#enCurso.size,
    };
  }

  /**
   * Reserva un intento para `email` desde `ip`, o informa por qué no se permite. SINCRÓNICO: se
   * llama antes de cualquier `await` del inicio de sesión.
   */
  reservar(email: string, ip: string | undefined): ResultadoDeReserva {
    const ahora = this.#ahora();
    const claveDeOrigen = ip ?? 'desconocida';

    const origen = this.#limitePorOrigen ? this.#origenes.leer(claveDeOrigen, ahora) : undefined;
    if (origen && origen.bloqueadoHasta > ahora) {
      return {
        permitido: false,
        motivo: 'limite-origen',
        retryAfterMs: origen.bloqueadoHasta - ahora,
      };
    }
    const cuenta = this.#cuentas.leer(email, ahora);
    if (cuenta && cuenta.esperaHasta > ahora) {
      return {
        permitido: false,
        motivo: 'demora-cuenta',
        retryAfterMs: cuenta.esperaHasta - ahora,
      };
    }
    if (this.#enCurso.has(email)) {
      return { permitido: false, motivo: 'concurrencia', retryAfterMs: ESPERA_POR_CONCURRENCIA_MS };
    }
    // Sin lugar para registrar un posible fallo no se intenta: el hash no se calcula y ninguna
    // entrada vigente se descarta.
    const lugarDeCuenta = this.#cuentas.lugarPara(email, ahora);
    const lugarDeOrigen: Lugar = this.#limitePorOrigen
      ? this.#origenes.lugarPara(claveDeOrigen, ahora)
      : { hay: true };
    if (!lugarDeCuenta.hay || !lugarDeOrigen.hay) {
      return {
        permitido: false,
        motivo: 'saturacion',
        retryAfterMs: Math.max(
          lugarDeCuenta.hay ? 0 : lugarDeCuenta.libreEnMs,
          lugarDeOrigen.hay ? 0 : lugarDeOrigen.libreEnMs,
        ),
      };
    }

    this.#enCurso.add(email);
    this.#cuentas.reservar(email);
    if (this.#limitePorOrigen) this.#origenes.reservar(claveDeOrigen);
    let cerrado = false;
    const cerrar = (accion: () => void) => {
      if (cerrado) return;
      cerrado = true;
      this.#enCurso.delete(email);
      accion();
      this.#cuentas.soltar(email);
      if (this.#limitePorOrigen) this.#origenes.soltar(claveDeOrigen);
    };
    return {
      permitido: true,
      intento: {
        fallo: () => cerrar(() => this.#registrarFallo(email, claveDeOrigen)),
        exito: () => cerrar(() => this.#cuentas.borrar(email)),
        liberar: () => cerrar(() => undefined),
      },
    };
  }

  #registrarFallo(email: string, claveDeOrigen: string): void {
    const ahora = this.#ahora();

    const previa = this.#cuentas.leer(email, ahora);
    const fallos = (previa?.fallos ?? 0) + 1;
    const indice = fallos - FALLOS_ANTES_DE_DEMORA;
    const demora =
      indice >= 0
        ? (DEMORAS_POR_CUENTA_MS[Math.min(indice, DEMORAS_POR_CUENTA_MS.length - 1)] ?? 0)
        : 0;
    this.#cuentas.escribir(
      email,
      { fallos, ultimoFallo: ahora, esperaHasta: ahora + demora },
      ahora,
    );

    if (!this.#limitePorOrigen) return;
    const origen = this.#origenes.leer(claveDeOrigen, ahora);
    const enVentana = origen && ahora - origen.desde < VENTANA_POR_ORIGEN_MS;
    const fallosDeOrigen = (enVentana ? origen.fallos : 0) + 1;
    this.#origenes.escribir(
      claveDeOrigen,
      {
        fallos: fallosDeOrigen,
        desde: enVentana ? origen.desde : ahora,
        bloqueadoHasta: fallosDeOrigen >= FALLOS_POR_ORIGEN ? ahora + BLOQUEO_POR_ORIGEN_MS : 0,
      },
      ahora,
    );
  }
}
