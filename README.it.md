<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/multi-claude/readme.png" width="400" alt="Multi-Claude" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/actions"><img src="https://github.com/mcp-tool-shop-org/multi-claude/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/multi-claude/"><img src="https://img.shields.io/badge/docs-landing%20page-blue" alt="Landing Page" /></a>
</p>

Un sistema di compilazione parallelo basato su "lane" per [Claude Code](https://claude.ai/). Questo sistema gestisce più sessioni di Claude che lavorano sullo stesso codice sorgente, gestendo la risoluzione delle dipendenze, la gestione dei permessi sui file, l'intervento degli operatori e il passaggio di consegne documentato.

## Cosa fa

Multi-Claude trasforma un'attività complessa in un **grafo di pacchetti**, ovvero in unità di lavoro piccole e indipendenti, con una chiara definizione della proprietà dei file e delle dipendenze. Diverse sessioni di Claude Code eseguono questi pacchetti in parallelo, mentre un operatore monitora, interviene e approva il processo tramite un'interfaccia di controllo centralizzata.

**Il ciclo dell'operatore:**

1. **Pianificazione** — Valutazione delle condizioni, creazione del progetto, finalizzazione del contratto.
2. **Esecuzione** — Gli operatori ricevono i pacchetti, producono i risultati, verificano l'output.
3. **Monitoraggio** — La console con cinque pannelli mostra lo stato dell'esecuzione, i collegamenti e le condizioni.
4. **Intervento** — Interruzione delle esecuzioni, riavvio dei pacchetti, risoluzione dei collegamenti, approvazione delle fasi.
5. **Ripristino** — Procedure guidate per il ripristino in caso di 8 scenari di errore.
6. **Chiusura** — Derivazione dei risultati, trasmissione delle prove, promozione/approvazione.

## Installa

```bash
npm install -g @multi-claude/cli
```

Richiede Node.js 20 o superiore e l'interfaccia a riga di comando (CLI) di [Claude Code](https://claude.ai/) installata.

## Guida rapida

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

## Comandi

### Nucleo

| Comando. | Descrizione. |
|---------|-------------|
| `multi-claude plan evaluate` | Valutare l'idoneità in base alla classe di lavoro, al numero di pacchetti e al grado di accoppiamento. |
| `multi-claude blueprint init` | Genera il grafo dei pacchetti a partire da un modello. |
| `multi-claude blueprint validate` | Verificare la conformità (sovrapposizioni di file, dipendenze, controlli). |
| `multi-claude blueprint freeze` | Hash SHA-256, immutabile dopo la fase di "congelamento". |
| `multi-claude run` | Avvia l'esecuzione. |
| `multi-claude resume` | Riprendere un'esecuzione interrotta. |
| `multi-claude stop` | Interrompere un processo. |
| `multi-claude status` | Mostra lo stato di esecuzione. |

### Console (18 sottocomandi)

| Comando. | Descrizione. |
|---------|-------------|
| `console show` | Console operativa completa con 5 pannelli. |
| `console overview` | Riepilogo della corsa. |
| `console packets` | Stato e avanzamento dei pacchetti. |
| `console workers` | Sessioni di formazione per i dipendenti. |
| `console hooks` | Feed di decisioni relative a "hook". |
| `console fitness` | Punteggi di maturazione della corsa/del pacchetto. |
| `console next` | Prossima azione legale consentita (priorità: 10 livelli). |
| `console watch` | Aggiornamento automatico ogni 2 secondi. |
| `console actions` | Azioni disponibili per l'operatore. |
| `console act` | Eseguire un'azione dell'operatore. |
| `console audit` | Registro delle attività. |
| `console recover` | Flussi di ripristino guidati. |
| `console outcome` | Derivazione dei risultati di esecuzione. |
| `console handoff` | Breve riepilogo delle informazioni da trasferire. |
| `console promote-check` | Requisiti per l'ammissibilità alla promozione. |
| `console approve` | Approvazione della registrazione. |
| `console reject` | Rifiuto di una registrazione. |
| `console approval` | Stato di approvazione. |
| `console export` | Esportazione delle informazioni relative alla revisione, all'approvazione o alla fase di controllo finale in formato Markdown o JSON. |

### Monitor (Interfaccia utente del piano di controllo)

```bash
multi-claude monitor --port 3100
```

Apre una dashboard per operatori basata su React all'indirizzo `http://localhost:3100`, che include:
- **Panoramica** — stato del sistema, utilizzo delle risorse, trial attivi.
- **Coda** — elenco di elementi ordinabile con azioni integrate.
- **Dettagli elemento** — banner con informazioni sulla situazione (stato/rischio/prossima azione), area di lavoro per le decisioni, documentazione espandibile.
- **Stato delle risorse** — metriche per singola risorsa, interventi, parametri di configurazione.
- **Attività** — cronologia degli eventi in tempo reale.

## Architettura

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

## Quando utilizzare Multi-Claude

Multi-Claude funziona al meglio quando **il numero di pacchetti è sufficientemente elevato da compensare i costi di coordinamento** e **la gestione dei file è chiara a sufficienza per mantenere la riconciliazione semantica entro limiti accettabili.**

| Classe di lavoro. | Adatto. | Punto di pareggio. |
|------------|-----|------------|
| Backend/stato/dominio. | Forte. | Circa 3 confezioni. |
| Interfaccia utente/interazione/enfasi sulle transizioni e sui dettagli. | Moderato. | Circa 5 confezioni. |
| Piano di controllo/infrastruttura. | Moderato. | Circa 5-6 confezioni. |

**Utilizzarlo quando:** si dispone di più di 5 pacchetti, è necessario definire chiaramente la proprietà dei file, si desidera preservare la struttura a onde naturale e si richiedono verifiche indipendenti.

**Non utilizzare Claude in queste situazioni:** Architettura instabile o complessa, un numero di pacchetti pari o inferiore a 2, percorso critico prevalentemente sequenziale, in cui l'operatore potrebbe diventare un collo di bottiglia.

Consultare il file [WHEN-TO-USE-MULTI-CLAUDE.md](WHEN-TO-USE-MULTI-CLAUDE.md) per la tabella decisionale completa, con esempi tratti da test effettuati.

## Sicurezza

Multi-Claude è uno strumento a riga di comando (CLI) che opera **solo localmente**. Gestisce le sessioni di Claude Code su una singola macchina di sviluppo.

- **Accesso:** File system locale (directory di lavoro + `.multi-claude/`), database SQLite, processi secondari di Claude Code, localhost (solo per il monitoraggio).
- **Non accede a:** API cloud direttamente, non raccoglie dati di telemetria, non memorizza credenziali, non effettua connessioni di rete al di fuori di localhost.
- **Permessi:** Le operazioni sui file sono limitate alla directory del progetto, il monitor è collegato solo a localhost, le policy degli hook eseguono solo comandi CLI esistenti, le azioni dell'operatore vengono gestite tramite moduli legali standard.

Consultare il file [SECURITY.md](SECURITY.md) per la politica di sicurezza completa e per segnalare eventuali vulnerabilità.

## Test

```bash
npm test          # 1600+ tests via Vitest
npm run typecheck # TypeScript strict mode
npm run verify    # typecheck + test + build
```

## Piattaforme

- **Sistema operativo:** Windows, macOS, Linux
- **Runtime:** Node.js 20+
- **Dipendenze:** Claude Code CLI, better-sqlite3, Commander, Express

## Licenza

[MIT](LICENSE)

---

Creato da <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
