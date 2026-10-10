import {
  ContactoSchema,
  type Contacto,
  type CreateContactoDto,
  type ReemplazarContactosSchema,
  type UpdateContactoDto,
} from '@realpolitik/shared';

import { http } from '@/lib/http';

/**
 * Un contacto tal como lo envía el guardado completo: con `id` si ya existe, sin `id` si es
 * nuevo. Es el tipo de ENTRADA del schema compartido (el de salida ya tiene todo normalizado).
 */
export type ContactoAGuardar = (typeof ReemplazarContactosSchema)['_input']['contactos'][number];

export async function listarContactos(
  clienteId: string,
  signal?: AbortSignal,
): Promise<Contacto[]> {
  const response = await http(`/clientes/${clienteId}/contactos`, signal ? { signal } : {});
  return ContactoSchema.array().parse(await response.json());
}

/**
 * `PUT /clientes/:id/contactos`. Guarda la colección completa de contactos del cliente en una
 * sola operación: se aplica todo o nada. Los contactos que no se envían se eliminan. Devuelve
 * la colección final. Los errores llegan sin modificar, como en el resto de la API.
 */
export async function guardarContactos(
  clienteId: string,
  contactos: ContactoAGuardar[],
): Promise<Contacto[]> {
  const response = await http(`/clientes/${clienteId}/contactos`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactos }),
  });
  return ContactoSchema.array().parse(await response.json());
}

export async function crearContacto(
  clienteId: string,
  datos: CreateContactoDto,
): Promise<Contacto> {
  const response = await http(`/clientes/${clienteId}/contactos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  return ContactoSchema.parse(await response.json());
}

export async function actualizarContacto(
  clienteId: string,
  contactoId: string,
  datos: UpdateContactoDto,
): Promise<Contacto> {
  const response = await http(`/clientes/${clienteId}/contactos/${contactoId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  return ContactoSchema.parse(await response.json());
}

export async function eliminarContacto(clienteId: string, contactoId: string): Promise<void> {
  await http(`/clientes/${clienteId}/contactos/${contactoId}`, {
    method: 'DELETE',
  });
}
