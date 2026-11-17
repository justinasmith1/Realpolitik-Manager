import { useState } from 'react';

/**
 * Abre y cierra un diálogo que tiene que arrancar limpio en cada apertura (los de estado: Enviada,
 * Aprobada y Rechazada). `clave` cambia cada vez que se abre y va en la `key` del diálogo: React lo
 * vuelve a montar, con la fecha, el motivo y los errores en su valor inicial, también si se reabre
 * la misma rendición mientras se anima el cierre anterior. Al cerrar, `clave` no cambia: el diálogo
 * sigue montado con su contenido hasta que termina la animación.
 */
export function useAperturaDeDialogo() {
  const [estado, setEstado] = useState({ abierto: false, apertura: 0 });
  return {
    abierto: estado.abierto,
    clave: estado.apertura,
    abrir: () => setEstado((previo) => ({ abierto: true, apertura: previo.apertura + 1 })),
    cerrar: () => setEstado((previo) => ({ ...previo, abierto: false })),
  };
}
