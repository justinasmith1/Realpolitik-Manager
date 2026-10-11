import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

import {
  etiquetasCanalEntrega,
  etiquetasIvaCondicion,
  etiquetasPeriodicidad,
  etiquetasSector,
  etiquetasSubtipo,
  nombresDeMes,
} from '@/modules/clientes/clientes.etiquetas';

// Los tests piensan en valores del dominio ('PUBLICO', 'BIMESTRAL'); el select muestra etiquetas.
const etiquetaPorValor: Record<string, string> = {
  ...etiquetasSector,
  ...etiquetasSubtipo,
  ...etiquetasIvaCondicion,
  ...etiquetasCanalEntrega,
  ...etiquetasPeriodicidad,
  ...Object.fromEntries(nombresDeMes.map((nombre, indice) => [String(indice + 1), nombre])),
  ACTIVO: 'Activos',
  INACTIVO: 'Inactivos',
};

// La opción de valor vacío se llama distinto según el select: "Sin configurar" (periodicidad) o
// "Todos" (filtros).
const etiquetasDeValorVacio = ['Sin configurar', 'Todos'];

/**
 * Elige una opción de un `Select` como lo haría una persona: abre el popup y hace clic. Acepta
 * el valor del dominio (p. ej. 'PUBLICO', '' para "Sin configurar") o la etiqueta visible.
 */
export async function elegirOpcion(user: UserEvent, select: HTMLElement, valorOEtiqueta: string) {
  await user.click(select);
  const popup = await screen.findByRole('listbox');
  const etiqueta =
    valorOEtiqueta === ''
      ? (etiquetasDeValorVacio.find((nombre) =>
          within(popup).queryByRole('option', { name: nombre }),
        ) ?? valorOEtiqueta)
      : (etiquetaPorValor[valorOEtiqueta] ?? valorOEtiqueta);
  await user.click(within(popup).getByRole('option', { name: etiqueta }));
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

/** Etiqueta de una opción del dominio, como la muestra la interfaz. */
export const etiquetaDeOpcion = (valor: string) => etiquetaPorValor[valor] ?? valor;
