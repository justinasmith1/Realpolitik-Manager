// ─── Schemas y tipos ──────────────────────────────────────────────────────────
export {
  ClienteSchema,
  CreateClienteSchema,
  UpdateClienteSchema,
  IvaCondicion,
  ClienteEstado,
  ClienteSector,
  ClienteSubtipoPublico,
  CuitSchema,
  subtiposPorSector,
} from './schemas/cliente.schema.js';

export { ListarClientesQuerySchema } from './schemas/listarClientesQuery.schema.js';
export type { ListarClientesQuery } from './schemas/listarClientesQuery.schema.js';

export type {
  Cliente,
  ClientePublico,
  ClientePrivado,
  CreateClienteDto,
  UpdateClienteDto,
  IvaCondicion as IvaCondicionType,
  ClienteEstado as ClienteEstadoType,
  ClienteSector as ClienteSectorType,
  ClienteSubtipoPublico as ClienteSubtipoPublicoType,
} from './schemas/cliente.schema.js';

// ─── Utilidades ───────────────────────────────────────────────────────────────
export { validateCuit } from './utils/validateCuit.js';
export { cambiarSector } from './utils/cambiarSector.js';
export type { Clasificacion } from './utils/cambiarSector.js';
