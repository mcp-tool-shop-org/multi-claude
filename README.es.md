<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/multi-claude/readme.png" width="400" alt="Multi-Claude" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/actions"><img src="https://github.com/mcp-tool-shop-org/multi-claude/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/multi-claude/"><img src="https://img.shields.io/badge/docs-landing%20page-blue" alt="Landing Page" /></a>
</p>

Sistema de compilación paralelo basado en "lanes" para [Claude Code](https://claude.ai/).  Coordina múltiples sesiones de Claude que trabajan en la misma base de código, gestionando la resolución de dependencias, la propiedad de los archivos, la intervención del operador y la transferencia de información con evidencia.

## ¿Qué hace?

Multi-Claude transforma una tarea grande en un **grafo de paquetes** — unidades de trabajo pequeñas e independientes que se pueden asignar, con una propiedad de archivo explícita y dependencias definidas. Múltiples sesiones de Claude Code ejecutan estos paquetes en paralelo, mientras que un operador observa, interviene y aprueba a través de una interfaz de control unificada.

**El ciclo del operador:**

1. **Planificación** — Evaluar la idoneidad, generar el esquema, fijar el contrato.
2. **Ejecución** — Los trabajadores asignan paquetes, producen artefactos, verifican la salida.
3. **Observación** — La consola de 5 paneles muestra el estado de la ejecución, los "hooks" (conexiones) y la idoneidad.
4. **Intervención** — Detener ejecuciones, reintentar paquetes, resolver "hooks", aprobar etapas.
5. **Recuperación** — Flujos de recuperación guiados para 8 escenarios de fallo.
6. **Cierre** — Derivación del resultado, transferencia de evidencia, promoción/aprobación.

## Instalación

```bash
npm install -g @multi-claude/cli
```

Requiere Node.js 20+ y la CLI de [Claude Code](https://claude.ai/) instalada.

## Inicio rápido

```bash
# Assess whether a task fits multi-claude
multi-claude plan evaluate --work-class backend_law --packets 6 --coupling low

# Initialize a blueprint from a template
multi-claude blueprint init --template backend_law

# Validate and freeze the blueprint
multi-claude blueprint validate
multi-claude blueprint freeze

# Start a run
multi-claude run

# Watch execution in real-time
multi-claude console watch

# Check what to do next
multi-claude console next

# Generate handoff evidence when done
multi-claude console handoff

# Export for review
multi-claude console export handoff --format markdown
```

## Comandos

### Núcleo

| Comando | Descripción |
|---------|-------------|
| `multi-claude plan evaluate` | Evalúa la idoneidad a partir de la clase de trabajo, el número de paquetes y el acoplamiento. |
| `multi-claude blueprint init` | Genera un grafo de paquetes a partir de una plantilla. |
| `multi-claude blueprint validate` | Verifica la legalidad (superposición de archivos, dependencias, etapas). |
| `multi-claude blueprint freeze` | Hash SHA-256, inmutable después de fijar. |
| `multi-claude run` | Inicia la ejecución. |
| `multi-claude resume` | Reanuda una ejecución detenida. |
| `multi-claude stop` | Detiene una ejecución. |
| `multi-claude status` | Muestra el estado de la ejecución. |

### Consola (18 subcomandos)

| Comando | Descripción |
|---------|-------------|
| `console show` | Consola completa de 5 paneles para el operador. |
| `console overview` | Resumen de la ejecución. |
| `console packets` | Estados y progreso de los paquetes. |
| `console workers` | Sesiones de los trabajadores. |
| `console hooks` | Flujo de decisiones de los "hooks". |
| `console fitness` | Puntuaciones de madurez de la ejecución/paquete. |
| `console next` | Próxima acción legal (prioridad de 10 niveles). |
| `console watch` | Actualización automática cada 2 segundos. |
| `console actions` | Acciones disponibles para el operador. |
| `console act` | Ejecuta una acción del operador. |
| `console audit` | Registro de auditoría. |
| `console recover` | Flujos de recuperación guiados. |
| `console outcome` | Derivación del resultado de la ejecución. |
| `console handoff` | Resumen de la transferencia de evidencia. |
| `console promote-check` | Elegibilidad para la promoción. |
| `console approve` | Registro de aprobación. |
| `console reject` | Registro de rechazo. |
| `console approval` | Estado de aprobación. |
| `console export` | Exporta la transferencia/aprobación/etapa como Markdown o JSON. |

### Monitor (Interfaz de control)

```bash
multi-claude monitor --port 3100
```

Abre un panel de control para el operador basado en React en `http://localhost:3100` con:
- **Descripción general** — estado del sistema, utilización de los "lanes", pruebas activas.
- **Cola** — lista de elementos ordenables con acciones integradas.
- **Detalle del elemento** — banner de situación (estado/riesgo/próximo paso), área de trabajo para la toma de decisiones, evidencia plegable.
- **Estado del "lane"** — métricas por "lane", intervenciones, entradas de políticas.
- **Actividad** — línea de tiempo de eventos en tiempo real.

## Arquitectura

```
┌─────────────────────────────────────────────────┐
│                   CLI (Commander)                │
├─────────────────────────────────────────────────┤
│  Planner    │  Console     │  Monitor (Express)  │
│  - rules    │  - run-model │  - queries          │
│  - blueprint│  - hook-feed │  - commands          │
│  - freeze   │  - fitness   │  - policies          │
│  - templates│  - next-act  │  - React UI          │
├─────────────────────────────────────────────────┤
│             Handoff Spine (12 Laws)             │
│  Execution → Transfer → Decision → Triage →     │
│  Supervision → Routing → Flow → Intervention →  │
│  Governance → Outcome → Calibration → Promotion │
├─────────────────────────────────────────────────┤
│          SQLite Execution Database              │
│        (19+ tables, local .multi-claude/)       │
├─────────────────────────────────────────────────┤
│         Claude Agent SDK (worker sessions)       │
└─────────────────────────────────────────────────┘
```

## Cuándo usar Multi-Claude

Multi-Claude funciona mejor cuando **el número de paquetes es lo suficientemente alto para amortizar la sobrecarga de coordinación** y **la propiedad de los archivos es lo suficientemente clara para mantener la reconciliación semántica dentro de límites aceptables.**

| Clase de trabajo | Idoneidad | Punto de equilibrio |
|------------|-----|------------|
| Backend/estado/dominio | Fuerte | ~3 paquetes |
| UI/interacción/carga pesada | Moderado | ~5 paquetes |
| Infraestructura/plano de control | Moderado | ~5-6 paquetes |

**Úselo cuando:** 5+ paquetes, propiedad de archivos clara, estructura de ondas natural, la verificación independiente es importante.

**Utilice una sola instancia de Claude cuando:** Arquitectura inestable o en desarrollo, 2 o menos paquetes, ruta crítica principalmente secuencial, el operador se convertiría en un cuello de botella.

Consulte [WHEN-TO-USE-MULTI-CLAUDE.md](WHEN-TO-USE-MULTI-CLAUDE.md) para obtener la guía completa de toma de decisiones, con evidencia de pruebas evaluadas.

## Seguridad

Multi-Claude es una **herramienta de línea de comandos que solo funciona localmente**. Orquesta sesiones de Claude Code en una sola máquina de desarrollo.

- **Accede a:** Sistema de archivos local (directorio de trabajo + `.multi-claude/`), base de datos SQLite, subprocesos de Claude Code, localhost (solo para monitoreo).
- **No accede a:** APIs en la nube directamente, no recopila datos de telemetría, no almacena credenciales, no tiene salida de red más allá de localhost.
- **Permisos:** Las operaciones con archivos están restringidas al directorio del proyecto, el monitoreo se limita a localhost, las políticas de "hooks" ejecutan solo comandos de la línea de comandos existentes, las acciones del operador se realizan a través de módulos de cumplimiento normativo.

Consulte [SECURITY.md](SECURITY.md) para obtener la política de seguridad completa y el procedimiento de notificación de vulnerabilidades.

## Pruebas

```bash
npm test          # 1600+ tests via Vitest
npm run typecheck # TypeScript strict mode
npm run verify    # typecheck + test + build
```

## Plataformas

- **Sistema operativo:** Windows, macOS, Linux
- **Entorno de ejecución:** Node.js 20+
- **Dependencias:** Claude Code CLI, better-sqlite3, Commander, Express

## Licencia

[MIT](LICENSE)

---

Desarrollado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
