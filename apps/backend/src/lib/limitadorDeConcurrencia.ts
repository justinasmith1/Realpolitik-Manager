// Limitador de concurrencia en memoria: como mucho `maximoSimultaneas` operaciones a la vez y
// `maximoEnEspera` esperando turno. Una operación más allá de eso se rechaza al instante con
// `CapacidadAgotadaError`, sin ejecutarse: no hay colas ilimitadas.
//
// Lo usa el hash de contraseñas (`modules/auth/limiteDeHash.ts`). Es por instancia de proceso, sin
// infraestructura externa; con varias réplicas, cada una tiene el suyo.

/** No hay lugar para ejecutar ni para esperar. No es un error de la operación ni de sus datos. */
export class CapacidadAgotadaError extends Error {
  constructor() {
    super('Capacidad agotada: hay demasiadas operaciones en curso y en espera.');
    this.name = 'CapacidadAgotadaError';
  }
}

export interface OpcionesDelLimitador {
  maximoSimultaneas: number;
  maximoEnEspera: number;
}

export class LimitadorDeConcurrencia {
  readonly #maximoSimultaneas: number;
  readonly #maximoEnEspera: number;
  #enCurso = 0;
  readonly #espera: Array<() => void> = [];

  constructor({ maximoSimultaneas, maximoEnEspera }: OpcionesDelLimitador) {
    if (!Number.isSafeInteger(maximoSimultaneas) || maximoSimultaneas < 1) {
      throw new RangeError('maximoSimultaneas tiene que ser un entero mayor o igual que 1.');
    }
    if (!Number.isSafeInteger(maximoEnEspera) || maximoEnEspera < 0) {
      throw new RangeError('maximoEnEspera tiene que ser un entero mayor o igual que 0.');
    }
    this.#maximoSimultaneas = maximoSimultaneas;
    this.#maximoEnEspera = maximoEnEspera;
  }

  /** Operaciones ejecutándose ahora. */
  get enCurso(): number {
    return this.#enCurso;
  }

  /** Operaciones esperando turno. */
  get enEspera(): number {
    return this.#espera.length;
  }

  /**
   * Ejecuta `operacion` cuando haya lugar (en orden de llegada) y devuelve su resultado o su error
   * tal cual. El lugar se libera siempre, termine bien o mal.
   * @throws {CapacidadAgotadaError} si no hay lugar para ejecutar ni para esperar.
   */
  async ejecutar<T>(operacion: () => Promise<T>): Promise<T> {
    if (this.#enCurso < this.#maximoSimultaneas) {
      this.#enCurso += 1;
    } else if (this.#espera.length < this.#maximoEnEspera) {
      // El lugar lo pasa directamente quien termina (ver `finally`): `enCurso` no cambia.
      await new Promise<void>((resolve) => this.#espera.push(resolve));
    } else {
      throw new CapacidadAgotadaError();
    }

    try {
      return await operacion();
    } finally {
      const siguiente = this.#espera.shift();
      if (siguiente) siguiente();
      else this.#enCurso -= 1;
    }
  }
}
