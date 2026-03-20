<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/multi-claude/readme.png" width="400" alt="Multi-Claude" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/actions"><img src="https://github.com/mcp-tool-shop-org/multi-claude/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/multi-claude/"><img src="https://img.shields.io/badge/docs-landing%20page-blue" alt="Landing Page" /></a>
</p>

Laneベースの並列ビルドシステム。[Claude Code](https://claude.ai/)向け。複数のClaudeセッションが同じコードベースで連携し、依存関係の解決、ファイル所有権、オペレーターの介入、および証拠に基づく引き継ぎを行います。

## 機能

Multi-Claudeは、単一の大きなタスクを**パケットグラフ**に変換します。これは、明確なファイル所有権と依存関係を持つ、小さく、独立して処理可能な作業単位です。複数のClaude Codeセッションが、並列にパケットを実行し、オペレーターが統合されたコントロールプレーンを通じて監視、介入、および承認を行います。

**オペレーターのサイクル:**

1. **計画:** 適合性の評価、設計の作成、契約の確定
2. **実行:** ワーカがパケットを処理、成果物を生成、出力の検証
3. **監視:** ライブの5つのパネルで構成されるコンソールで、実行状態、フック、適合性などを表示
4. **介入:** 実行の停止、パケットの再実行、フックの解決、ゲートの承認
5. **復旧:** 8つの障害シナリオに対するガイダンス付きの復旧フロー
6. **完了:** 結果の導出、引き継ぎ証拠の提供、昇格/承認

## インストール

```bash
npm install -g @multi-claude/cli
```

Node.js 20以上と、[Claude Code](https://claude.ai/) CLIがインストールされている必要があります。

## クイックスタート

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

## コマンド

### コア

| コマンド | 説明 |
|---------|-------------|
| `multi-claude plan evaluate` | 作業クラス、パケット数、結合度から適合性を評価 |
| `multi-claude blueprint init` | テンプレートからパケットグラフを生成 |
| `multi-claude blueprint validate` | 合法性をチェック（ファイル重複、依存関係、ゲート） |
| `multi-claude blueprint freeze` | SHA-256ハッシュ。確定後は不変 |
| `multi-claude run` | 実行を開始 |
| `multi-claude resume` | 停止した実行を再開 |
| `multi-claude stop` | 実行を停止 |
| `multi-claude status` | 実行の状態を表示 |

### コンソール（18のサブコマンド）

| コマンド | 説明 |
|---------|-------------|
| `console show` | フル5パネルのオペレーターコンソール |
| `console overview` | 実行の概要 |
| `console packets` | パケットの状態と進捗 |
| `console workers` | ワーカセッション |
| `console hooks` | フックの決定フィード |
| `console fitness` | 実行/パケットの成熟度スコア |
| `console next` | 次の合法的なアクション（10段階の優先度） |
| `console watch` | 2秒間隔で自動更新 |
| `console actions` | 利用可能なオペレーターのアクション |
| `console act` | オペレーターのアクションを実行 |
| `console audit` | 監査ログ |
| `console recover` | ガイダンス付きの復旧フロー |
| `console outcome` | 実行結果の導出 |
| `console handoff` | 引き継ぎ証拠の概要 |
| `console promote-check` | 昇格の資格 |
| `console approve` | 承認の記録 |
| `console reject` | 拒否の記録 |
| `console approval` | 承認の状態 |
| `console export` | 引き継ぎ/承認/ゲートをMarkdownまたはJSON形式でエクスポート |

### 監視（コントロールプレーンUI）

```bash
multi-claude monitor --port 3100
```

`http://localhost:3100`でReactベースのオペレーターダッシュボードを開きます。
- **概要:** システムの状態、レーンの利用状況、アクティブなトライアル
- **キュー:** ソート可能なアイテムリストとインラインアクション
- **アイテム詳細:** 状況バナー（状態/リスク/次のアクション）、意思決定ワークベンチ、折りたたみ可能な証拠
- **レーンの状態:** 各レーンのメトリクス、介入、ポリシー入力
- **アクティビティ:** リアルタイムのイベントタイムライン

## アーキテクチャ

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

## Multi-Claudeを使用するタイミング

Multi-Claudeは、**パケット数が調整オーバーヘッドを相殺できる程度に高い場合**、および**ファイル所有権が明確で、意味的な整合性を維持できる場合**に最適です。

| 作業クラス | 適合性 | 損益分岐点 |
|------------|-----|------------|
| バックエンド/状態/ドメイン | 強い | 約3パケット |
| UI/インタラクション/シームが複雑 | 中程度 | 約5パケット |
| コントロールプレーン/インフラ | 中程度 | 約5～6パケット |

**使用するタイミング:** 5つ以上のパケット、明確なファイル所有権、自然なウェーブ構造、独立した検証が重要。

**シングルClaudeを使用するタイミング:** アーキテクチャが未完成/不安定、2つ以下のパケット、主にシーケンシャルなクリティカルパス、オペレーターがボトルネックになる。

詳細な判断基準については、評価されたテスト結果を含む[WHEN-TO-USE-MULTI-CLAUDE.md](WHEN-TO-USE-MULTI-CLAUDE.md)をご参照ください。

## セキュリティ

Multi-Claudeは、**ローカル環境でのみ動作するコマンドラインツール**です。単一の開発者マシン上でClaude Codeのセッションを管理します。

- **アクセス対象:** ローカルファイルシステム（作業ディレクトリと`.multi-claude/`ディレクトリ）、SQLiteデータベース、Claude Codeのサブプロセス、localhost（監視のみ）
- **アクセス対象外:** クラウドAPIへの直接アクセス、テレメトリー機能、認証情報ストレージ、localhost以外のネットワークへのアクセス
- **権限:** ファイル操作はプロジェクトディレクトリに限定、監視機能はlocalhostにのみバインド、フックポリシーは既存のコマンドラインコマンドのみを実行、オペレーターの操作は標準的なモジュールを経由

詳細なセキュリティポリシーおよび脆弱性報告については、[SECURITY.md](SECURITY.md)をご参照ください。

## テスト

```bash
npm test          # 1600+ tests via Vitest
npm run typecheck # TypeScript strict mode
npm run verify    # typecheck + test + build
```

## 対応プラットフォーム

- **OS:** Windows、macOS、Linux
- **実行環境:** Node.js 20以降
- **依存関係:** Claude Code CLI、better-sqlite3、Commander、Express

## ライセンス

[MIT](LICENSE)

---

開発: <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
