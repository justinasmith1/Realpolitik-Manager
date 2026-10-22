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
  INDICACIONES_ARMADO_MAX,
} from './schemas/indicacionesArmado.schema.js';
export type { IndicacionesArmadoDto } from './schemas/indicacionesArmado.schema.js';

export {
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

export { ListarRendicionesQuerySchema } from './schemas/listarRendicionesQuery.schema.js';
export type { ListarRendicionesQuery } from './schemas/listarRendicionesQuery.schema.js';

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
} from './utils/checklist.js';
export type {
  RequisitoDeMatriz,
  ItemChecklistNuevo,
  CodigoErrorChecklist,
  Faltantes,
} from './utils/checklist.js';
export { ANIO_MIN, ANIO_MAX, mesActual, periodoMuyFuturo } from './utils/periodo.js';
export type { Periodo } from './utils/periodo.js';
