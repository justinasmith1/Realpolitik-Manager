import {
  ActualizarEstadoClienteSchema,
  CreateClienteSchema,
  CreateContactoSchema,
  CreateRequisitoClienteSchema,
  IndicacionesArmadoSchema,
  ListarClientesQuerySchema,
  ObservacionesClienteSchema,
  ReemplazarContactosSchema,
  UpdateClienteSchema,
  UpdateContactoSchema,
  UpdateRequisitoClienteSchema,
} from '@realpolitik/shared';
import { z } from 'zod';

import { validate } from '../../middleware/validate';
import { autorizar, crearRouter } from '../auth/autorizacion';

import {
  actualizarClienteController,
  cambiarEstadoClienteController,
  crearClienteController,
  listarClientesController,
  obtenerClienteController,
} from './clientes.controller';
import {
  actualizarContactoController,
  crearContactoController,
  eliminarContactoController,
  listarContactosController,
  reemplazarContactosController,
} from './contactos.controller';
import {
  guardarIndicacionesArmadoController,
  obtenerIndicacionesArmadoController,
} from './indicaciones-armado.controller';
import {
  guardarObservacionesController,
  obtenerObservacionesController,
} from './observaciones.controller';
import {
  actualizarRequisitoController,
  crearRequisitoController,
  eliminarRequisitoController,
  listarRequisitosController,
} from './requisitos.controller';

export const ClienteIdParamsSchema = z.object({
  id: z.string().uuid({ message: 'El ID debe ser un UUID válido.' }),
});

/** Params de las rutas que apuntan a un contacto concreto de un cliente. */
export const ContactoParamsSchema = ClienteIdParamsSchema.extend({
  contactoId: z.string().uuid({ message: 'El ID del contacto debe ser un UUID válido.' }),
});

/** Params de las rutas que apuntan a un requisito concreto de un cliente. */
export const RequisitoParamsSchema = ClienteIdParamsSchema.extend({
  requisitoId: z.string().uuid({ message: 'El ID del requisito debe ser un UUID válido.' }),
});

export const clientesRouter = crearRouter();

clientesRouter.get(
  '/',
  autorizar('clientes:ver'),
  validate({ query: ListarClientesQuerySchema }),
  listarClientesController,
);
clientesRouter.post(
  '/',
  autorizar('clientes:editar'),
  validate({ body: CreateClienteSchema }),
  crearClienteController,
);
clientesRouter.get(
  '/:id',
  autorizar('clientes:ver'),
  validate({ params: ClienteIdParamsSchema }),
  obtenerClienteController,
);

clientesRouter.patch(
  '/:id',
  autorizar('clientes:editar'),
  validate({ params: ClienteIdParamsSchema, body: UpdateClienteSchema }),
  actualizarClienteController,
);

clientesRouter.patch(
  '/:id/estado',
  autorizar('clientes:editar'),
  validate({ params: ClienteIdParamsSchema, body: ActualizarEstadoClienteSchema }),
  cambiarEstadoClienteController,
);

// Contactos (HU1.3). Todas las rutas validan sus params: un id mal formado es un 400, no un 500.
clientesRouter.get(
  '/:id/contactos',
  autorizar('clientes:ver'),
  validate({ params: ClienteIdParamsSchema }),
  listarContactosController,
);
clientesRouter.post(
  '/:id/contactos',
  autorizar('clientes:editar'),
  validate({ params: ClienteIdParamsSchema, body: CreateContactoSchema }),
  crearContactoController,
);
// Guardado completo de la colección: todo o nada (ver `reemplazarContactos`).
clientesRouter.put(
  '/:id/contactos',
  autorizar('clientes:editar'),
  validate({ params: ClienteIdParamsSchema, body: ReemplazarContactosSchema }),
  reemplazarContactosController,
);
clientesRouter.patch(
  '/:id/contactos/:contactoId',
  autorizar('clientes:editar'),
  validate({ params: ContactoParamsSchema, body: UpdateContactoSchema }),
  actualizarContactoController,
);
clientesRouter.delete(
  '/:id/contactos/:contactoId',
  autorizar('clientes:editar'),
  validate({ params: ContactoParamsSchema }),
  eliminarContactoController,
);

// Matriz de requisitos (HU2.2). El DELETE es baja lógica. Un id mal formado es un 400, no un 500.
clientesRouter.get(
  '/:id/requisitos',
  autorizar('requisitos:ver'),
  validate({ params: ClienteIdParamsSchema }),
  listarRequisitosController,
);
clientesRouter.post(
  '/:id/requisitos',
  autorizar('requisitos:editar'),
  validate({ params: ClienteIdParamsSchema, body: CreateRequisitoClienteSchema }),
  crearRequisitoController,
);
clientesRouter.patch(
  '/:id/requisitos/:requisitoId',
  autorizar('requisitos:editar'),
  validate({ params: RequisitoParamsSchema, body: UpdateRequisitoClienteSchema }),
  actualizarRequisitoController,
);
clientesRouter.delete(
  '/:id/requisitos/:requisitoId',
  autorizar('requisitos:editar'),
  validate({ params: RequisitoParamsSchema }),
  eliminarRequisitoController,
);

// Indicaciones de armado (HU2.4).
clientesRouter.get(
  '/:id/indicaciones-armado',
  autorizar('requisitos:ver'),
  validate({ params: ClienteIdParamsSchema }),
  obtenerIndicacionesArmadoController,
);
clientesRouter.put(
  '/:id/indicaciones-armado',
  autorizar('requisitos:editar'),
  validate({ params: ClienteIdParamsSchema, body: IndicacionesArmadoSchema }),
  guardarIndicacionesArmadoController,
);

// Observaciones internas de la ficha (HU2.10). Se pueden leer y guardar con el cliente en
// cualquier estado.
clientesRouter.get(
  '/:id/observaciones',
  autorizar('clientes:ver'),
  validate({ params: ClienteIdParamsSchema }),
  obtenerObservacionesController,
);
clientesRouter.put(
  '/:id/observaciones',
  autorizar('clientes:editar'),
  validate({ params: ClienteIdParamsSchema, body: ObservacionesClienteSchema }),
  guardarObservacionesController,
);
