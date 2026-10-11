// Validación de entrada de Cliente que protege a la base: ningún dato que shared acepte puede
// ser rechazado después por PostgreSQL (un 500 en vez de un 400). Los largos son los de las
// columnas de `apps/backend/prisma/schema.prisma`. Cada límite se prueba en el máximo (se
// acepta) y en máximo + 1 (se rechaza, en el campo correcto).

import { describe, expect, it } from 'vitest';
import type { ZodError } from 'zod';

import {
  CreateClienteSchema,
  UpdateClienteSchema,
  problemasDeEmails,
  WhatsappNumeroSchema,
  ClienteSchema,
} from './cliente.schema.js';

const altaBase = {
  razonSocial: 'Empresa Privada S.A.',
  denominacion: 'Empresa Privada',
  cuit: '20-12345678-6',
  sector: 'PRIVADO' as const,
  ivaCondicion: 'RESPONSABLE_INSCRIPTO' as const,
  emailContacto: 'empresa@privada.com',
};

const alta = (extra: Record<string, unknown> = {}) =>
  CreateClienteSchema.safeParse({ ...altaBase, ...extra });
const edicion = (cambios: Record<string, unknown>) => UpdateClienteSchema.safeParse(cambios);

/** Paths (en notación de puntos) de los issues de un parse fallido. */
const paths = (resultado: { error?: ZodError }) =>
  resultado.error?.issues.map((issue) => issue.path.join('.')) ?? [];

const mensajes = (resultado: { error?: ZodError }) =>
  resultado.error?.issues.map((issue) => issue.message) ?? [];

/** Email válido de exactamente `largo` caracteres (local de 64 y etiquetas de hasta 63). */
function emailDeLargo(largo: number): string {
  const inicio = `${'a'.repeat(64)}@`;
  const sobra = largo - inicio.length - 'com'.length;
  let dominio = '';
  while (dominio.length < sobra) {
    dominio += `${'b'.repeat(Math.min(63, sobra - dominio.length - 1))}.`;
  }
  const email = `${inicio}${dominio}com`;
  expect(email).toHaveLength(largo);
  return email;
}

/** URL https de exactamente `largo` caracteres. */
function urlDeLargo(largo: number): string {
  const inicio = 'https://portal.ejemplo.com/';
  return inicio + 'a'.repeat(largo - inicio.length);
}

describe('límites de las columnas de Cliente', () => {
  describe.each([
    ['razonSocial', 150, (n: number) => 'R'.repeat(n)],
    ['denominacion', 60, (n: number) => 'D'.repeat(n)],
    ['emailContacto', 254, emailDeLargo],
  ] as const)('%s (máximo %i)', (campo, maximo, generar) => {
    it('acepta el máximo en el alta y en la edición', () => {
      expect(alta({ [campo]: generar(maximo) }).success).toBe(true);
      expect(edicion({ [campo]: generar(maximo) }).success).toBe(true);
    });

    it('rechaza máximo + 1 en el alta y en la edición, en su propio campo', () => {
      expect(paths(alta({ [campo]: generar(maximo + 1) }))).toEqual([campo]);
      expect(paths(edicion({ [campo]: generar(maximo + 1) }))).toEqual([campo]);
    });
  });

  describe('emailsAdicionales (cada email: máximo 254)', () => {
    it('acepta emails de 254 caracteres', () => {
      expect(alta({ emailsAdicionales: [emailDeLargo(254)] }).success).toBe(true);
    });

    it('rechaza uno de 255 y marca su posición', () => {
      expect(paths(alta({ emailsAdicionales: ['ok@ejemplo.com', emailDeLargo(255)] }))).toEqual([
        'emailsAdicionales.1',
      ]);
      expect(paths(edicion({ emailsAdicionales: [emailDeLargo(255)] }))).toEqual([
        'emailsAdicionales.0',
      ]);
    });

    it('el mensaje dice el límite', () => {
      expect(mensajes(alta({ emailsAdicionales: [emailDeLargo(255)] }))).toEqual([
        'Un email adicional no puede superar los 254 caracteres.',
      ]);
    });
  });

  describe('portalUrl (máximo 500)', () => {
    it('acepta 500 caracteres', () => {
      const portalUrl = urlDeLargo(500);
      expect(alta({ canalEntrega: 'PORTAL_WEB', portalUrl }).success).toBe(true);
      expect(edicion({ portalUrl }).success).toBe(true);
    });

    it('rechaza 501 caracteres', () => {
      const portalUrl = urlDeLargo(501);
      expect(paths(alta({ canalEntrega: 'PORTAL_WEB', portalUrl }))).toEqual(['portalUrl']);
      expect(paths(edicion({ portalUrl }))).toEqual(['portalUrl']);
    });

    it('mide el largo de la URL ya recortada', () => {
      const resultado = alta({ canalEntrega: 'PORTAL_WEB', portalUrl: `  ${urlDeLargo(500)}  ` });
      expect(resultado.success).toBe(true);
    });
  });

  describe('telefono (columna de 25; el formato admite hasta 21)', () => {
    it('acepta el máximo que permite el formato', () => {
      const resultado = alta({ telefono: `+${'1'.repeat(20)}` });
      expect(resultado.success).toBe(true);
      if (resultado.success) {
        expect(resultado.data.telefono).toHaveLength(21);
      }
    });

    it('rechaza uno más', () => {
      expect(paths(alta({ telefono: `+${'1'.repeat(21)}` }))).toEqual(['telefono']);
      expect(paths(alta({ telefono: '1'.repeat(21) }))).toEqual(['telefono']);
    });

    it.each(['+54 11 4000-1234', '(0351) 422.5566', '3514225566', '+54 (351) 422-5566'])(
      'acepta %s',
      (telefono) => {
        expect(alta({ telefono }).data?.telefono).toBe(telefono);
        expect(edicion({ telefono }).data?.telefono).toBe(telefono);
      },
    );

    it('recorta los espacios exteriores antes de validar y guarda el valor recortado', () => {
      expect(alta({ telefono: '  +54 11 4000-1234  ' }).data?.telefono).toBe('+54 11 4000-1234');
      // El largo se mide ya recortado: 20 caracteres útiles con espacios alrededor.
      expect(alta({ telefono: ` ${'1'.repeat(20)} ` }).success).toBe(true);
    });

    it('los tabuladores y saltos de línea de los bordes se recortan', () => {
      expect(alta({ telefono: '\t351 4225566\n' }).data?.telefono).toBe('351 4225566');
    });

    it.each([
      ['una tabulación', '351\t4225566'],
      ['un salto de línea', '351\n4225566'],
      ['un retorno de carro', '351\r4225566'],
      ['un NUL', '351\u00004225566'],
      ['un espacio de no separación', '351 4225566'],
      ['un espacio de ancho completo', '351　4225566'],
      ['un DEL', '351\u007F4225566'],
    ])('rechaza %s dentro del número', (_caso, telefono) => {
      expect(paths(alta({ telefono }))).toEqual(['telefono']);
      expect(paths(edicion({ telefono }))).toEqual(['telefono']);
    });

    it('rechaza letras, un + que no está al principio y un valor vacío o corto', () => {
      for (const telefono of ['351-ABC-4225566', '351+4225566', '', '   ', '123456']) {
        expect(paths(alta({ telefono }))).toEqual(['telefono']);
      }
    });
  });

  describe('whatsappNumero (columna de 16: + y hasta 15 dígitos)', () => {
    it('con 15 dígitos queda de 16 caracteres', () => {
      const resultado = WhatsappNumeroSchema.safeParse('549351123456789');
      expect(resultado.success).toBe(true);
      expect(resultado.data).toHaveLength(16);
    });

    it('rechaza 16 dígitos, con o sin +, y separadores no los compensan', () => {
      expect(WhatsappNumeroSchema.safeParse('5493511234567890').success).toBe(false);
      expect(WhatsappNumeroSchema.safeParse('+5493511234567890').success).toBe(false);
      expect(WhatsappNumeroSchema.safeParse('+54 9 351 123 4567 890').success).toBe(false);
    });

    it('nunca produce más de 16 caracteres, cualquiera sea la entrada aceptada', () => {
      for (const digitos of [10, 11, 12, 13, 14, 15]) {
        const resultado = WhatsappNumeroSchema.safeParse(`+ ${'9'.repeat(digitos)}`);
        expect(resultado.success).toBe(true);
        expect(resultado.data?.length).toBeLessThanOrEqual(16);
      }
    });

    it('un número demasiado largo falla en el alta antes de llegar a la base', () => {
      expect(paths(alta({ canalEntrega: 'WHATSAPP', whatsappNumero: '5493511234567890' }))).toEqual(
        ['whatsappNumero'],
      );
    });
  });

  describe('cuit (columna de 13)', () => {
    it('siempre se normaliza a 13 caracteres', () => {
      const resultado = alta({ cuit: '20123456786' });
      expect(resultado.success).toBe(true);
      expect(resultado.data?.cuit).toHaveLength(13);
    });
  });
});

describe('emails: trim, minúsculas y repetidos', () => {
  it('el email principal se guarda sin espacios y en minúsculas', () => {
    const resultado = alta({ emailContacto: '  Admin@Empresa.COM  ' });
    expect(resultado.data?.emailContacto).toBe('admin@empresa.com');
    expect(edicion({ emailContacto: ' Admin@Empresa.COM ' }).data?.emailContacto).toBe(
      'admin@empresa.com',
    );
  });

  it('el largo del principal se mide después del recorte', () => {
    expect(alta({ emailContacto: ` ${emailDeLargo(254)} ` }).success).toBe(true);
  });

  it('los adicionales también se normalizan', () => {
    const resultado = alta({ emailsAdicionales: [' Uno@Empresa.com ', 'DOS@empresa.com'] });
    expect(resultado.data?.emailsAdicionales).toEqual(['uno@empresa.com', 'dos@empresa.com']);
  });

  it('rechaza adicionales repetidos sin distinguir mayúsculas y marca a todos los repetidos', () => {
    const resultado = alta({
      emailsAdicionales: [
        'Administracion@Empresa.com',
        'otro@empresa.com',
        'administracion@empresa.com',
      ],
    });
    expect(paths(resultado)).toEqual(['emailsAdicionales.0', 'emailsAdicionales.2']);
    expect(mensajes(resultado)).toEqual([
      'Este email adicional está repetido.',
      'Este email adicional está repetido.',
    ]);
  });

  it('rechaza repetidos que solo difieren en espacios', () => {
    expect(paths(alta({ emailsAdicionales: ['a@empresa.com', ' a@empresa.com '] }))).toEqual([
      'emailsAdicionales.0',
      'emailsAdicionales.1',
    ]);
  });

  it('rechaza un adicional igual al email principal', () => {
    const resultado = alta({
      emailContacto: 'admin@empresa.com',
      emailsAdicionales: ['otro@empresa.com', 'ADMIN@empresa.com'],
    });
    expect(paths(resultado)).toEqual(['emailsAdicionales.1']);
    expect(mensajes(resultado)).toEqual([
      'Este email ya es el email de contacto principal: no hace falta repetirlo.',
    ]);
  });

  it('en la edición también rechaza repetidos, dentro de lo que viaja en el pedido', () => {
    expect(paths(edicion({ emailsAdicionales: ['a@empresa.com', 'A@empresa.com'] }))).toEqual([
      'emailsAdicionales.0',
      'emailsAdicionales.1',
    ]);
    expect(
      paths(edicion({ emailContacto: 'a@empresa.com', emailsAdicionales: ['a@empresa.com'] })),
    ).toEqual(['emailsAdicionales.0']);
  });

  it('acepta adicionales distintos entre sí y del principal', () => {
    expect(alta({ emailsAdicionales: ['uno@empresa.com', 'dos@empresa.com'] }).success).toBe(true);
    expect(alta({ emailsAdicionales: [] }).success).toBe(true);
  });

  it('la regla de repetidos es de escritura: ClienteSchema (lectura) no la aplica', () => {
    const guardado = ClienteSchema.safeParse({
      ...altaBase,
      id: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
      periodicidad: null,
      creadoEn: new Date(),
      actualizadoEn: new Date(),
      emailsAdicionales: [altaBase.emailContacto, altaBase.emailContacto],
    });
    expect(guardado.success).toBe(true);
  });
});

describe('portalUrl: solo http y https, sin credenciales', () => {
  const conPortal = (portalUrl: string) => alta({ canalEntrega: 'PORTAL_WEB', portalUrl });

  it.each([
    'https://portal.ejemplo.com',
    'https://portal.ejemplo.com/login',
    'http://localhost:8080/path',
    'https://portal.ejemplo.com/login?next=%2Fhome&x=1#seccion',
    'HTTPS://Portal.Ejemplo.com/Ruta',
    'http://192.168.0.10:3000',
  ])('acepta %s', (portalUrl) => {
    const resultado = conPortal(portalUrl);
    expect(resultado.success).toBe(true);
    // Se guarda lo escrito (recortado), no una versión reescrita por `new URL()`.
    expect(resultado.data?.portalUrl).toBe(portalUrl);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://ejemplo.com/archivo',
    'file:///etc/passwd',
    'mailto:alguien@ejemplo.com',
    'ws://ejemplo.com',
    'blob:https://ejemplo.com/uuid',
    '//portal.ejemplo.com',
    'portal.ejemplo.com',
    'https:portal.ejemplo.com',
    'https:/portal.ejemplo.com',
    'https://',
    'https://exa mple.com',
    'no es una url',
  ])('rechaza %s con el mensaje de URL HTTP/HTTPS', (portalUrl) => {
    const resultado = conPortal(portalUrl);
    expect(paths(resultado)).toEqual(['portalUrl']);
    expect(mensajes(resultado)).toEqual([
      'La URL del portal debe ser una URL HTTP o HTTPS válida (por ejemplo, https://portal.ejemplo.com).',
    ]);
  });

  it.each([
    'https://usuario:clave@ejemplo.com/',
    'https://usuario@ejemplo.com',
    'http://usuario:@ejemplo.com',
    'http://:clave@ejemplo.com',
  ])('rechaza credenciales embebidas: %s', (portalUrl) => {
    const resultado = conPortal(portalUrl);
    expect(paths(resultado)).toEqual(['portalUrl']);
    expect(mensajes(resultado)).toEqual([
      'La URL del portal no puede incluir usuario ni contraseña.',
    ]);
  });

  it('acepta una @ fuera del tramo de usuario (ruta o query)', () => {
    expect(conPortal('https://ejemplo.com/perfil/@yo?mail=a@b.com').success).toBe(true);
  });

  it.each(['\u0000', '\t', '\n', '\r', '\u007F', '\u0085'])(
    'rechaza un carácter de control (%j) dentro de la URL',
    (control) => {
      const resultado = conPortal(`https://ejemplo.com/a${control}b`);
      expect(paths(resultado)).toEqual(['portalUrl']);
      expect(mensajes(resultado)).toEqual([
        'La URL del portal no puede contener caracteres de control.',
      ]);
    },
  );

  it('recorta los espacios y saltos de línea de los bordes', () => {
    expect(conPortal('  https://ejemplo.com\n').data?.portalUrl).toBe('https://ejemplo.com');
  });

  it('se aplica igual en la edición', () => {
    expect(paths(edicion({ portalUrl: 'javascript:alert(1)' }))).toEqual(['portalUrl']);
    expect(paths(edicion({ portalUrl: 'https://u:p@ejemplo.com' }))).toEqual(['portalUrl']);
    expect(edicion({ portalUrl: 'https://ejemplo.com/nuevo' }).success).toBe(true);
  });

  it('con canal PORTAL_WEB, una URL no válida falla en portalUrl y no pide la URL de nuevo', () => {
    expect(paths(conPortal('javascript:alert(1)'))).toEqual(['portalUrl']);
  });
});

describe('caracteres de control en los textos', () => {
  it.each(['razonSocial', 'denominacion'] as const)(
    '%s rechaza NUL, saltos de línea y tabulaciones internas',
    (campo) => {
      for (const control of ['\u0000', '\n', '\t', '\u001F', '\u007F']) {
        expect(paths(alta({ [campo]: `Ab${control}cd` }))).toEqual([campo]);
        expect(paths(edicion({ [campo]: `Ab${control}cd` }))).toEqual([campo]);
      }
    },
  );

  it('el mensaje dice por qué', () => {
    expect(mensajes(alta({ razonSocial: 'Ab\u0000cd' }))).toEqual([
      'La razón social no puede contener caracteres de control.',
    ]);
    expect(mensajes(alta({ denominacion: 'Ab\u0000cd' }))).toEqual([
      'La denominación no puede contener caracteres de control.',
    ]);
  });

  it('los de los bordes se recortan y no cuentan', () => {
    expect(alta({ razonSocial: '\n  Empresa S.A.\t' }).data?.razonSocial).toBe('Empresa S.A.');
  });

  it('acepta acentos, ñ, emojis y símbolos comunes', () => {
    expect(
      alta({ razonSocial: 'Cooperativa Ñandú & Hijos — "La Esperanza" (Ltda.) 🌱' }).success,
    ).toBe(true);
  });
});

describe('problemasDeEmails: la regla de emails sobre un estado completo', () => {
  it('sin problemas devuelve una lista vacía', () => {
    expect(problemasDeEmails({ emailContacto: 'a@e.com', emailsAdicionales: ['b@e.com'] })).toEqual(
      [],
    );
    expect(problemasDeEmails({})).toEqual([]);
    expect(problemasDeEmails({ emailContacto: 'a@e.com' })).toEqual([]);
  });

  it('marca un adicional igual al principal, sin distinguir mayúsculas ni espacios', () => {
    expect(
      problemasDeEmails({ emailContacto: 'a@e.com', emailsAdicionales: ['b@e.com', ' A@E.com '] }),
    ).toEqual([expect.objectContaining({ indice: 1, tipo: 'IGUAL_AL_PRINCIPAL' })]);
  });

  it('marca todos los adicionales repetidos entre sí', () => {
    const problemas = problemasDeEmails({
      emailContacto: 'a@e.com',
      emailsAdicionales: ['b@e.com', 'c@e.com', 'B@e.com'],
    });
    expect(problemas.map(({ indice, tipo }) => [indice, tipo])).toEqual([
      [0, 'REPETIDO'],
      [2, 'REPETIDO'],
    ]);
  });

  it('un adicional igual al principal y repetido informa un solo problema por posición', () => {
    const problemas = problemasDeEmails({
      emailContacto: 'a@e.com',
      emailsAdicionales: ['a@e.com', 'a@e.com'],
    });
    expect(problemas.map(({ indice, tipo }) => [indice, tipo])).toEqual([
      [0, 'IGUAL_AL_PRINCIPAL'],
      [1, 'IGUAL_AL_PRINCIPAL'],
    ]);
  });

  it('es la misma regla que aplican el alta y la edición', () => {
    const datos = { emailContacto: 'a@e.com', emailsAdicionales: ['A@e.com'] };
    expect(paths(alta(datos))).toEqual(['emailsAdicionales.0']);
    expect(mensajes(alta(datos))).toEqual([problemasDeEmails(datos)[0]?.mensaje]);
  });
});
