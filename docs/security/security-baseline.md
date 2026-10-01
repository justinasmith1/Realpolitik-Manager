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
- configuración en GitHub de secret scanning, push protection y reglas de protección de ramas: verificar y dejar constancia cuando se confirmen.
