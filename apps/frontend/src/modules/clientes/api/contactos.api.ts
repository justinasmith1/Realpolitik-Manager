import {
  ContactoSchema,
  type Contacto,
  type CreateContactoDto,
  type UpdateContactoDto,
} from '@realpolitik/shared';

import { http } from '@/lib/http';

export async function listarContactos(
  clienteId: string,
  signal?: AbortSignal,
): Promise<Contacto[]> {
  const response = await http(`/clientes/${clienteId}/contactos`, signal ? { signal } : {});
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
