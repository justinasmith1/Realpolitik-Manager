
# Realpolitik Manager📊

> Sistema de gestión web — Monorepo con pnpm Workspaces + TypeScript end-to-end.

---

## 💡 Sobre el sistema (Contexto de Negocio)

**Realpolitik Manager** es una plataforma web centralizada diseñada para transformar el ciclo de rendición de pauta publicitaria de la agencia Realpolitik —pasando de un proceso artesanal y vulnerable en planillas dispersas a un flujo inteligente y automatizado para eliminar errores humanos, acelerar los cobros y liberar al equipo del cuello de botella operativo.

### 🎯 Visión y Propuesta
* **Automatización y Trazabilidad:** Automatiza la asociación de requisitos fiscales, el control de vencimientos y el despacho de legajos, garantizando trazabilidad total por cuenta y un histórico digital auditable con retención mínima de 5 años en la nube.
* **Control Documental:** Previene rechazos mensuales de organismos públicos mediante alertas tempranas de caducidad de constancias de ARCA (vencimientos mensuales/quincenales) e Ingresos Brutos.
* **Gestión Multicanal:** Agrupa los envíos por cliente (cuidando la privacidad al evitar correos masivos) y registra canales alternativos de entrega como portales web y WhatsApp.

---

## 📁 Estructura del proyecto

```
realpolitik-manager/
├── apps/
│   ├── backend/          # Servidor API (Node.js / Express — T0.2)
│   └── frontend/         # Aplicación cliente (React — T0.3)
├── packages/
│   └── shared/           # Tipos, utilidades y esquemas 
├── .eslintrc.cjs         # Configuración ESLint global
├── .gitignore
├── .prettierrc           # Configuración Prettier global
├── package.json          # Raíz del monorepo (private: true)
├── pnpm-workspace.yaml   # Declaración de workspaces
└── tsconfig.base.json    # Configuración TypeScript base
```

---

## 🚀 Inicio rápido

### Pre-requisitos

| Herramienta | Versión mínima |
|-------------|---------------|
| Node.js     | 20.x LTS      |
| pnpm        | 9.x           |

> Instala pnpm globalmente si aún no lo tienes: `npm install -g pnpm`

### Clonar e instalar

```bash
# 1. Clonar el repositorio
git clone https://github.com/<org>/realpolitik-manager.git
cd realpolitik-manager

# 2. Instalar TODAS las dependencias del monorepo con un solo comando
pnpm install

# 3. Verificar tipos en todos los paquetes
pnpm typecheck

# 4. Ejecutar linting global
pnpm lint
```

---

## 📐 Convenciones de Git

### 🌿 Ramas

| Patrón | Uso |
|--------|-----|
| `main` | Rama de producción protegida |
| `feature/HU-<id>-<descripcion>` | Nueva funcionalidad ligada a una Historia de Usuario |
| `fix/HU-<id>-<descripcion>` | Corrección de bug ligada a una HU |
| `chore/setup-<descripcion>` | Tareas de infraestructura, configuración o mantenimiento |
| `docs/<descripcion>` | Actualizaciones exclusivas de documentación |

**Ejemplos válidos:**
```
feature/HU-12-login-usuario
fix/HU-07-validacion-formulario
chore/setup-eslint-config
docs/actualizar-readme
```

### ✏️ Commits (Conventional Commits)

Sigue el estándar [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<alcance opcional>): <descripción en imperativo>
```

| Tipo | Cuándo usarlo |
|------|---------------|
| `feat` | Nueva funcionalidad visible para el usuario |
| `fix` | Corrección de un bug |
| `chore` | Tareas de mantenimiento, dependencias, CI/CD |
| `docs` | Cambios exclusivamente en documentación |
| `refactor` | Refactorización sin cambio de comportamiento |
| `test` | Agregar o modificar tests |
| `perf` | Mejoras de rendimiento |
| `ci` | Cambios en pipelines de CI/CD |

**Ejemplos válidos:**
```bash
feat(auth): agregar endpoint de login con JWT
fix(frontend): corregir validación del formulario de registro
chore(deps): actualizar typescript a 5.5.4
docs(readme): agregar sección de convenciones de commits
```

---

## 🔒 Protección de ramas

La rama `main` está **protegida** con las siguientes reglas obligatorias:

- ✅ **Pull Request requerido** — ningún commit puede hacerse directamente a `main`
- ✅ **Mínimo 1 aprobación** — al menos un reviewer debe aprobar antes de mergear
- ✅ **Checks de CI deben pasar** — lint, typecheck y tests deben estar en verde
- ✅ **Rama actualizada** — la rama de feature debe estar al día con `main` antes del merge
- ❌ **Force push deshabilitado** en `main`

> **Flujo recomendado:** `feature/<...>` → Pull Request → Code Review → Squash & Merge → `main`

---

## 🛠️ Scripts disponibles

```bash
pnpm lint          # Ejecuta ESLint en todo el monorepo
pnpm lint:fix      # Ejecuta ESLint con auto-fix
pnpm format        # Formatea todos los archivos con Prettier
pnpm format:check  # Verifica el formato sin modificar archivos
pnpm typecheck     # Comprobación de tipos TypeScript (sin emitir archivos)
```

---

## 📦 Workspace packages

| Package | Nombre interno | Descripción |
|---------|---------------|-------------|
| `apps/backend` | `@realpolitik/backend` | Servidor API REST |
| `apps/frontend` | `@realpolitik/frontend` | Aplicación React |
| `packages/shared` | `@realpolitik/shared` | Tipos y utilidades compartidas |

Para instalar una dependencia en un paquete específico:
```bash
pnpm --filter @realpolitik/backend add express
pnpm --filter @realpolitik/frontend add react react-dom
pnpm --filter @realpolitik/shared add zod
```

---

## 📄 Licencia

Privado — todos los derechos reservados.
