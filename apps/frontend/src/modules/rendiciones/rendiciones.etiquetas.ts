import { etiquetaDeMes } from '@/modules/clientes/clientes.etiquetas';

/** Período de una rendición como se lee en pantalla: "Octubre 2026". */
export function etiquetaDePeriodo({ anio, mes }: { anio: number; mes: number }): string {
  return `${etiquetaDeMes(mes)} ${anio}`;
}

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
