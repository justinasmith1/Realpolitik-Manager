// Registro de eventos de autenticación (ADR-0006 §3): una línea JSON por evento en la salida
// estándar, sin librería de logs.
//
// Nunca se registran contraseñas, tokens, cookies, hashes ni cuerpos de pedido. Tampoco el email de
// un intento fallido: podría ser una contraseña escrita por error en el campo email. La IP se
// trunca (/24 en IPv4, /48 en IPv6): alcanza para ver un ataque sin guardar la dirección exacta.

export type EventoDeAuth =
  | 'auth.login.ok'
  | 'auth.login.fallo'
  | 'auth.login.limitado'
  | 'auth.logout'
  | 'auth.password.cambiada'
  | 'auth.password.fallo'
  | 'auth.permiso_denegado'
  | 'auth.origen_rechazado'
  /** Alta del primer administrador por el procedimiento técnico (solo el id, nunca el email). */
  | 'auth.usuario.creado';

export type MotivoDeEvento =
  | 'credenciales'
  | 'inactiva'
  | 'hash-invalido'
  | 'demora-cuenta'
  | 'limite-origen'
  | 'concurrencia'
  | 'saturacion'
  | 'capacidad'
  | 'solo-lectura'
  | 'rol-no-habilitado';

interface DatosDelEvento {
  usuarioId?: string;
  motivo?: MotivoDeEvento;
  /** El permiso que faltó (`auth.permiso_denegado`). Un nombre del catálogo: no es un dato sensible. */
  permiso?: string;
  ip?: string | undefined;
}

/** IP truncada para el registro: /24 en IPv4 (incluida la mapeada en IPv6) y /48 en IPv6. */
export function truncarIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(':')) {
    const [inicio = ''] = ip.split('::');
    const grupos = inicio.split(':').filter(Boolean).slice(0, 3);
    while (grupos.length < 3) grupos.push('0');
    return `${grupos.join(':')}::/48`;
  }
  return undefined;
}

export function registrarEventoDeAuth(evento: EventoDeAuth, datos: DatosDelEvento = {}): void {
  const linea = {
    fecha: new Date().toISOString(),
    evento,
    ...(datos.usuarioId ? { usuarioId: datos.usuarioId } : {}),
    ...(datos.motivo ? { motivo: datos.motivo } : {}),
    ...(datos.permiso ? { permiso: datos.permiso } : {}),
    ...(datos.ip ? { ip: truncarIp(datos.ip) } : {}),
  };
  // process.stdout.write, como el arranque del servidor: evita la regla no-console.
  process.stdout.write(`${JSON.stringify(linea)}\n`);
}
