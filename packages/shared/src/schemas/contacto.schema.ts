import { z } from 'zod';

/** Largo máximo del email: es el `VarChar(254)` de la columna. Un largo mayor daría un 500. */
const EMAIL_MAX = 254;

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
  // `.trim()` va antes de `.max()`: el largo se mide sobre el valor ya normalizado.
  email: z
    .string()
    .trim()
    .max(EMAIL_MAX, {
      message: `El email del contacto no puede superar los ${EMAIL_MAX} caracteres.`,
    })
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

/**
 * Edición de un contacto (`PATCH`): cualquier subconjunto de los campos, con al menos uno.
 * Un campo ausente queda ausente (no se aplica el default de `recibeRendiciones`).
 */
export const UpdateContactoSchema = CreateContactoSchema.partial().superRefine((datos, ctx) => {
  if (Object.values(datos).every((valor) => valor === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Enviá al menos un campo para modificar.',
    });
  }
});

export type UpdateContactoDto = z.infer<typeof UpdateContactoSchema>;

// ─── Guardado completo de los contactos de un cliente ─────────────────────────

/**
 * Un contacto dentro del guardado completo. Con `id` es un contacto que ya existe; sin `id`,
 * uno nuevo. `clienteId`, las fechas y la baja lógica no se envían: los fija el servidor.
 */
export const ContactoGuardadoSchema = CreateContactoSchema.extend({
  id: z.string().uuid({ message: 'El ID del contacto debe ser un UUID válido.' }).optional(),
});

export type ContactoGuardadoDto = z.infer<typeof ContactoGuardadoSchema>;

/** Contacto mínimo que la regla de repetidos necesita leer. */
interface ContactoRepetible {
  id?: string | undefined;
  email: string;
}

/** Posiciones de cada valor que aparece más de una vez. */
function repetidos(valores: (string | undefined)[]): number[][] {
  const posiciones = new Map<string, number[]>();
  valores.forEach((valor, indice) => {
    if (valor === undefined) return;
    posiciones.set(valor, [...(posiciones.get(valor) ?? []), indice]);
  });
  return [...posiciones.values()].filter((indices) => indices.length > 1);
}

/**
 * Dentro del mismo guardado no puede haber dos contactos con el mismo email (comparado ya
 * normalizado: sin espacios y en minúsculas) ni el mismo `id`. Se marcan todos los contactos
 * involucrados, cada uno en su propio campo, para que el formulario pueda mostrarlo en línea.
 */
function validarRepetidos(contactos: ContactoRepetible[], ctx: z.RefinementCtx): void {
  const normalizar = (email: unknown) =>
    typeof email === 'string' ? email.trim().toLowerCase() : undefined;

  for (const indices of repetidos(contactos.map((c) => normalizar(c.email)))) {
    for (const indice of indices) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [indice, 'email'],
        message: 'Este email está repetido en otro contacto de la lista.',
      });
    }
  }

  for (const indices of repetidos(contactos.map((c) => c.id))) {
    for (const indice of indices) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [indice, 'id'],
        message: 'Este contacto está repetido en la lista.',
      });
    }
  }
}

/**
 * Cuerpo de `PUT /clientes/:id/contactos`: la colección completa de contactos del cliente.
 * Lo que no viene en la lista se elimina, y una lista vacía elimina todos. No se inventa un
 * máximo de contactos: el negocio no lo definió.
 */
export const ReemplazarContactosSchema = z.object({
  contactos: z.array(ContactoGuardadoSchema).superRefine(validarRepetidos),
});

export type ReemplazarContactosDto = z.infer<typeof ReemplazarContactosSchema>;
