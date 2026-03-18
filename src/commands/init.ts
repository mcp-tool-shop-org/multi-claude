import { Command } from 'commander';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, migrateDb, healthCheck, setSchemaVersion } from '../db/connection.js';
import { mcfError, ERR } from '../lib/errors.js';
import type { McfResult } from '../types/common.js';

const SCHEMA_VERSION = 1;

export interface InitResult {
  db_path: string;
  repo_slug: string;
  tables_created: number;
  wal_mode: boolean;
}

export function runInit(repoSlug: string, dbPath: string, force = false): McfResult<InitResult> {
  const mcfDir = resolve(dbPath, '..');
  const fullDbPath = resolve(dbPath);

  if (existsSync(fullDbPath) && !force) {
    return mcfError('mcf init', ERR.DB_EXISTS, `Execution DB already exists at ${fullDbPath}. Use --force to reinitialize.`, { db_path: fullDbPath });
  }

  if (!existsSync(mcfDir)) {
    mkdirSync(mcfDir, { recursive: true });
  }

  const db = openDb(fullDbPath);
  try {
    migrateDb(db);
    setSchemaVersion(db, SCHEMA_VERSION);

    const health = healthCheck(db);

    return {
      ok: true,
      command: 'mcf init',
      result: {
        db_path: fullDbPath,
        repo_slug: repoSlug,
        tables_created: health.tables,
        wal_mode: health.walMode,
      },
      transitions: [],
    };
  } finally {
    db.close();
  }
}

export function initCommand(): Command {
  const cmd = new Command('init')
    .description('Initialize MCF execution DB for a repo workspace')
    .requiredOption('--repo <slug>', 'Repo slug (e.g. mcp-tool-shop-org/GlyphStudio)')
    .option('--db-path <path>', 'Path to execution DB', '.mcf/execution.db')
    .option('--force', 'Reinitialize existing DB', false)
    .action((opts: { repo: string; dbPath: string; force: boolean }) => {
      const result = runInit(opts.repo, opts.dbPath, opts.force);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  return cmd;
}
