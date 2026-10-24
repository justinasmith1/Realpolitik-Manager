import {
  ActualizarEstadoClienteSchema,
  CreateClienteSchema,
  CreateContactoSchema,
  CreateRequisitoClienteSchema,
  ListarClientesQuerySchema,
  ReemplazarContactosSchema,
  UpdateClienteSchema,
  UpdateContactoSchema,
  UpdateRequisitoClienteSchema,
} from '@realpolitik/shared';
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate';

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

export const clientesRouter = Router();

clientesRouter.get('/', validate({ query: ListarClientesQuerySchema }), listarClientesController);
clientesRouter.post('/', validate({ body: CreateClienteSchema }), crearClienteController);
clientesRouter.get('/:id', validate({ params: ClienteIdParamsSchema }), obtenerClienteController);

clientesRouter.patch(
  '/:id',
  validate({ params: ClienteIdParamsSchema, body: UpdateClienteSchema }),
  actualizarClienteController,
);

clientesRouter.patch(
  '/:id/estado',
  validate({ params: ClienteIdParamsSchema, body: ActualizarEstadoClienteSchema }),
  cambiarEstadoClienteController,
);

// Contactos (HU1.3). Todas las rutas validan sus params: un id mal formado es un 400, no un 500.
clientesRouter.get(
  '/:id/contactos',
  validate({ params: ClienteIdParamsSchema }),
  listarContactosController,
);
clientesRouter.post(
  '/:id/contactos',
  validate({ params: ClienteIdParamsSchema, body: CreateContactoSchema }),
  crearContactoController,
);
// Guardado completo de la colección: todo o nada (ver `reemplazarContactos`).
clientesRouter.put(
  '/:id/contactos',
  validate({ params: ClienteIdParamsSchema, body: ReemplazarContactosSchema }),
  reemplazarContactosController,
);
clientesRouter.patch(
  '/:id/contactos/:contactoId',
  validate({ params: ContactoParamsSchema, body: UpdateContactoSchema }),
  actualizarContactoController,
);
clientesRouter.delete(
  '/:id/contactos/:contactoId',
  validate({ params: ContactoParamsSchema }),
  eliminarContactoController,
);

// Matriz de requisitos (HU2.2). El DELETE es baja lógica. Un id mal formado es un 400, no un 500.
clientesRouter.get(
  '/:id/requisitos',
  validate({ params: ClienteIdParamsSchema }),
  listarRequisitosController,
);
clientesRouter.post(
  '/:id/requisitos',
  validate({ params: ClienteIdParamsSchema, body: CreateRequisitoClienteSchema }),
  crearRequisitoController,
);
clientesRouter.patch(
  '/:id/requisitos/:requisitoId',
  validate({ params: RequisitoParamsSchema, body: UpdateRequisitoClienteSchema }),
  actualizarRequisitoController,
);
clientesRouter.delete(
  '/:id/requisitos/:requisitoId',
  validate({ params: RequisitoParamsSchema }),
  eliminarRequisitoController,
);
