// ─── Schemas y tipos ──────────────────────────────────────────────────────────
export {
  ClienteSchema,
  CreateClienteSchema,
  UpdateClienteSchema,
  ActualizarEstadoClienteSchema,
  IvaCondicion,
  ClienteEstado,
  ClienteSector,
  ClienteSubtipoPublico,
  CanalEntrega,
  PeriodicidadTipo,
  PeriodicidadSchema,
  CuitSchema,
  WhatsappNumeroSchema,
  subtiposPorSector,
  problemasDeEmails,
} from './schemas/cliente.schema.js';

export {
  ContactoSchema,
  CreateContactoSchema,
  UpdateContactoSchema,
  ContactoGuardadoSchema,
  ReemplazarContactosSchema,
} from './schemas/contacto.schema.js';

export type {
  Contacto,
  CreateContactoDto,
  UpdateContactoDto,
  ContactoGuardadoDto,
  ReemplazarContactosDto,
} from './schemas/contacto.schema.js';

export {
  ListarClientesQuerySchema,
  MAX_BUSQUEDA_CLIENTES,
} from './schemas/listarClientesQuery.schema.js';
export type { ListarClientesQuery } from './schemas/listarClientesQuery.schema.js';

export type {
  DatosEmails,
  ProblemaDeEmail,
  Cliente,
  ClientePublico,
  ClientePrivado,
  CreateClienteDto,
  UpdateClienteDto,
  ActualizarEstadoClienteDto,
  Periodicidad,
  IvaCondicion as IvaCondicionType,
  ClienteEstado as ClienteEstadoType,
  ClienteSector as ClienteSectorType,
  ClienteSubtipoPublico as ClienteSubtipoPublicoType,
  CanalEntrega as CanalEntregaType,
  PeriodicidadTipo as PeriodicidadTipoType,
} from './schemas/cliente.schema.js';

export {
  TipoDocumentoSchema,
  CreateTipoDocumentoSchema,
  UpdateTipoDocumentoSchema,
  ActualizarEstadoTipoDocumentoSchema,
} from './schemas/tipoDocumento.schema.js';
export type {
  TipoDocumento,
  CreateTipoDocumentoDto,
  UpdateTipoDocumentoDto,
  ActualizarEstadoTipoDocumentoDto,
} from './schemas/tipoDocumento.schema.js';

export { ListarTiposDocumentoQuerySchema } from './schemas/listarTiposDocumentoQuery.schema.js';
export type { ListarTiposDocumentoQuery } from './schemas/listarTiposDocumentoQuery.schema.js';

export {
  RequisitoClienteSchema,
  CreateRequisitoClienteSchema,
  UpdateRequisitoClienteSchema,
  // Los usa el formulario de la matriz para no reescribir las reglas de un campo.
  CantidadSchema,
  DiasAproximadosSchema,
  NotaSchema,
  CanalPropioSchema,
  TipoDocumentoIdSchema,
} from './schemas/requisitoCliente.schema.js';
export type {
  RequisitoCliente,
  CreateRequisitoClienteDto,
  UpdateRequisitoClienteDto,
} from './schemas/requisitoCliente.schema.js';

export {
  CargaMasivaRequisitoSchema,
  ResultadoCargaMasivaSchema,
  MotivoOmisionCargaMasivaSchema,
  MOTIVOS_OMISION_CARGA_MASIVA,
} from './schemas/cargaMasivaRequisito.schema.js';
export type {
  CargaMasivaRequisitoDto,
  ResultadoCargaMasiva,
  MotivoOmisionCargaMasiva,
} from './schemas/cargaMasivaRequisito.schema.js';

export {
  IndicacionesArmadoSchema,
  IndicacionesArmadoLecturaSchema,
  INDICACIONES_ARMADO_MAX,
} from './schemas/indicacionesArmado.schema.js';
export type {
  IndicacionesArmadoDto,
  IndicacionesArmadoLecturaDto,
} from './schemas/indicacionesArmado.schema.js';

export {
  ObservacionesClienteSchema,
  ObservacionesClienteLecturaSchema,
  OBSERVACIONES_CLIENTE_MAX,
} from './schemas/observacionesCliente.schema.js';
export type {
  ObservacionesClienteDto,
  ObservacionesClienteLecturaDto,
} from './schemas/observacionesCliente.schema.js';

export {
  MENSAJE_NUMERO_FACTURA_FORMATO,
  MENSAJE_NUMERO_FACTURA_OBLIGATORIO,
  NUMERO_FACTURA_EJEMPLO,
  normalizarNumeroFactura,
  NumeroFacturaSchema,
  CreateRendicionSchema,
  ActualizarEstadoRendicionSchema,
  RendicionEstado,
  ItemChecklistSchema,
  RendicionSchema,
  RendicionDetalleSchema,
  RendicionResumenSchema,
} from './schemas/rendicion.schema.js';
export type {
  CreateRendicionDto,
  ActualizarEstadoRendicionDto,
  RendicionEstado as RendicionEstadoType,
  ItemChecklist,
  Rendicion,
  RendicionDetalle,
  RendicionResumen,
} from './schemas/rendicion.schema.js';

export {
  ActualizarCanalDeItemSchema,
  MENSAJE_CANAL_DE_ITEM,
  MAX_RENDICIONES_A_PROPAGAR,
  MENSAJE_RENDICION_IDS,
  PropagarCanalDeRequisitoSchema,
  ResultadoPropagarCanalSchema,
} from './schemas/canalDeItem.schema.js';
export type {
  ActualizarCanalDeItemDto,
  PropagarCanalDeRequisitoDto,
  ResultadoPropagarCanal,
} from './schemas/canalDeItem.schema.js';
export {
  FILTRO_ESTADO_POR_DEFECTO,
  FiltroEstadoRendiciones,
  ListarRendicionesQuerySchema,
  MENSAJE_REQUISITO_ID,
} from './schemas/listarRendicionesQuery.schema.js';
export type { ListarRendicionesQuery } from './schemas/listarRendicionesQuery.schema.js';

export { DocumentoDeItemSchema } from './schemas/documentoDeItem.schema.js';
export type { DocumentoDeItem } from './schemas/documentoDeItem.schema.js';
export {
  TAMANIO_MAXIMO_DOCUMENTO_BYTES,
  NOMBRE_ORIGINAL_MAX,
  FORMATOS_DE_DOCUMENTO,
  TipoContenidoDocumento,
  NombreOriginalSchema,
  TamanioDocumentoSchema,
  Sha256Schema,
  DocumentoNuevoSchema,
  DocumentoSchema,
  ListarDocumentosQuerySchema,
  MENSAJE_FORMATO_DOCUMENTO,
  MENSAJE_TAMANIO_DOCUMENTO,
  CAMPO_ARCHIVO_DOCUMENTO,
  CargarDocumentoSchema,
  DocumentoResumenSchema,
  ResultadoCargaDocumentoSchema,
} from './schemas/documento.schema.js';
export type {
  TipoContenidoDocumento as TipoContenidoDocumentoType,
  DocumentoNuevoDto,
  Documento,
  ListarDocumentosQuery,
  CargarDocumentoDto,
  DocumentoResumen,
  ResultadoCargaDocumento,
} from './schemas/documento.schema.js';
export {
  EstadoAplicacion,
  AplicacionDocumentoSchema,
  UbicacionDeAplicacionSchema,
  AplicacionUbicadaSchema,
  DocumentoConAplicacionesSchema,
  AplicacionConDocumentoSchema,
  HistorialDeItemSchema,
  ElegibilidadCandidato,
  CandidatoAplicacionSchema,
  MAX_ITEMS_A_APLICAR,
  MENSAJE_ITEM_IDS,
  AplicarDocumentoSchema,
  ReemplazarDocumentoDeItemSchema,
} from './schemas/aplicacionDocumento.schema.js';
export type {
  EstadoAplicacion as EstadoAplicacionType,
  AplicacionDocumento,
  UbicacionDeAplicacion,
  AplicacionUbicada,
  DocumentoConAplicaciones,
  AplicacionConDocumento,
  HistorialDeItem,
  ElegibilidadCandidato as ElegibilidadCandidatoType,
  CandidatoAplicacion,
  AplicarDocumentoDto,
  ReemplazarDocumentoDeItemDto,
} from './schemas/aplicacionDocumento.schema.js';

// ─── Utilidades ───────────────────────────────────────────────────────────────
export { validateCuit } from './utils/validateCuit.js';
export { cambiarSector } from './utils/cambiarSector.js';
export { normalizarNombreTipoDocumento } from './utils/nombreTipoDocumento.js';
export type { Clasificacion } from './utils/cambiarSector.js';
export {
  DIA_MIN,
  DIA_MAX,
  CANTIDAD_MAX,
  parsearDiasEscritos,
  problemaDeDias,
} from './utils/diasAproximados.js';
export {
  generarChecklist,
  calcularFaltantes,
  ChecklistError,
  esChecklistError,
  compararItemsDeChecklist,
} from './utils/checklist.js';
export type {
  PosicionEnChecklist,
  RequisitoDeMatriz,
  ItemChecklistNuevo,
  CodigoErrorChecklist,
  Faltantes,
} from './utils/checklist.js';
export {
  MAX_ITEMS_A_ENVIAR,
  MENSAJE_ITEMS_A_ENVIAR,
  ItemEnviableSchema,
  MotivoNoEnviable,
  PrepararEnvioSchema,
  PreparacionEnvioSchema,
} from './schemas/envio.schema.js';
export type {
  ItemEnviable,
  MotivoNoEnviable as MotivoNoEnviableType,
  PrepararEnvioDto,
  PreparacionEnvio,
} from './schemas/envio.schema.js';

export { canalDeSeleccion, destinatariosDeCorreo, motivoNoEnviable } from './utils/envio.js';
export type { CanalDeSeleccion, DestinatarioDeCorreo } from './utils/envio.js';
export { ANIO_MIN, ANIO_MAX, mesActual, periodoMuyFuturo } from './utils/periodo.js';
export type { Periodo } from './utils/periodo.js';
