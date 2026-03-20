/**
 * Control Plane Monitor — CLI command.
 *
 * multi-claude monitor [--port <port>] [--db-path <path>]
 */

import { Command } from 'commander';
import { startMonitorServer } from './server.js';

export function monitorCommand(): Command {
  return new Command('monitor')
    .description('Start the Control Plane Monitor (read-only UI server)')
    .option('--port <port>', 'Server port', '3100')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--static-dir <path>', 'Static files directory (built React app)')
    .action((opts) => {
      startMonitorServer({
        dbPath: opts.dbPath,
        port: parseInt(opts.port, 10),
        staticDir: opts.staticDir,
      });
    });
}
