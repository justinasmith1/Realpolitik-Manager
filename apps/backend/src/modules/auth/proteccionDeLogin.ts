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
// - **Memoria acotada**: cada mapa guarda como mucho `maximoDeClaves` (10 000) entradas; las vencidas
//   se podan al escribir, sin temporizadores. Unos pocos MB como máximo.
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

export type MotivoDeLimite = 'demora-cuenta' | 'limite-origen' | 'concurrencia';

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

/** Mapa con orden de última escritura: lo más viejo queda al principio y se poda primero. */
class RegistroAcotado<V> {
  readonly #entradas = new Map<string, V>();

  constructor(
    private readonly maximo: number,
    private readonly vencida: (valor: V, ahora: number) => boolean,
  ) {}

  get tamanio(): number {
    return this.#entradas.size;
  }

  leer(clave: string, ahora: number): V | undefined {
    const valor = this.#entradas.get(clave);
    if (valor !== undefined && this.vencida(valor, ahora)) {
      this.#entradas.delete(clave);
      return undefined;
    }
    return valor;
  }

  escribir(clave: string, valor: V, ahora: number): void {
    this.#entradas.delete(clave);
    this.#entradas.set(clave, valor);
    for (const [vieja, valorViejo] of this.#entradas) {
      if (this.#entradas.size <= this.maximo && !this.vencida(valorViejo, ahora)) break;
      this.#entradas.delete(vieja);
    }
  }

  borrar(clave: string): void {
    this.#entradas.delete(clave);
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
    this.#cuentas = new RegistroAcotado(
      maximoDeClaves,
      (c, t) => t - c.ultimoFallo >= OLVIDO_DE_FALLOS_MS && t >= c.esperaHasta,
    );
    this.#origenes = new RegistroAcotado(
      maximoDeClaves,
      (o, t) => t - o.desde >= VENTANA_POR_ORIGEN_MS && t >= o.bloqueadoHasta,
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

    this.#enCurso.add(email);
    let cerrado = false;
    const cerrar = (accion: () => void) => {
      if (cerrado) return;
      cerrado = true;
      this.#enCurso.delete(email);
      accion();
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
