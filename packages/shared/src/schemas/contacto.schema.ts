import { z } from 'zod';

export const ContactoSchema = z.object({
  id: z.string().uuid({ message: 'El ID debe ser un UUID v4 válido.' }),
  nombre: z
    .string()
    .trim()
    .min(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
    .max(150, { message: 'El nombre no puede superar los 150 caracteres.' }),
  area: z
    .string()
    .trim()
    .min(2, { message: 'El área debe tener al menos 2 caracteres.' })
    .max(100, { message: 'El área no puede superar los 100 caracteres.' }),
  email: z
    .string()
    .trim()
    .email({ message: 'El email del contacto no tiene un formato válido.' })
    .toLowerCase(),
  recibeRendiciones: z.boolean().default(false),
  clienteId: z.string().uuid(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

export type Contacto = z.infer<typeof ContactoSchema>;

export const CreateContactoSchema = ContactoSchema.omit({
  id: true,
  clienteId: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateContactoDto = z.infer<typeof CreateContactoSchema>;

export const UpdateContactoSchema = CreateContactoSchema.partial();

export type UpdateContactoDto = z.infer<typeof UpdateContactoSchema>;
