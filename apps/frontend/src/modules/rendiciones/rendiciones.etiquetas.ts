import type { EmisorType, MotivoNoEnviableType } from '@realpolitik/shared';

import { etiquetaDeMes, etiquetasEmisor } from '@/modules/clientes/clientes.etiquetas';

/** Período de una rendición como se lee en pantalla: "Octubre 2026". */
export function etiquetaDePeriodo({ anio, mes }: { anio: number; mes: number }): string {
  return `${etiquetaDeMes(mes)} ${anio}`;
}

/** Una rendición anterior a HU2.9 no tiene emisor: se dice en tono neutro, no como un error. */
export const TEXTO_SIN_EMISOR = 'Sin emisor';

/** El emisor de una rendición como se lee en pantalla. Los nombres viven en `etiquetasEmisor`. */
export const etiquetaDeEmisor = (emisor: EmisorType | null): string =>
  emisor === null ? TEXTO_SIN_EMISOR : etiquetasEmisor[emisor];

/** Debajo del selector de emisor de "Abrir rendición". */
export const MENSAJE_EMISOR_OBLIGATORIO = 'Elegí el emisor de la factura.';
export const AYUDA_EMISOR_DEL_CLIENTE =
  'Es el emisor habitual del cliente. Cambialo solo si esta factura la emite el otro emisor.';
export const AYUDA_EMISOR_SIN_HABITUAL =
  'El cliente no tiene emisor habitual: elegí quién emite esta factura.';

/** "1 documento" / "4 documentos". */
export function cantidadDeDocumentos(cantidad: number): string {
  return cantidad === 1 ? '1 documento' : `${cantidad} documentos`;
}

/** Avance del checklist: "3 de 12 reunidos". */
export function avanceDelChecklist({
  completados,
  totalItems,
}: {
  completados: number;
  totalItems: number;
}): string {
  return `${completados} de ${totalItems} reunidos`;
}

/** Un checklist con ítems y todos reunidos. Sin ítems no hay nada que dar por completo. */
export const checklistCompleto = ({
  completados,
  totalItems,
}: {
  completados: number;
  totalItems: number;
}): boolean => totalItems > 0 && completados === totalItems;

/** Un ítem del checklist como se lee en pantalla: "Factura", "Print 2 de 5". */
export function nombreDeItem({
  nombreTipoDocumento,
  ordinal,
  totalOrdinal,
}: {
  nombreTipoDocumento: string;
  ordinal: number;
  totalOrdinal: number;
}): string {
  return totalOrdinal > 1
    ? `${nombreTipoDocumento} ${ordinal} de ${totalOrdinal}`
    : nombreTipoDocumento;
}

/**
 * Un número de WhatsApp en E.164 (`+5493511234567`), agrupado para leerlo en voz alta:
 * "+54 9 351 123 4567" (o "+54 9 11 1234 5678" en el AMBA). Los de otros países quedan como
 * vienen: sin saber su plan de numeración, agruparlos podría confundir más que ayudar.
 */
export function numeroDeWhatsappLegible(numero: string): string {
  const movilArgentino = /^\+549(\d{10})$/.exec(numero)?.[1];
  if (movilArgentino === undefined) return numero;
  const grupos = movilArgentino.startsWith('11')
    ? [movilArgentino.slice(0, 2), movilArgentino.slice(2, 6), movilArgentino.slice(6)]
    : [movilArgentino.slice(0, 3), movilArgentino.slice(3, 6), movilArgentino.slice(6)];
  return `+54 9 ${grupos.join(' ')}`;
}

/** Por qué no se puede marcar un ítem para enviarlo (`motivoNoEnviable` de shared). */
export const motivoParaNoEnviar: Record<MotivoNoEnviableType, string> = {
  ITEM_PENDIENTE: 'Para enviarlo, asociale un documento.',
  ITEM_SIN_DOCUMENTO_VIGENTE: 'Figura reunido, pero no tiene un documento vigente: no se envía.',
};

// ─── Orden de compra (HU2.11) ─────────────────────────────────────────────────

/** Una OC sin cargar: se dice en tono neutro, no como un error. */
export const TEXTO_OC_NO_ASIGNADA = 'No asignada';
export const TEXTO_MONTO_SIN_CARGAR = '-';

const formatoDeMonedaEntera = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const formatoDeMonedaConCentavos = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Un monto como moneda, o un guion si no se cargó. Un entero va sin decimales ("$ 1.250.000"); con
 * centavos, siempre dos ("$ 1.250.000,50", no "$ 1.250.000,5").
 */
export function etiquetaDeMonto(monto: number | null): string {
  if (monto === null) return TEXTO_MONTO_SIN_CARGAR;
  const formato = Number.isInteger(monto) ? formatoDeMonedaEntera : formatoDeMonedaConCentavos;
  return formato.format(monto);
}

/** El número de OC como se lee en pantalla, o "No asignada" si no se cargó. */
export const etiquetaDeNumeroOc = (numeroOc: string | null): string =>
  numeroOc ?? TEXTO_OC_NO_ASIGNADA;
