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
- Avisos abiertos, evaluados y aceptados por ahora (`pnpm audit --prod`, revisado el 18/11/2026 en el cierre de la Épica 4):
  - `zod@3.25.76`, [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (alta, CVE-2023-54404). Validar un array con muchos elementos inválidos acumula un error por elemento, sin límite, y puede agotar la memoria.
    - **Corrección:** afecta a toda versión anterior a 4.6.6, que es la que lo corrige. No hay parche en Zod 3: corregirlo exige migrar de versión mayor (`shared`, backend y frontend), lo que queda pendiente.
    - **Alcance en el proyecto:** los arrays de entrada con `.max()` son `itemIds` al aplicar documentos y al preparar el envío, los ids de rendiciones al propagar el canal, los emails adicionales y los días aproximados. Sin tope quedan `clientes` de la carga masiva (HU2.3) y `contactos` (HU1).
    - **Peor caso medido:** el límite de 100 KB del cuerpo JSON acota cada pedido. El peor caso es un PUT de contactos con unos 34 000 elementos `{}`: 102 384 errores, unos 87 MiB de memoria transitoria y 360 ms de CPU. Exige una sesión que pueda escribir; `CONSULTA` se rechaza antes de leer el cuerpo. Varios pedidos así a la vez podrían agotar la memoria de un servicio chico (Railway Free: 512 MB).
    - **Mitigación sin migrar:** en Zod 3, `.max()` **no** corta la validación: los elementos se validan igual (medido: 68 001 errores con `.max(100)`). Lo que la corta es una primera etapa que solo cuenta, `z.array(z.unknown()).max(N).pipe(z.array(Esquema))`: 1 error y 5 ms. Requiere que el negocio defina un máximo de contactos y de clientes por carga masiva. Hoy no existe a propósito.
  - **Resuelto en el cierre de la Épica 4:** `qs`, [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) (moderada, CVE-2026-110816). Solo afectaba a `qs.stringify` con `arrayFormat: 'comma'`, que el backend no usa: Express 5 solo parsea, y con su analizador `simple` por defecto. `express@5.2.1` (`qs: ^6.14.0`) y `superagent` resuelven ahora `qs@6.17.1`, la versión corregida que ya usaba `body-parser`. Fue un cambio en el lockfile, sin override.

## Entornos

- Los entornos desplegados usan HTTPS.
- La configuración y los secretos se separan por entorno (desarrollo, prueba, producción) y no se comparten entre ellos.

## Decisiones y configuraciones pendientes

Se mantienen abiertas y no se resuelven en este documento:

- período y política de retención documental (decisión de negocio a validar con el cliente);
- estrategia de backups;
- estrategia concreta de auditoría;
- mecanismo de autenticación: propuesta en [ADR-0006](../adr/0006-autenticacion-y-control-de-acceso.md) (`Proposed`). Los roles (`ADMINISTRADOR`, `ADMINISTRATIVO`, `CONSULTA`) y su alcance están aprobados en la [matriz de permisos](matriz-permisos.md). Hasta que la autenticación esté implementada y verificada, no se cargan datos ni documentos reales en producción;
- almacenamiento de archivos;
- proveedores de infraestructura;
- configuración en GitHub de secret scanning, push protection y reglas de protección de ramas: verificar y dejar constancia cuando se confirmen;
- hardening HTTP: las cabeceras de seguridad de la API y del frontend están implementadas ([deployment.md](../deployment.md#cabeceras-de-seguridad)), igual que la limitación de intentos del login y la protección CSRF (ADR-0006). Quedan pendientes la CSP del frontend y la verificación de las cabeceras efectivas en producción.
