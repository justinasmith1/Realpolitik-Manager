// ─── Schemas y tipos ──────────────────────────────────────────────────────────
export {
  ClienteSchema,
  CreateClienteSchema,
  UpdateClienteSchema,
  IvaCondicion,
  ClienteEstado,
  ClienteSector,
  ClienteSubtipoPublico,
} from './schemas/cliente.schema.js';

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
