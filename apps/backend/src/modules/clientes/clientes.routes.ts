import {
  ActualizarEstadoClienteSchema,
  CreateClienteSchema,
  ListarClientesQuerySchema,
  CreateContactoSchema,
  ReemplazarContactosSchema,
  UpdateClienteSchema,
  UpdateContactoSchema,
} from '@realpolitik/shared';
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate';

import {
  actualizarClienteController,
  cambiarEstadoClienteController,
  crearClienteController,
  listarClientesController,
} from './clientes.controller';
import {
  actualizarContactoController,
  crearContactoController,
  eliminarContactoController,
  listarContactosController,
  reemplazarContactosController,
} from './contactos.controller';

export const ClienteIdParamsSchema = z.object({
  id: z.string().uuid({ message: 'El ID debe ser un UUID válido.' }),
});

/** Params de las rutas que apuntan a un contacto concreto de un cliente. */
export const ContactoParamsSchema = ClienteIdParamsSchema.extend({
  contactoId: z.string().uuid({ message: 'El ID del contacto debe ser un UUID válido.' }),
});

export const clientesRouter = Router();

clientesRouter.get('/', validate({ query: ListarClientesQuerySchema }), listarClientesController);
clientesRouter.post('/', validate({ body: CreateClienteSchema }), crearClienteController);

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
