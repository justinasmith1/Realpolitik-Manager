# Baseline de seguridad

Reglas mínimas desde el inicio del proyecto. Es un punto de partida pragmático: se amplía a medida que existan componentes concretos (autenticación, almacenamiento, despliegue).

## El repositorio es público

Todo lo que se versiona es visible para cualquiera, incluido el historial. Por eso:

- nunca se commitean secretos (contraseñas, tokens, claves de API, certificados);
- los archivos `.env` reales nunca se versionan; cuando aparezcan variables de entorno se documentarán mediante un `.env.example` sin valores reales;
- no se usa información real de clientes en fixtures, seeds, ejemplos, capturas ni tests;
- si un secreto se commitea por error, se considera comprometido: debe rotarse, y no alcanza con borrarlo en un commit posterior.

## Datos

- Se protegen los datos personales, la información fiscal y la información confidencial o de acceso restringido.
- Esos datos no deben aparecer en logs ni en mensajes de error expuestos.
- Se recolecta y se guarda solo lo necesario para la función que se implementa.

## Desarrollo seguro

- Toda entrada externa se valida en los límites del sistema.
- La validación del frontend mejora la experiencia de uso, pero **no reemplaza** la validación en el backend.
- La autenticación y la autorización futuras se resuelven del lado servidor; nunca se confía en lo que informa el cliente.
- Principio de mínimo privilegio para usuarios, roles, credenciales y accesos.
- Las subidas de archivos futuras deberán controlar tipo, tamaño, autorización y lugar de almacenamiento.
- Dependencias: toda dependencia nueva debe estar justificada y revisada. El lockfile (`pnpm-lock.yaml`) está versionado y se instala con `--frozen-lockfile`.
- Override de seguridad (`pnpm.overrides` en el `package.json` raíz): `body-parser@>=2.0.0 <2.4.0` se fuerza a `>=2.4.0 <3` por [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) (DoS con un cuerpo comprimido). Lo trae `express@5.2.1` (`^2.2.1`) y `pnpm update` no lo actualiza solo. Se quita cuando la versión de Express que use el backend ya resuelva `body-parser >= 2.4.0` por sí misma.
- Avisos abiertos, evaluados y aceptados por ahora (`pnpm audit --prod`, revisado el 29/10/2026 al cerrar HU2.8):
  - `zod@3.25.76`, [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (alta): validar un array **sin tope de largo** con muchos elementos inválidos acumula errores sin límite y puede agotar la memoria. Se corrige en `zod >= 4.6.6` (migración mayor, pendiente). Los arrays de entrada de HU2.8 (`itemIds` al aplicar y al preparar el envío) tienen `.max()`. Sin tope quedan `clientes` de la carga masiva (HU2.3) y `contactos` (HU1), acotados en la práctica por el límite de 100 KB del cuerpo JSON. Al migrar a Zod 4, o antes si se toca alguno de esos schemas, se les agrega un `.max()`.
  - `qs@6.16.0`, [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) (moderada): solo afecta a `qs.stringify` con `arrayFormat: 'comma'`. Lo trae `express@5.2.1` directo; el backend no usa `qs.stringify` (Express solo parsea). Se resuelve cuando Express dependa de `qs >= 6.16.1`.

## Entornos

- Los entornos desplegados usan HTTPS.
- La configuración y los secretos se separan por entorno (desarrollo, prueba, producción) y no se comparten entre ellos.

## Decisiones y configuraciones pendientes

Se mantienen abiertas y no se resuelven en este documento:

- período y política de retención documental (decisión de negocio a validar con el cliente);
- estrategia de backups;
- estrategia concreta de auditoría;
- mecanismo de autenticación;
- almacenamiento de archivos;
- proveedores de infraestructura;
- configuración en GitHub de secret scanning, push protection y reglas de protección de ramas: verificar y dejar constancia cuando se confirmen;
- hardening HTTP del backend: headers de seguridad (Helmet o equivalente, con CSP definida junto al frontend) y rate limiting. Hoy la API no tiene autenticación, `x-powered-by` está deshabilitado, CORS es una lista explícita y el cuerpo JSON está limitado a 100 KB (`413 PAYLOAD_TOO_LARGE`); se suma cuando haya autenticación y un entorno desplegado que lo justifique.
