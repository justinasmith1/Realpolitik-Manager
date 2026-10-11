import { describe, expect, it } from 'vitest';
import type { ZodError } from 'zod';

import {
  ContactoGuardadoSchema,
  ContactoSchema,
  CreateContactoSchema,
  ReemplazarContactosSchema,
  UpdateContactoSchema,
} from './contacto.schema.js';

const ID_A = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const ID_B = 'b2c3d4e5-f6a7-4890-bcde-f01234567890';

const contacto = {
  nombre: 'Ana Pérez',
  area: 'Tesorería',
  email: 'ana@ejemplo.example',
  recibeRendiciones: true,
};

/** Rutas (en notación de puntos) de los issues de un parse fallido. */
const rutas = (resultado: { error?: ZodError }) =>
  resultado.error?.issues.map((issue) => issue.path.join('.')) ?? [];

const mensajes = (resultado: { error?: ZodError }) =>
  resultado.error?.issues.map((issue) => issue.message) ?? [];

/** Email de exactamente `largo` caracteres. */
const emailDeLargo = (largo: number) =>
  `${'a'.repeat(largo - '@ejemplo.example'.length)}@ejemplo.example`;

describe('email del contacto', () => {
  it('acepta un email válido y lo normaliza a minúsculas y sin espacios', () => {
    const resultado = CreateContactoSchema.safeParse({
      ...contacto,
      email: '  ANA@Ejemplo.Example ',
    });
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.email).toBe('ana@ejemplo.example');
  });

  it('rechaza un email con formato inválido con el mensaje de shared', () => {
    const resultado = CreateContactoSchema.safeParse({ ...contacto, email: 'no-es-un-email' });
    expect(rutas(resultado)).toEqual(['email']);
    expect(mensajes(resultado)).toEqual(['El email del contacto no tiene un formato válido.']);
  });

  it('acepta un email de exactamente 254 caracteres (el límite de la columna)', () => {
    const email = emailDeLargo(254);
    expect(email).toHaveLength(254);
    expect(CreateContactoSchema.safeParse({ ...contacto, email }).success).toBe(true);
  });

  it('rechaza un email de 255 caracteres', () => {
    const resultado = CreateContactoSchema.safeParse({ ...contacto, email: emailDeLargo(255) });
    expect(resultado.success).toBe(false);
    expect(rutas(resultado)).toContain('email');
    expect(mensajes(resultado)).toContain(
      'El email del contacto no puede superar los 254 caracteres.',
    );
  });

  it('mide el largo sobre el valor normalizado: los espacios exteriores no cuentan', () => {
    const email = `  ${emailDeLargo(254)}  `;
    expect(CreateContactoSchema.safeParse({ ...contacto, email }).success).toBe(true);
  });

  it('el límite también rige al leer un contacto (ContactoSchema)', () => {
    const resultado = ContactoSchema.safeParse({
      ...contacto,
      id: ID_A,
      clienteId: ID_B,
      email: emailDeLargo(255),
    });
    expect(resultado.success).toBe(false);
  });
});

describe('nombre y área del contacto: columnas de 150 y 100', () => {
  it.each([
    ['nombre', 150],
    ['area', 100],
  ] as const)('%s acepta %i caracteres y rechaza uno más', (campo, maximo) => {
    expect(
      CreateContactoSchema.safeParse({ ...contacto, [campo]: 'x'.repeat(maximo) }).success,
    ).toBe(true);
    const resultado = CreateContactoSchema.safeParse({
      ...contacto,
      [campo]: 'x'.repeat(maximo + 1),
    });
    expect(rutas(resultado)).toEqual([campo]);
  });

  it.each(['nombre', 'area'] as const)(
    '%s rechaza NUL y otros caracteres de control, que PostgreSQL no guardaría',
    (campo) => {
      for (const control of ['\u0000', '\n', '\t', '\u007F']) {
        const resultado = CreateContactoSchema.safeParse({
          ...contacto,
          [campo]: `Ab${control}cd`,
        });
        expect(rutas(resultado)).toEqual([campo]);
      }
    },
  );

  it('el mensaje dice por qué', () => {
    expect(mensajes(CreateContactoSchema.safeParse({ ...contacto, nombre: 'Ab\u0000cd' }))).toEqual(
      ['El nombre no puede contener caracteres de control.'],
    );
    expect(mensajes(CreateContactoSchema.safeParse({ ...contacto, area: 'Ab\u0000cd' }))).toEqual([
      'El área no puede contener caracteres de control.',
    ]);
  });

  it('también rige en cada contacto del guardado completo', () => {
    const resultado = ReemplazarContactosSchema.safeParse({
      contactos: [contacto, { ...contacto, email: 'otro@ejemplo.example', nombre: 'Ab\u0000cd' }],
    });
    expect(rutas(resultado)).toEqual(['contactos.1.nombre']);
  });
});

describe('UpdateContactoSchema', () => {
  it.each([
    ['nombre', { nombre: 'Otro Nombre' }],
    ['area', { area: 'Compras' }],
    ['email', { email: 'otro@ejemplo.example' }],
    ['recibeRendiciones', { recibeRendiciones: false }],
  ])('acepta %s como único campo', (_campo, datos) => {
    const resultado = UpdateContactoSchema.safeParse(datos);
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data).toEqual(datos);
  });

  it('rechaza {} con un mensaje claro', () => {
    const resultado = UpdateContactoSchema.safeParse({});
    expect(resultado.success).toBe(false);
    expect(mensajes(resultado)).toEqual(['Enviá al menos un campo para modificar.']);
  });

  it('rechaza un pedido que solo trae campos que no se editan', () => {
    expect(UpdateContactoSchema.safeParse({ clienteId: ID_A, isDeleted: true }).success).toBe(
      false,
    );
  });

  it('un campo ausente queda ausente: no aplica el default de recibeRendiciones', () => {
    const resultado = UpdateContactoSchema.safeParse({ nombre: 'Otro Nombre' });
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data).not.toHaveProperty('recibeRendiciones');
  });

  it('valida los campos que sí vienen', () => {
    expect(rutas(UpdateContactoSchema.safeParse({ email: 'no-es-email' }))).toEqual(['email']);
  });

  it('rechaza undefined explícito como único campo', () => {
    expect(UpdateContactoSchema.safeParse({ nombre: undefined }).success).toBe(false);
  });
});

describe('ReemplazarContactosSchema', () => {
  const guardar = (contactos: unknown) => ReemplazarContactosSchema.safeParse({ contactos });

  it('acepta una lista vacía: significa eliminar todos los contactos', () => {
    const resultado = guardar([]);
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.contactos).toEqual([]);
  });

  it('acepta contactos nuevos (sin id) y existentes (con id)', () => {
    const resultado = guardar([
      { ...contacto, id: ID_A },
      { ...contacto, email: 'otro@ejemplo.example' },
    ]);
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.contactos[0]?.id).toBe(ID_A);
      expect(resultado.data.contactos[1]).not.toHaveProperty('id');
    }
  });

  it('normaliza nombre, área y email', () => {
    const resultado = guardar([{ nombre: '  Ana  ', area: ' Tesorería ', email: ' ANA@X.COM ' }]);
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.contactos[0]).toMatchObject({
        nombre: 'Ana',
        area: 'Tesorería',
        email: 'ana@x.com',
        recibeRendiciones: false,
      });
    }
  });

  it('descarta lo que el cliente no puede fijar: clienteId, fechas y baja lógica', () => {
    const resultado = guardar([
      {
        ...contacto,
        clienteId: ID_B,
        creadoEn: '2020-01-01',
        isDeleted: true,
        deletedAt: '2020-01-01',
      },
    ]);
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      for (const campo of ['clienteId', 'creadoEn', 'isDeleted', 'deletedAt']) {
        expect(resultado.data.contactos[0]).not.toHaveProperty(campo);
      }
    }
  });

  it('no inventa un máximo de contactos', () => {
    const muchos = Array.from({ length: 200 }, (_, i) => ({
      ...contacto,
      email: `c${i}@ejemplo.example`,
    }));
    expect(guardar(muchos).success).toBe(true);
  });

  it('exige el objeto { contactos: [...] }', () => {
    expect(ReemplazarContactosSchema.safeParse({}).success).toBe(false);
    expect(ReemplazarContactosSchema.safeParse([]).success).toBe(false);
    expect(ReemplazarContactosSchema.safeParse({ contactos: 'x' }).success).toBe(false);
  });

  it('informa los errores de cada contacto con la ruta del campo', () => {
    const resultado = guardar([contacto, { nombre: 'A', area: 'Compras', email: 'x' }]);
    expect(rutas(resultado)).toEqual(['contactos.1.nombre', 'contactos.1.email']);
    expect(mensajes(resultado)).toEqual([
      'El nombre debe tener al menos 2 caracteres.',
      'El email del contacto no tiene un formato válido.',
    ]);
  });

  it('rechaza un id que no es UUID y marca la ruta del id', () => {
    const resultado = guardar([{ ...contacto, id: 'no-es-uuid' }]);
    expect(rutas(resultado)).toEqual(['contactos.0.id']);
  });

  describe('emails repetidos dentro de la lista', () => {
    it('marca a todos los contactos que comparten el email', () => {
      const resultado = guardar([
        contacto,
        { ...contacto, nombre: 'Otra Persona', email: 'otro@ejemplo.example' },
        { ...contacto, nombre: 'Tercera Persona' },
      ]);
      expect(resultado.success).toBe(false);
      expect(rutas(resultado)).toEqual(['contactos.0.email', 'contactos.2.email']);
      expect(mensajes(resultado)[0]).toBe('Este email está repetido en otro contacto de la lista.');
    });

    it('compara ya normalizado: mayúsculas y espacios no los distinguen', () => {
      const resultado = guardar([
        contacto,
        { ...contacto, nombre: 'Otra Persona', email: '  ANA@EJEMPLO.EXAMPLE ' },
      ]);
      expect(rutas(resultado)).toEqual(['contactos.0.email', 'contactos.1.email']);
    });

    it('un existente y uno nuevo con el mismo email también chocan', () => {
      const resultado = guardar([
        { ...contacto, id: ID_A },
        { ...contacto, nombre: 'Nueva Persona' },
      ]);
      expect(rutas(resultado)).toEqual(['contactos.0.email', 'contactos.1.email']);
    });

    it('detecta el repetido aunque otro campo del mismo contacto tenga un error', () => {
      const resultado = guardar([contacto, { ...contacto, nombre: 'X' }]);
      expect(rutas(resultado)).toEqual(
        expect.arrayContaining(['contactos.1.nombre', 'contactos.0.email', 'contactos.1.email']),
      );
    });

    it('no marca emails distintos', () => {
      expect(guardar([contacto, { ...contacto, email: 'otro@ejemplo.example' }]).success).toBe(
        true,
      );
    });
  });

  describe('ids repetidos dentro de la lista', () => {
    it('marca a los dos contactos con el mismo id', () => {
      const resultado = guardar([
        { ...contacto, id: ID_A },
        { ...contacto, id: ID_A, email: 'otro@ejemplo.example' },
      ]);
      expect(resultado.success).toBe(false);
      expect(rutas(resultado)).toEqual(['contactos.0.id', 'contactos.1.id']);
      expect(mensajes(resultado)[0]).toBe('Este contacto está repetido en la lista.');
    });

    it('varios contactos nuevos (sin id) no cuentan como repetidos', () => {
      const resultado = guardar([contacto, { ...contacto, email: 'otro@ejemplo.example' }]);
      expect(resultado.success).toBe(true);
    });

    it('ids distintos son válidos', () => {
      expect(
        guardar([
          { ...contacto, id: ID_A },
          { ...contacto, id: ID_B, email: 'otro@ejemplo.example' },
        ]).success,
      ).toBe(true);
    });
  });
});

describe('ContactoGuardadoSchema', () => {
  it('el id es opcional', () => {
    expect(ContactoGuardadoSchema.safeParse(contacto).success).toBe(true);
    expect(ContactoGuardadoSchema.safeParse({ ...contacto, id: ID_A }).success).toBe(true);
  });
});
