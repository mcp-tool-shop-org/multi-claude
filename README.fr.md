<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/multi-claude/readme.png" width="400" alt="Multi-Claude" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/actions"><img src="https://github.com/mcp-tool-shop-org/multi-claude/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/multi-claude/"><img src="https://img.shields.io/badge/docs-landing%20page-blue" alt="Landing Page" /></a>
</p>

Système de construction parallèle basé sur des "lignes" pour [Claude Code](https://claude.ai/). Il orchestre plusieurs sessions Claude travaillant sur la même base de code, avec résolution des dépendances, gestion des droits de propriété des fichiers, intervention de l'opérateur et transmission des informations avec preuves.

## Fonctionnalités

Multi-Claude transforme une tâche importante en un **graphe de paquets** : des unités de travail petites et indépendantes, avec des droits de propriété de fichiers explicites et des dépendances clairement définies. Plusieurs sessions Claude Code exécutent ces paquets en parallèle, tandis qu'un opérateur observe, intervient et approuve via une interface de contrôle unifiée.

**Le cycle de l'opérateur :**

1. **Planification** — Évaluation de l'adéquation, génération du plan, fixation du contrat.
2. **Exécution** — Les agents (workers) réclament les paquets, produisent des résultats, vérifient la sortie.
3. **Observation** — Console en cinq panneaux affichant l'état de l'exécution, les points de contrôle (hooks), l'adéquation.
4. **Intervention** — Arrêt des exécutions, relance des paquets, résolution des points de contrôle, validation des étapes.
5. **Récupération** — Procédures de récupération guidées pour 8 scénarios de défaillance.
6. **Clôture** — Dérivation des résultats, transmission des preuves, promotion/validation.

## Installation

```bash
npm install -g @multi-claude/cli
```

Nécessite Node.js 20+ et l'interface de ligne de commande (CLI) de [Claude Code](https://claude.ai/) installée.

## Démarrage rapide

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

## Commandes

### Fonctionnalités de base

| Commande | Description |
|---------|-------------|
| `multi-claude plan evaluate` | Évaluation de l'adéquation à partir de la classe de travail, du nombre de paquets, du couplage. |
| `multi-claude blueprint init` | Génération du graphe de paquets à partir d'un modèle. |
| `multi-claude blueprint validate` | Vérification de la validité (chevauchement des fichiers, dépendances, étapes). |
| `multi-claude blueprint freeze` | Calcul de la somme de contrôle SHA-256, immuable après la fixation. |
| `multi-claude run` | Démarrage de l'exécution. |
| `multi-claude resume` | Reprise d'une exécution interrompue. |
| `multi-claude stop` | Arrêt d'une exécution. |
| `multi-claude status` | Affichage de l'état de l'exécution. |

### Console (18 sous-commandes)

| Commande | Description |
|---------|-------------|
| `console show` | Console complète en cinq panneaux pour l'opérateur. |
| `console overview` | Résumé de l'exécution. |
| `console packets` | États et progression des paquets. |
| `console workers` | Sessions des agents (workers). |
| `console hooks` | Flux de décisions des points de contrôle. |
| `console fitness` | Scores de maturation des exécutions/paquets. |
| `console next` | Prochaine action légale (priorité en 10 niveaux). |
| `console watch` | Actualisation automatique toutes les 2 secondes. |
| `console actions` | Actions disponibles pour l'opérateur. |
| `console act` | Exécution d'une action pour l'opérateur. |
| `console audit` | Journal des actions. |
| `console recover` | Procédures de récupération guidées. |
| `console outcome` | Dérivation des résultats de l'exécution. |
| `console handoff` | Résumé des preuves de transmission. |
| `console promote-check` | Éligibilité à la promotion. |
| `console approve` | Enregistrement de l'approbation. |
| `console reject` | Enregistrement du rejet. |
| `console approval` | Statut de l'approbation. |
| `console export` | Exportation des informations de transmission/approbation/étape sous forme de Markdown ou JSON. |

### Surveillance (Interface de contrôle)

```bash
multi-claude monitor --port 3100
```

Ouvre un tableau de bord pour l'opérateur basé sur React à l'adresse `http://localhost:3100`, avec :
- **Aperçu** — état du système, utilisation des "lignes", essais actifs.
- **File d'attente** — liste d'éléments triable avec actions intégrées.
- **Détails de l'élément** — bannière de situation (état/risque/prochaine étape), espace de travail de décision, preuve extensible.
- **État de la "ligne"** — métriques par "ligne", interventions, paramètres de stratégie.
- **Activité** — chronologie des événements en temps réel.

## Architecture

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

## Quand utiliser Multi-Claude

Multi-Claude est idéal lorsque **le nombre de paquets est suffisamment élevé pour compenser les coûts de coordination** et que **la gestion des droits de propriété des fichiers est suffisamment claire pour limiter la complexité de la réconciliation sémantique.**

| Classe de travail | Adéquation | Seuil de rentabilité |
|------------|-----|------------|
| Backend/état/domaine | Fort | ~3 paquets |
| Interface utilisateur/interaction/complexité importante | Modéré | ~5 paquets |
| Plan de contrôle/infrastructure | Modéré | ~5-6 paquets |

**Utilisez-le lorsque :** 5+ paquets, gestion claire des droits de propriété, structure de vagues naturelle, la vérification indépendante est importante.

**Utilisez une seule instance de Claude lorsque :** Architecture instable, 2 ou moins de paquets, chemin critique principalement séquentiel, l'opérateur deviendrait un goulot d'étranglement.

Consultez [WHEN-TO-USE-MULTI-CLAUDE.md](WHEN-TO-USE-MULTI-CLAUDE.md) pour obtenir la grille de décision complète, avec des exemples tirés de tests.

## Sécurité

Multi-Claude est un **outil en ligne de commande qui fonctionne uniquement localement**. Il gère les sessions de Claude Code sur une seule machine de développement.

- **Accède à :** Système de fichiers local (répertoire de travail + `.multi-claude/`), base de données SQLite, processus Claude Code, localhost (pour la surveillance uniquement).
- **N'accède PAS à :** Les API cloud directement, aucune télémétrie, aucun stockage de mots de passe, aucun trafic réseau sortant autre que vers localhost.
- **Permissions :** Les opérations sur les fichiers sont limitées au répertoire du projet, la surveillance est limitée à localhost, les politiques de hooks exécutent uniquement les commandes de la ligne de commande existantes, les actions de l'opérateur passent par des modules de conformité.

Consultez [SECURITY.md](SECURITY.md) pour la politique de sécurité complète et pour signaler les vulnérabilités.

## Tests

```bash
npm test          # 1600+ tests via Vitest
npm run typecheck # TypeScript strict mode
npm run verify    # typecheck + test + build
```

## Plateformes

- **Système d'exploitation :** Windows, macOS, Linux
- **Environnement d'exécution :** Node.js 20+
- **Dépendances :** Claude Code CLI, better-sqlite3, Commander, Express

## Licence

[MIT](LICENSE)

---

Développé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
