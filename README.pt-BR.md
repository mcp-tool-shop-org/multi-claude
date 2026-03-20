<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/multi-claude/readme.png" width="400" alt="Multi-Claude" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/actions"><img src="https://github.com/mcp-tool-shop-org/multi-claude/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/multi-claude/"><img src="https://img.shields.io/badge/docs-landing%20page-blue" alt="Landing Page" /></a>
</p>

Sistema de construção paralelo baseado em "lanes" para [Claude Code](https://claude.ai/). Orquestra múltiplas sessões do Claude trabalhando no mesmo código-fonte, com resolução de dependências, gerenciamento de propriedade de arquivos, intervenção do operador e transferência de informações com evidências.

## O que ele faz

O Multi-Claude transforma uma tarefa grande em um **grafo de pacotes** — unidades de trabalho pequenas e independentes, com propriedade de arquivo explícita e dependências definidas. Múltiplas sessões do Claude Code executam pacotes em ondas paralelas, enquanto um operador observa, intervém e aprova através de um painel de controle unificado.

**O ciclo do operador:**

1. **Planejar** — Avaliar a adequação, gerar o plano, fixar o contrato.
2. **Executar** — Os trabalhadores assumem os pacotes, produzem artefatos, verificam a saída.
3. **Observar** — O console com 5 painéis mostra o estado da execução, os "hooks" (gatilhos) e a adequação.
4. **Intervir** — Interromper execuções, repetir pacotes, resolver "hooks", aprovar etapas.
5. **Recuperar** — Fluxos de recuperação guiados para 8 cenários de falha.
6. **Concluir** — Derivação do resultado, transferência de evidências, promoção/aprovação.

## Instalação

```bash
npm install -g @multi-claude/cli
```

Requer Node.js 20+ e o CLI do [Claude Code](https://claude.ai/) instalados.

## Início rápido

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

### Core

| Comando | Descrição |
|---------|-------------|
| `multi-claude plan evaluate` | Avalia a adequação com base na classe de trabalho, número de pacotes e acoplamento. |
| `multi-claude blueprint init` | Gera o grafo de pacotes a partir de um modelo. |
| `multi-claude blueprint validate` | Verifica a legalidade (sobreposição de arquivos, dependências, etapas). |
| `multi-claude blueprint freeze` | Hash SHA-256, imutável após a fixação. |
| `multi-claude run` | Inicia a execução. |
| `multi-claude resume` | Retoma uma execução interrompida. |
| `multi-claude stop` | Interrompe uma execução. |
| `multi-claude status` | Mostra o status da execução. |

### Console (18 subcomandos)

| Comando | Descrição |
|---------|-------------|
| `console show` | Console completo com 5 painéis para o operador. |
| `console overview` | Resumo da execução. |
| `console packets` | Estados e progresso dos pacotes. |
| `console workers` | Sessões dos trabalhadores. |
| `console hooks` | Fluxo de decisões dos "hooks". |
| `console fitness` | Pontuações de maturação da execução/pacote. |
| `console next` | Próxima ação legal (prioridade de 10 níveis). |
| `console watch` | Atualização automática a cada 2 segundos. |
| `console actions` | Ações disponíveis para o operador. |
| `console act` | Executa uma ação do operador. |
| `console audit` | Registro de auditoria. |
| `console recover` | Fluxos de recuperação guiados. |
| `console outcome` | Derivação do resultado da execução. |
| `console handoff` | Resumo da transferência de evidências. |
| `console promote-check` | Elegibilidade para promoção. |
| `console approve` | Registro de aprovação. |
| `console reject` | Registro de rejeição. |
| `console approval` | Status da aprovação. |
| `console export` | Exporta a transferência/aprovação/etapa como Markdown ou JSON. |

### Monitor (Painel de Controle)

```bash
multi-claude monitor --port 3100
```

Abre um painel de controle do operador baseado em React em `http://localhost:3100` com:
- **Visão geral** — estado do sistema, utilização dos "lanes", testes ativos.
- **Fila** — lista de itens classificáveis com ações inline.
- **Detalhes do item** — banner de situação (estado/risco/próximo passo), área de trabalho de decisão, prova expansível.
- **Saúde do "lane"** — métricas por "lane", intervenções, entradas de política.
- **Atividade** — linha do tempo de eventos em tempo real.

## Arquitetura

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

## Quando usar o Multi-Claude

O Multi-Claude funciona melhor quando **o número de pacotes é alto o suficiente para amortizar a sobrecarga de coordenação** e **a propriedade de arquivos é clara o suficiente para manter a reconciliação semântica limitada.**

| Classe de trabalho | Adequação | Ponto de equilíbrio |
|------------|-----|------------|
| Backend/estado/domínio | Forte | ~3 pacotes |
| UI/interação/muita integração | Moderado | ~5 pacotes |
| Painel de controle/infraestrutura | Moderado | ~5-6 pacotes |

**Use-o quando:** 5+ pacotes, propriedade de arquivo clara, estrutura de ondas natural, a verificação independente é importante.

**Use apenas o Claude único quando:** Arquitetura de scaffolding/instável, 2 ou menos pacotes, caminho crítico principalmente sequencial, o operador se tornaria um gargalo.

Consulte [WHEN-TO-USE-MULTI-CLAUDE.md](WHEN-TO-USE-MULTI-CLAUDE.md) para obter a matriz de decisão completa, com evidências de testes realizados.

## Segurança

O Multi-Claude é uma **ferramenta de linha de comando (CLI) que funciona apenas localmente**. Ele gerencia sessões do Claude Code em uma única máquina de desenvolvimento.

- **Acessa:** Sistema de arquivos local (diretório de trabalho + `.multi-claude/`), banco de dados SQLite, subprocessos do Claude Code, localhost (apenas para monitoramento).
- **Não acessa:** APIs na nuvem diretamente, não coleta dados de telemetria, não armazena credenciais, não possui tráfego de rede além do localhost.
- **Permissões:** Operações de arquivo restritas ao diretório do projeto, o monitor se conecta apenas ao localhost, as políticas de "hook" executam apenas comandos da linha de comando existentes, as ações do operador são realizadas através de módulos de leis padrão.

Consulte [SECURITY.md](SECURITY.md) para obter a política de segurança completa e para relatar vulnerabilidades.

## Testes

```bash
npm test          # 1600+ tests via Vitest
npm run typecheck # TypeScript strict mode
npm run verify    # typecheck + test + build
```

## Plataformas

- **Sistema Operacional:** Windows, macOS, Linux
- **Ambiente de Execução:** Node.js 20+
- **Dependências:** Claude Code CLI, better-sqlite3, Commander, Express

## Licença

[MIT](LICENSE)

---

Desenvolvido por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
