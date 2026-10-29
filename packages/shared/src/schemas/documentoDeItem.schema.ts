import { z } from 'zod';

// Va en su propio archivo y solo depende de Zod: lo usa `ItemChecklistSchema` (rendicion.schema)
// y `documento.schema` depende de rendicion.schema. Así no hay un import circular.

/**
 * El documento vigente de un ítem del checklist, como lo muestra el detalle de la rendición
 * (HU2.8, ADR-0004): la aplicación vigente y los datos del archivo para verlo y descargarlo. Es
 * una entidad de lectura: `tipoContenido` es el texto guardado, sin la lista de formatos de
 * escritura, para que un formato que se deje de admitir no rompa la lectura.
 */
export const DocumentoDeItemSchema = z.object({
  aplicacionId: z.string().uuid(),
  documentoId: z.string().uuid(),
  nombreOriginal: z.string(),
  tipoContenido: z.string(),
  tamanioBytes: z.number().int().min(1),
  aplicadaEn: z.coerce.date(),
});

export type DocumentoDeItem = z.infer<typeof DocumentoDeItemSchema>;
