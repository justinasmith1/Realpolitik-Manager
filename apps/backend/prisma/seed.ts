/* eslint-disable no-console -- Script de línea de comandos: informar el progreso por consola es
   su salida esperada (no es código de la aplicación). */
import { PrismaClient, Sector, SubtipoPublico, IvaCondicion, ClienteEstado } from '@prisma/client';

import { verificarSeedPermitido } from '../src/lib/seed-guard';

const prisma = new PrismaClient();

async function main() {
  // Primero la guarda, antes de cualquier operación sobre la base: este seed borra clientes.
  verificarSeedPermitido();

  console.log('🌱 Seeding database...');

  // DESTRUCTIVO: borra todos los clientes (y sus contactos, en cascada) antes de cargar los
  // de ejemplo. Solo para una base de desarrollo local.
  await prisma.cliente.deleteMany();

  await prisma.cliente.createMany({
    data: [
      // ── SECTOR PÚBLICO ────────────────────────────────────────────────────

      // 1. Municipal — ACTIVO
      {
        razonSocial: 'Municipalidad de Córdoba',
        denominacion: 'Muni Córdoba',
        cuit: '30-99887766-7',
        ivaCondicion: IvaCondicion.EXENTO,
        emailContacto: 'proveedores@cordoba.gob.ar',
        sector: Sector.PUBLICO,
        subtipo: SubtipoPublico.MUNICIPAL,
        estado: ClienteEstado.ACTIVO,
      },

      // 2. Provincial/Organismo — ACTIVO
      {
        razonSocial: 'Ministerio de Salud de la Provincia de Buenos Aires',
        denominacion: 'Min. Salud GBA',
        cuit: '30-71234567-1',
        ivaCondicion: IvaCondicion.EXENTO,
        emailContacto: 'contrataciones@salud.gba.gob.ar',
        sector: Sector.PUBLICO,
        subtipo: SubtipoPublico.PROVINCIAL_ORGANISMO,
        estado: ClienteEstado.ACTIVO,
      },

      // 3. Sindical/Obra Social — ACTIVO
      {
        razonSocial: 'Sindicato de Trabajadores Municipales de Córdoba',
        denominacion: 'STM Córdoba',
        cuit: '30-55443322-3',
        ivaCondicion: IvaCondicion.EXENTO,
        emailContacto: 'admin@stm.org.ar',
        telefono: '+54 11 4000-1234',
        sector: Sector.PUBLICO,
        subtipo: SubtipoPublico.SINDICAL_OBRA_SOCIAL,
        estado: ClienteEstado.ACTIVO,
      },

      // 4. Municipal — INACTIVO (cliente que dejó de operar)
      {
        razonSocial: 'Municipalidad de Villa María',
        denominacion: 'Muni Villa María',
        cuit: '30-66554433-4',
        ivaCondicion: IvaCondicion.EXENTO,
        emailContacto: 'licitaciones@villamaria.gob.ar',
        sector: Sector.PUBLICO,
        subtipo: SubtipoPublico.MUNICIPAL,
        estado: ClienteEstado.INACTIVO,
      },

      // 5. Provincial/Organismo — INACTIVO. SUSPENDIDO sigue reservado en el enum para el futuro,
      //    pero la UI actual no lo ofrece ni lo lista (ni en Activos ni en Inactivos): un cliente
      //    demo suspendido quedaría invisible.
      {
        razonSocial: 'Legislatura de la Ciudad Autónoma de Buenos Aires',
        denominacion: 'Legislatura CABA',
        cuit: '30-78901234-9',
        ivaCondicion: IvaCondicion.EXENTO,
        emailContacto: 'compras@legislatura.gob.ar',
        portalUrl: 'https://compras.legislatura.gob.ar',
        sector: Sector.PUBLICO,
        subtipo: SubtipoPublico.PROVINCIAL_ORGANISMO,
        estado: ClienteEstado.INACTIVO,
      },

      // 6. Sindical/Obra Social — baja lógica (isDeleted = true)
      {
        razonSocial: 'Obra Social del Personal de Correos y Telecomunicaciones',
        denominacion: 'OSPCA',
        cuit: '30-34567890-1',
        ivaCondicion: IvaCondicion.EXENTO,
        emailContacto: 'admin@ospca.org.ar',
        sector: Sector.PUBLICO,
        subtipo: SubtipoPublico.SINDICAL_OBRA_SOCIAL,
        estado: ClienteEstado.ACTIVO,
        isDeleted: true,
        deletedAt: new Date('2026-08-15T10:00:00Z'),
      },

      // ── SECTOR PRIVADO ────────────────────────────────────────────────────

      // 7. Privado — ACTIVO con portal y teléfono
      {
        razonSocial: 'Grupo Solano Comunicación S.A.',
        denominacion: 'Grupo Solano',
        cuit: '30-12345678-1',
        ivaCondicion: IvaCondicion.RESPONSABLE_INSCRIPTO,
        emailContacto: 'facturacion@gruposolano.com.ar',
        telefono: '+54 351 555-0001',
        portalUrl: 'https://proveedores.gruposolano.com.ar',
        sector: Sector.PRIVADO,
        estado: ClienteEstado.ACTIVO,
      },

      // 8. Privado — ACTIVO con emails adicionales
      {
        razonSocial: 'Medios del Interior S.R.L.',
        denominacion: 'Medios del Interior',
        cuit: '30-98765432-1',
        ivaCondicion: IvaCondicion.RESPONSABLE_INSCRIPTO,
        emailContacto: 'admin@mediodinterior.com.ar',
        emailsAdicionales: ['cuentas@mediodinterior.com.ar'],
        portalUrl: 'https://portal.mediodinterior.com.ar',
        sector: Sector.PRIVADO,
        estado: ClienteEstado.ACTIVO,
      },

      // 9. Privado — INACTIVO (monotributo, sin portal)
      {
        razonSocial: 'Productora Norte Grande',
        denominacion: 'Norte Grande',
        cuit: '20-44556677-3',
        ivaCondicion: IvaCondicion.MONOTRIBUTO,
        emailContacto: 'contacto@nortegrande.com.ar',
        sector: Sector.PRIVADO,
        estado: ClienteEstado.INACTIVO,
      },

      // 10. Privado — baja lógica (isDeleted = true)
      {
        razonSocial: 'Señal Regional Patagonia S.A.',
        denominacion: 'Patagonia TV',
        cuit: '30-22334455-7',
        ivaCondicion: IvaCondicion.RESPONSABLE_INSCRIPTO,
        emailContacto: 'legal@patagonia-tv.com.ar',
        sector: Sector.PRIVADO,
        estado: ClienteEstado.ACTIVO,
        isDeleted: true,
        deletedAt: new Date('2026-09-01T08:30:00Z'),
      },
    ],
  });

  const count = await prisma.cliente.count();
  console.log(`✅ Seed completado: ${count} clientes insertados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
