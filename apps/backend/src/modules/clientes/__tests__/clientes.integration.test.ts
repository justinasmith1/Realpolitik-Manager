// Tests de integración de la validación de entrada de Clientes contra PostgreSQL REAL.
// Prueban lo que un mock no puede: que ningún dato que shared acepta sea rechazado por la base
// (un 500 en vez de un 400), y cómo se comporta de verdad la búsqueda con `%`, `_` y `\`.
//
// Son opcionales: sin `TEST_DATABASE_URL` se saltan (el CI no tiene base de datos). Para
// correrlos hace falta una base DESCARTABLE con las migraciones aplicadas, por ejemplo:
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@localhost:5432/realpolitik_audit?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run clientes.integration
//
// Cada test crea sus propios clientes (con una marca única) y los borra al final; no usa seed
// ni toca otros datos. Se niega a correr si la base no es `*_audit` o `*_test`.

import type { PrismaClient } from '@prisma/client';
import { validateCuit } from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from './baseDescartable';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let app: Express;
const clientesCreados: string[] = [];

/** Marca única de esta corrida: permite reconocer los clientes propios entre los de la base. */
const MARCA = `TESTB${Date.now().toString(36).toUpperCase()}`;

beforeAll(async () => {
  if (url === undefined) return;
  // El cliente de Prisma lee DATABASE_URL al importarse: se fija antes.
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: ['http://localhost:5173'] });
});

afterAll(async () => {
  if (url === undefined) return;
  await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
  await prisma.$disconnect();
});

// ─── Datos de prueba ──────────────────────────────────────────────────────────

/** CUIT válido (Módulo 11) y no usado por los demás tests de esta corrida. */
function cuitUnico(): string {
  for (;;) {
    const cuerpo = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    for (let verificador = 0; verificador <= 9; verificador++) {
      const candidato = `33${cuerpo}${verificador}`;
      if (validateCuit(candidato)) {
        return `33-${cuerpo}-${verificador}`;
      }
    }
  }
}

const alta = (extra: Record<string, unknown> = {}) => ({
  razonSocial: `${MARCA} Cliente de prueba`,
  denominacion: `${MARCA} prueba`,
  cuit: cuitUnico(),
  sector: 'PRIVADO',
  ivaCondicion: 'EXENTO',
  emailContacto: 'test@ejemplo.example',
  ...extra,
});

/** Un email válido de exactamente `largo` caracteres (local de 64, etiquetas de hasta 63). */
function emailDeLargo(largo: number): string {
  const inicio = `${'a'.repeat(64)}@`;
  const sobra = largo - inicio.length - 'com'.length;
  let dominio = '';
  while (dominio.length < sobra) {
    const falta = sobra - dominio.length;
    dominio += `${'b'.repeat(Math.min(63, falta - 1))}.`;
  }
  const email = `${inicio}${dominio}com`;
  expect(email).toHaveLength(largo);
  return email;
}

/** Una URL https de exactamente `largo` caracteres. */
function urlDeLargo(largo: number): string {
  const inicio = 'https://portal.ejemplo.example/';
  return inicio + 'a'.repeat(largo - inicio.length);
}

async function crear(body: object) {
  const respuesta = await request(app).post('/clientes').send(body);
  if (respuesta.status === 201) {
    clientesCreados.push((respuesta.body as { id: string }).id);
  }
  return respuesta;
}

/** Los `campo` que el servidor marcó en un 400. */
const camposInvalidos = (cuerpo: unknown): string[] =>
  (cuerpo as { error: { details: { campo: string }[] } }).error.details.map(
    (detalle) => detalle.campo,
  );

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(url === undefined)(
  'Clientes: la validación de entrada contra PostgreSQL real',
  () => {
    describe('límites de cada columna: el máximo se acepta y uno más es 400, nunca 500', () => {
      it('acepta todos los campos en su largo máximo a la vez', async () => {
        const respuesta = await crear(
          alta({
            razonSocial: `${MARCA}`.padEnd(150, 'x'),
            denominacion: `${MARCA}`.padEnd(60, 'x'),
            emailContacto: emailDeLargo(254),
            emailsAdicionales: Array.from({ length: 10 }, (_, i) =>
              emailDeLargo(254).replace(/^a/, String.fromCharCode(98 + i)),
            ),
            telefono: '+' + '1'.repeat(20),
            canalEntrega: 'PORTAL_WEB',
            portalUrl: urlDeLargo(500),
          }),
        );
        expect(respuesta.status).toBe(201);
      });

      it('acepta un WhatsApp de 15 dígitos (16 caracteres con el +) y rechaza uno de 16', async () => {
        const bien = await crear(
          alta({ canalEntrega: 'WHATSAPP', whatsappNumero: '5493511234567' }),
        );
        expect(bien.status).toBe(201);
        const maximo = await crear(
          alta({ canalEntrega: 'WHATSAPP', whatsappNumero: '+549351123456789' }),
        );
        expect(maximo.status).toBe(201);
        expect((maximo.body as { whatsappNumero: string }).whatsappNumero).toHaveLength(16);

        const demasiado = await crear(
          alta({ canalEntrega: 'WHATSAPP', whatsappNumero: '+5493511234567890' }),
        );
        expect(demasiado.status).toBe(400);
        expect(camposInvalidos(demasiado.body)).toEqual(['whatsappNumero']);
      });

      it.each([
        ['razonSocial', 151],
        ['denominacion', 61],
        ['telefono', 22],
      ])('rechaza %s de largo máximo + 1 con 400', async (campo, largo) => {
        const valor = campo === 'telefono' ? '+' + '1'.repeat(largo - 1) : 'x'.repeat(largo);
        const respuesta = await crear(alta({ [campo]: valor }));
        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual([campo]);
      });

      it('rechaza un emailContacto de 255 caracteres con 400', async () => {
        const respuesta = await crear(alta({ emailContacto: emailDeLargo(255) }));
        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual(['emailContacto']);
      });

      it('rechaza un email adicional de 255 caracteres con 400', async () => {
        const respuesta = await crear(alta({ emailsAdicionales: [emailDeLargo(255)] }));
        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual(['emailsAdicionales.0']);
      });

      it('rechaza una portalUrl de 501 caracteres con 400', async () => {
        const respuesta = await crear(
          alta({ canalEntrega: 'PORTAL_WEB', portalUrl: urlDeLargo(501) }),
        );
        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual(['portalUrl']);
      });

      it('en la edición también: email de 255 y portalUrl de 501 son 400', async () => {
        const creado = await crear(
          alta({ canalEntrega: 'PORTAL_WEB', portalUrl: urlDeLargo(500) }),
        );
        const { id } = creado.body as { id: string };

        const email = await request(app)
          .patch(`/clientes/${id}`)
          .send({ emailContacto: emailDeLargo(255) });
        expect(email.status).toBe(400);

        const portal = await request(app)
          .patch(`/clientes/${id}`)
          .send({ portalUrl: urlDeLargo(501) });
        expect(portal.status).toBe(400);

        const bien = await request(app)
          .patch(`/clientes/${id}`)
          .send({ emailContacto: emailDeLargo(254), portalUrl: urlDeLargo(500) });
        expect(bien.status).toBe(200);
      });
    });

    describe('contactos', () => {
      it('acepta un email de 254 caracteres y rechaza uno de 255', async () => {
        const creado = await crear(alta());
        const { id } = creado.body as { id: string };
        const contacto = { nombre: 'Ana Pérez', area: 'Tesorería', recibeRendiciones: false };

        const bien = await request(app)
          .post(`/clientes/${id}/contactos`)
          .send({ ...contacto, email: emailDeLargo(254) });
        expect(bien.status).toBe(201);

        const mal = await request(app)
          .post(`/clientes/${id}/contactos`)
          .send({ ...contacto, email: emailDeLargo(255) });
        expect(mal.status).toBe(400);
      });

      it('acepta nombre de 150 y área de 100 caracteres, y rechaza un carácter más', async () => {
        const creado = await crear(alta());
        const { id } = creado.body as { id: string };
        const ruta = `/clientes/${id}/contactos`;
        const base = { email: 'ana@ejemplo.example' };

        const bien = await request(app)
          .post(ruta)
          .send({ ...base, nombre: 'n'.repeat(150), area: 'a'.repeat(100) });
        expect(bien.status).toBe(201);

        const nombre = await request(app)
          .post(ruta)
          .send({ email: 'b@ejemplo.example', nombre: 'n'.repeat(151), area: 'Tesorería' });
        expect(nombre.status).toBe(400);

        const area = await request(app)
          .post(ruta)
          .send({ email: 'c@ejemplo.example', nombre: 'Ana', area: 'a'.repeat(101) });
        expect(area.status).toBe(400);
      });
    });

    describe('portalUrl', () => {
      it.each([
        'https://portal.ejemplo.example',
        'https://portal.ejemplo.example/login?next=%2Fhome#seccion',
        'http://localhost:8080/path',
      ])('acepta %s', async (portalUrl) => {
        const respuesta = await crear(alta({ canalEntrega: 'PORTAL_WEB', portalUrl }));
        expect(respuesta.status).toBe(201);
        expect((respuesta.body as { portalUrl: string }).portalUrl).toBe(portalUrl);
      });

      it.each([
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'ftp://ejemplo.example/archivo',
        'file:///etc/passwd',
        'https://usuario:clave@ejemplo.example/',
        'https://usuario@ejemplo.example/',
      ])('rechaza %s con 400', async (portalUrl) => {
        const respuesta = await crear(alta({ canalEntrega: 'PORTAL_WEB', portalUrl }));
        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual(['portalUrl']);
      });

      it('en la edición rechaza el mismo javascript: con 400', async () => {
        const creado = await crear(alta({ canalEntrega: 'PORTAL_WEB', portalUrl: urlDeLargo(60) }));
        const { id } = creado.body as { id: string };
        const respuesta = await request(app)
          .patch(`/clientes/${id}`)
          .send({ portalUrl: 'javascript:alert(1)' });
        expect(respuesta.status).toBe(400);
      });
    });

    describe('caracteres que PostgreSQL no guarda (NUL) y de control', () => {
      it.each([
        ['razonSocial', 'Empresa\u0000S.A.'],
        ['denominacion', 'Emp\u0000resa'],
        ['razonSocial', 'Empresa\nS.A.'],
      ])('rechaza %s con carácter de control con 400, no 500', async (campo, valor) => {
        const respuesta = await crear(alta({ [campo]: valor }));
        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual([campo]);
      });

      it('rechaza un NUL en nombre y área de un contacto con 400', async () => {
        const creado = await crear(alta());
        const { id } = creado.body as { id: string };
        const respuesta = await request(app)
          .post(`/clientes/${id}/contactos`)
          .send({ nombre: 'Ana\u0000', area: 'Teso\u0000', email: 'ana@ejemplo.example' });
        expect(respuesta.status).toBe(400);
      });

      it.each(['351\t4225566', '351\n4225566', '351\u00004225566'])(
        'rechaza un teléfono con tabulación, salto de línea o NUL (%j) con 400, no 500',
        async (telefono) => {
          const respuesta = await crear(alta({ telefono }));
          expect(respuesta.status).toBe(400);
          expect(camposInvalidos(respuesta.body)).toEqual(['telefono']);
        },
      );

      it('guarda el teléfono recortado', async () => {
        const respuesta = await crear(alta({ telefono: '  +54 351 422-5566 \n' }));
        expect(respuesta.status).toBe(201);
        expect((respuesta.body as { telefono: string }).telefono).toBe('+54 351 422-5566');
      });

      it('rechaza un NUL en la búsqueda con 400, no 500', async () => {
        const respuesta = await request(app).get('/clientes').query({ q: 'abc\u0000' });
        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual(['q']);
      });
    });

    describe('emails', () => {
      it('guarda el email principal recortado y en minúsculas', async () => {
        const respuesta = await crear(alta({ emailContacto: '  Admin@Ejemplo.EXAMPLE  ' }));
        expect(respuesta.status).toBe(201);
        expect((respuesta.body as { emailContacto: string }).emailContacto).toBe(
          'admin@ejemplo.example',
        );
      });

      it('rechaza emails adicionales repetidos (sin distinguir mayúsculas) con 400', async () => {
        const respuesta = await crear(
          alta({
            emailsAdicionales: ['Administracion@Empresa.example', 'administracion@empresa.example'],
          }),
        );
        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual([
          'emailsAdicionales.0',
          'emailsAdicionales.1',
        ]);
      });

      it('rechaza un adicional igual al email principal con 400', async () => {
        const respuesta = await crear(
          alta({
            emailContacto: 'admin@ejemplo.example',
            emailsAdicionales: ['ADMIN@ejemplo.example'],
          }),
        );
        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual(['emailsAdicionales.0']);
      });
    });

    describe('búsqueda `q`: % _ y \\ se buscan literalmente', () => {
      const nombres = {
        porcentaje: `${MARCA} Descuento 50% Anual`,
        sinPorcentaje: `${MARCA} Descuento 50 Anual`,
        guionBajo: `${MARCA} Plan_Basico`,
        sinGuionBajo: `${MARCA} PlanXBasico`,
        barra: `${MARCA} Ruta c:\\datos`,
        sinBarra: `${MARCA} Ruta c:datos`,
      };

      beforeAll(async () => {
        if (url === undefined) return;
        for (const razonSocial of Object.values(nombres)) {
          const respuesta = await crear(alta({ razonSocial }));
          expect(respuesta.status).toBe(201);
        }
      });

      const buscar = async (q: string) => {
        const respuesta = await request(app).get('/clientes').query({ q });
        expect(respuesta.status).toBe(200);
        return (respuesta.body as { razonSocial: string }[]).map((c) => c.razonSocial);
      };

      it('q="%" solo encuentra nombres que contienen el carácter %', async () => {
        const encontrados = await buscar('%');
        expect(encontrados).toContain(nombres.porcentaje);
        expect(encontrados).not.toContain(nombres.sinPorcentaje);
        expect(encontrados.every((nombre) => nombre.includes('%'))).toBe(true);
      });

      it('q="50%" no se interpreta como patrón', async () => {
        expect(await buscar(`${MARCA} Descuento 50%`)).toEqual([nombres.porcentaje]);
      });

      it('q="_" solo encuentra nombres que contienen el carácter _', async () => {
        const encontrados = await buscar('_');
        expect(encontrados).toContain(nombres.guionBajo);
        expect(encontrados).not.toContain(nombres.sinGuionBajo);
        expect(encontrados.every((nombre) => nombre.includes('_'))).toBe(true);
      });

      it('q="Plan_B" no usa _ como comodín', async () => {
        expect(await buscar('Plan_B')).toEqual([nombres.guionBajo]);
      });

      it('q con barra invertida la busca literalmente', async () => {
        expect(await buscar('c:\\d')).toEqual([nombres.barra]);
        expect(await buscar('\\')).toContain(nombres.barra);
      });

      it('sigue sin distinguir mayúsculas', async () => {
        expect(await buscar(`${MARCA.toLowerCase()} plan_basico`)).toEqual([nombres.guionBajo]);
      });
    });

    describe('emails en una edición parcial: la regla rige sobre el estado resultante', () => {
      const principal = `principal.${MARCA.toLowerCase()}@empresa.example`;
      const secundario = `secundario.${MARCA.toLowerCase()}@empresa.example`;
      const otro = `otro.${MARCA.toLowerCase()}@empresa.example`;

      /** Un cliente nuevo con `principal` y `[secundario]` ya guardados. */
      async function clienteConEmails(): Promise<string> {
        const creado = await crear(
          alta({ emailContacto: principal, emailsAdicionales: [secundario] }),
        );
        expect(creado.status).toBe(201);
        return (creado.body as { id: string }).id;
      }

      const guardado = async (id: string) =>
        prisma.cliente.findUniqueOrThrow({
          where: { id },
          select: { emailContacto: true, emailsAdicionales: true, updatedAt: true },
        });

      it('A: PATCH emailContacto = un adicional guardado → 400 y no modifica la fila', async () => {
        const id = await clienteConEmails();
        const antes = await guardado(id);

        const respuesta = await request(app)
          .patch(`/clientes/${id}`)
          .send({ emailContacto: secundario });

        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual(['emailContacto']);
        expect(await guardado(id)).toEqual(antes);
      });

      it('A (mayúsculas y espacios): se compara normalizado', async () => {
        const id = await clienteConEmails();
        const antes = await guardado(id);

        const respuesta = await request(app)
          .patch(`/clientes/${id}`)
          .send({ emailContacto: `  ${secundario.toUpperCase()} ` });

        expect(respuesta.status).toBe(400);
        expect(await guardado(id)).toEqual(antes);
      });

      it('B: PATCH emailsAdicionales = [el principal guardado] → 400 y no modifica la fila', async () => {
        const id = await clienteConEmails();
        const antes = await guardado(id);

        const respuesta = await request(app)
          .patch(`/clientes/${id}`)
          .send({ emailsAdicionales: [principal] });

        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual(['emailsAdicionales.0']);
        expect(await guardado(id)).toEqual(antes);
      });

      it('B (mayúsculas): se compara normalizado', async () => {
        const id = await clienteConEmails();
        const respuesta = await request(app)
          .patch(`/clientes/${id}`)
          .send({ emailsAdicionales: [otro, principal.toUpperCase()] });

        expect(respuesta.status).toBe(400);
        expect(camposInvalidos(respuesta.body)).toEqual(['emailsAdicionales.1']);
      });

      it('cambiar solo el principal a un email libre es válido y conserva los adicionales', async () => {
        const id = await clienteConEmails();

        const respuesta = await request(app).patch(`/clientes/${id}`).send({ emailContacto: otro });

        expect(respuesta.status).toBe(200);
        expect(await guardado(id)).toMatchObject({
          emailContacto: otro,
          emailsAdicionales: [secundario],
        });
      });

      it('cambiar solo los adicionales (sin el principal) es válido y conserva el principal', async () => {
        const id = await clienteConEmails();

        const respuesta = await request(app)
          .patch(`/clientes/${id}`)
          .send({ emailsAdicionales: [otro, secundario] });

        expect(respuesta.status).toBe(200);
        expect(await guardado(id)).toMatchObject({
          emailContacto: principal,
          emailsAdicionales: [otro, secundario],
        });
      });

      it('mover un email: el principal pasa a adicional y otro pasa a principal, en el mismo pedido', async () => {
        const id = await clienteConEmails();

        const respuesta = await request(app)
          .patch(`/clientes/${id}`)
          .send({ emailContacto: secundario, emailsAdicionales: [principal] });

        expect(respuesta.status).toBe(200);
        expect(await guardado(id)).toMatchObject({
          emailContacto: secundario,
          emailsAdicionales: [principal],
        });
      });

      it('enviar el mismo principal que ya tiene es válido', async () => {
        const id = await clienteConEmails();
        const respuesta = await request(app)
          .patch(`/clientes/${id}`)
          .send({ emailContacto: principal });
        expect(respuesta.status).toBe(200);
      });

      it('un dato anterior a la regla no bloquea editar otros campos', async () => {
        const creado = await crear(alta());
        const { id } = creado.body as { id: string };
        // Estado heredado que la regla ya no deja crear: un adicional repetido y otro igual al principal.
        await prisma.cliente.update({
          where: { id },
          data: { emailContacto: principal, emailsAdicionales: [principal, otro, otro] },
        });

        const otroCampo = await request(app)
          .patch(`/clientes/${id}`)
          .send({ telefono: '351 4000000' });
        expect(otroCampo.status).toBe(200);

        // Cambiar solo el principal se compara con los adicionales guardados, no entre ellos.
        const nuevoPrincipal = await request(app)
          .patch(`/clientes/${id}`)
          .send({ emailContacto: `nuevo.${MARCA.toLowerCase()}@empresa.example` });
        expect(nuevoPrincipal.status).toBe(200);
      });
    });

    describe('límite de `q`', () => {
      it('acepta 150 caracteres y rechaza 151 con 400', async () => {
        const bien = await request(app)
          .get('/clientes')
          .query({ q: 'a'.repeat(150) });
        expect(bien.status).toBe(200);
        const mal = await request(app)
          .get('/clientes')
          .query({ q: 'a'.repeat(151) });
        expect(mal.status).toBe(400);
        expect(camposInvalidos(mal.body)).toEqual(['q']);
      });
    });

    describe('pedidos malformados', () => {
      it('un id con porcentaje mal formado en la ruta es 400, no 500', async () => {
        const respuesta = await request(app).get('/clientes/%E0%A4%A/contactos');
        expect(respuesta.status).toBeLessThan(500);
      });
    });
  },
);
