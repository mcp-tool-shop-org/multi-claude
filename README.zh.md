<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/multi-claude/readme.png" width="400" alt="Multi-Claude" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/actions"><img src="https://github.com/mcp-tool-shop-org/multi-claude/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/multi-claude/"><img src="https://img.shields.io/badge/docs-landing%20page-blue" alt="Landing Page" /></a>
</p>

Lane-based 并行构建系统，用于 [Claude Code](https://claude.ai/)。它协调多个 Claude 会话，共同处理同一代码库，并提供依赖关系解析、文件所有权管理、人工干预以及基于证据的交接功能。

## 功能

Multi-Claude 将一个大型任务分解为 **任务图**，即由小型、独立的任务单元组成，每个任务单元具有明确的文件所有权和依赖关系。多个 Claude Code 会话并行执行这些任务单元，同时，操作人员通过统一的控制面板进行观察、干预和审批。

**操作人员流程：**

1. **评估 (Plan)** — 评估适用性，生成蓝图，冻结合约。
2. **执行 (Execute)** — 任务执行者领取任务单元，生成成果，验证输出。
3. **观察 (Observe)** — 实时五面板控制台显示运行状态、钩子（hooks）和适用性。
4. **干预 (Intervene)** — 停止运行，重试任务单元，解决钩子，审批关卡。
5. **恢复 (Recover)** — 提供 8 种故障场景的引导式恢复流程。
6. **完成 (Close)** — 结果推导，交接证据，晋升/审批。

## 安装

```bash
npm install -g @multi-claude/cli
```

需要安装 Node.js 20+ 以及 [Claude Code](https://claude.ai/) CLI。

## 快速开始

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

## 命令

### 核心

| 命令 | 描述 |
|---------|-------------|
| `multi-claude plan evaluate` | 评估工作类别的适用性，包括任务单元数量和耦合度。 |
| `multi-claude blueprint init` | 从模板生成任务图。 |
| `multi-claude blueprint validate` | 检查合法性（文件重叠、依赖关系、关卡）。 |
| `multi-claude blueprint freeze` | SHA-256 哈希值，冻结后不可更改。 |
| `multi-claude run` | 启动执行。 |
| `multi-claude resume` | 恢复已停止的运行。 |
| `multi-claude stop` | 停止运行。 |
| `multi-claude status` | 显示运行状态。 |

### 控制台（18 个子命令）

| 命令 | 描述 |
|---------|-------------|
| `console show` | 完整的五面板操作人员控制台。 |
| `console overview` | 运行摘要。 |
| `console packets` | 任务单元状态和进度。 |
| `console workers` | 任务执行者会话。 |
| `console hooks` | 钩子决策反馈。 |
| `console fitness` | 运行/任务单元成熟度评分。 |
| `console next` | 下一步合法操作（10 级优先级）。 |
| `console watch` | 每 2 秒自动刷新。 |
| `console actions` | 可用的操作人员操作。 |
| `console act` | 执行操作人员操作。 |
| `console audit` | 审计跟踪。 |
| `console recover` | 引导式恢复流程。 |
| `console outcome` | 运行结果推导。 |
| `console handoff` | 交接证据简报。 |
| `console promote-check` | 晋升资格。 |
| `console approve` | 记录审批。 |
| `console reject` | 记录拒绝。 |
| `console approval` | 审批状态。 |
| `console export` | 将交接/审批/关卡导出为 Markdown 或 JSON 格式。 |

### 监控（控制面板 UI）

```bash
multi-claude monitor --port 3100
```

打开基于 React 的操作人员仪表板，地址为 `http://localhost:3100`，包含：
- **概览 (Overview)** — 系统健康状况、通道利用率、正在进行的试验。
- **队列 (Queue)** — 可排序的项目列表，带有内联操作。
- **项目详情 (Item Detail)** — 状态横幅（状态/风险/下一步操作）、决策工作台、可折叠证明。
- **通道健康状况 (Lane Health)** — 每个通道的指标、干预措施、策略输入。
- **活动 (Activity)** — 实时事件时间线。

## 架构

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

## 何时使用 Multi-Claude

当 **任务单元数量足够大，可以抵消协调开销** 并且 **文件所有权清晰，可以保持语义对齐的范围可控** 时，Multi-Claude 效果最佳。

| 工作类别 | 适用性 | 达到平衡点 |
|------------|-----|------------|
| 后端/状态/领域 | 强烈 | 约 3 个任务单元 |
| UI/交互/接口密集 | 中等 | 约 5 个任务单元 |
| 控制面板/基础设施 | 中等 | 约 5-6 个任务单元 |

**使用场景：** 5 个或更多任务单元，清晰的文件所有权，自然的波浪结构，独立的验证很重要。

**不适用场景：** 架构不稳定，2 个或更少的任务单元，主要为顺序的关键路径，操作人员会成为瓶颈。

请参考 [WHEN-TO-USE-MULTI-CLAUDE.md](WHEN-TO-USE-MULTI-CLAUDE.md) 文件，其中包含完整的决策指南，并附有经过评估的试验结果。

## 安全性

Multi-Claude 是一个**仅在本地运行的命令行工具**。它在单个开发者的机器上协调 Claude Code 会话。

- **涉及的组件：** 本地文件系统（工作目录 + `.multi-claude/` 目录）、SQLite 数据库、Claude Code 子进程、localhost（仅用于监控）。
- **不涉及的组件：** 不直接访问云端 API，不收集任何遥测数据，不存储任何凭据，不通过 localhost 以外的网络进行任何数据传输。
- **权限：** 文件操作仅限于项目目录，监控仅绑定到 localhost，钩子策略仅执行现有的命令行指令，操作员的操作通过标准的模块进行。

请参考 [SECURITY.md](SECURITY.md) 文件，其中包含完整的安全策略和漏洞报告。

## 测试

```bash
npm test          # 1600+ tests via Vitest
npm run typecheck # TypeScript strict mode
npm run verify    # typecheck + test + build
```

## 支持平台

- **操作系统：** Windows、macOS、Linux
- **运行时环境：** Node.js 20+
- **依赖项：** Claude Code CLI、better-sqlite3、Commander、Express

## 许可证

[MIT](LICENSE)

---

由 <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> 构建。
