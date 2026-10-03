# ADR-0002 — Estrategia de Modelado de Datos para Clientes

## Estado

Proposed

## Fecha

2026-10-02

## Contexto

Para iniciar el desarrollo del backend (T0.2), es necesario definir el esquema fundacional de la tabla de clientes en PostgreSQL. Las decisiones deben contemplar la seguridad de los datos fiscales, la necesidad de preservar el histórico de las rendiciones mensuales y las reglas de categorización de cuentas que utiliza Realpolitik en su operativa diaria.

## Decisión

Se implementa el siguiente modelo arquitectónico para la base de datos:  

1. **Claves Primarias**: Se utilizarán identificadores únicos universales (UUID) en lugar de enteros.
2. **Categorización**: El Sector y Subtipo se modelarán temporalmente como datos de tipo ENUM nativos de la base de datos.
3. **Eliminación de registros y Estados**: Se separa el estado comercial de la auditoría de eliminación. Se utilizará un campo activo: Boolean (por defecto true) para indicar si el cliente opera actualmente con la agencia. Para la eliminación de registros, se establece la "baja lógica" mediante dos campos: un flag booleano `isDeleted: Boolean` (por defecto false) y un timestamp `deletedAt: DateTime` (nulo por defecto) que registrará el momento exacto de la baja.
4. **Auditoría básica**: Todos los modelos de negocio heredarán campos de trazabilidad temporal (`createdAt` y `updatedAt`).

## Alternativas consideradas

- **IDs Autoincrementales**: Se evaluó su uso por ser más fáciles de debugear, pero fueron descartados para evitar vulnerabilidades (enumeración y exposición del volumen de clientes) y facilitar la migración futura sin conflictos de secuencias entre entornos DEV/PROD. 
- **Tablas relacionales para Sector/Subtipo**: Como punto de discusión fuerte, se consideró crear tablas independientes para permitir la autogestión de nuevas categorías desde el sistema. Se optó por los ENUMs porque la clasificación institucional del negocio de Realpolitik lleva mucho tiempo establecida y no requiere cambios dinámicos frecuentes; se priorizó la velocidad de consulta y simplicidad para el MVP.  

## Consecuencias

- **Positivas**: Mayor seguridad (IDs impenetrables), garantía de que las facturas y rendiciones históricas no quedarán huérfanas al dar de baja un cliente, e historial de creación/modificación automático.   
- **A resolver**: Obliga al equipo de backend a estandarizar el uso de cláusulas `{ activo: true }` en todos los repositorios de consulta para no retornar entidades eliminadas lógicamente. 
