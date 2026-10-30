import {
  FORMATOS_DE_DOCUMENTO,
  MENSAJE_FORMATO_DOCUMENTO,
  MENSAJE_TAMANIO_DOCUMENTO,
  TAMANIO_MAXIMO_DOCUMENTO_BYTES,
  TipoContenidoDocumento,
  type CandidatoAplicacion,
} from '@realpolitik/shared';

// Textos y reglas de presentación de los documentos (HU2.8). Funciones puras.

const formatoDeFecha = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeZone: 'America/Argentina/Buenos_Aires',
});

/** Una fecha como la lee la operadora: "29 oct 2026" (horario de Buenos Aires). */
export const fechaLegible = (fecha: Date): string => formatoDeFecha.format(fecha);

/** "512 B", "48 KB", "2,4 MB". */
export function tamanioLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;
}

/** "PDF", "JPG"… o el MIME tal cual si es un formato que ya no se admite. */
export function formatoLegible(tipoContenido: string): string {
  const conocido = TipoContenidoDocumento.safeParse(tipoContenido);
  return conocido.success ? FORMATOS_DE_DOCUMENTO[conocido.data].etiqueta : tipoContenido;
}

/** "Sin aplicar", "1 ítem", "3 ítems". */
export function cantidadDeItems(cantidad: number): string {
  if (cantidad === 0) return 'Sin aplicar';
  return cantidad === 1 ? '1 ítem' : `${cantidad} ítems`;
}

/** Lo que admite el selector de archivos (`accept`), armado con los formatos de shared. */
export const EXTENSIONES_ADMITIDAS = Object.values(FORMATOS_DE_DOCUMENTO)
  .flatMap((formato) => formato.extensiones)
  .map((extension) => `.${extension}`)
  .join(',');

/** "PDF, JPG, PNG o DOCX". */
export const FORMATOS_ADMITIDOS = (() => {
  const etiquetas = Object.values(FORMATOS_DE_DOCUMENTO).map((formato) => formato.etiqueta);
  return `${etiquetas.slice(0, -1).join(', ')} o ${etiquetas[etiquetas.length - 1] ?? ''}`;
})();

/**
 * Lo que se puede comprobar del archivo antes de subirlo: extensión admitida y tamaño. Es para
 * avisar enseguida; el servidor vuelve a validar todo, y además el contenido real (un `.pdf` que
 * no es un PDF se rechaza allá). `null`: se puede subir.
 */
export function problemaDelArchivo(archivo: File): string | null {
  if (archivo.size === 0 || archivo.size > TAMANIO_MAXIMO_DOCUMENTO_BYTES) {
    return MENSAJE_TAMANIO_DOCUMENTO;
  }
  const punto = archivo.name.lastIndexOf('.');
  const extension = punto < 0 ? '' : archivo.name.slice(punto + 1).toLowerCase();
  const admitida = Object.values(FORMATOS_DE_DOCUMENTO).some((formato) =>
    formato.extensiones.includes(extension),
  );
  return admitida ? null : MENSAJE_FORMATO_DOCUMENTO;
}

// ─── Candidatos agrupados ─────────────────────────────────────────────────────

export interface GrupoDeRendicion {
  rendicion: CandidatoAplicacion['rendicion'];
  items: CandidatoAplicacion['item'][];
}

export interface GrupoDeCliente {
  cliente: CandidatoAplicacion['cliente'];
  rendiciones: GrupoDeRendicion[];
}

/**
 * Los candidatos por cliente y, dentro, por rendición. Respeta el orden de la API (que ya viene
 * ordenada para agrupar): no reordena.
 */
export function agruparCandidatos(candidatos: readonly CandidatoAplicacion[]): GrupoDeCliente[] {
  const clientes: GrupoDeCliente[] = [];
  for (const { cliente, rendicion, item } of candidatos) {
    let grupo = clientes.find((g) => g.cliente.id === cliente.id);
    if (grupo === undefined) {
      grupo = { cliente, rendiciones: [] };
      clientes.push(grupo);
    }
    let deRendicion = grupo.rendiciones.find((r) => r.rendicion.id === rendicion.id);
    if (deRendicion === undefined) {
      deRendicion = { rendicion, items: [] };
      grupo.rendiciones.push(deRendicion);
    }
    deRendicion.items.push(item);
  }
  return clientes;
}

/** "3 ítems en 2 rendiciones" / "1 ítem en 1 rendición". */
export function resumenDeSeleccion(items: number, rendiciones: number): string {
  const deItems = items === 1 ? '1 ítem' : `${items} ítems`;
  const deRendiciones = rendiciones === 1 ? '1 rendición' : `${rendiciones} rendiciones`;
  return `${deItems} en ${deRendiciones}`;
}
