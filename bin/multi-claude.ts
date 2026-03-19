#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { featureCommand } from '../src/commands/feature.js';
import { packetCommand } from '../src/commands/packet.js';
import { statusCommand } from '../src/commands/status.js';
import { claimCommand, progressCommand } from '../src/commands/claim.js';
import { renderCommand } from '../src/commands/render.js';
import { submitCommand } from '../src/commands/submit.js';
import { verifyCommand } from '../src/commands/verify.js';
import { approveCommand } from '../src/commands/approve.js';
import { promoteCommand } from '../src/commands/promote.js';
import { integrateCommand } from '../src/commands/integrate.js';
import { expireCommand } from '../src/commands/expire.js';
import { autoCommand } from '../src/commands/auto.js';
import { validateOutputCommand } from '../src/commands/validate-output.js';
import { hooksCommand } from '../src/commands/hooks.js';

const program = new Command();

program
  .name('multi-claude')
  .description('Multi-Claude — lane-based parallel build system')
  .version('0.1.0');

program.addCommand(initCommand());
program.addCommand(featureCommand());
program.addCommand(packetCommand());
program.addCommand(statusCommand());
program.addCommand(claimCommand());
program.addCommand(progressCommand());
program.addCommand(renderCommand());
program.addCommand(submitCommand());
program.addCommand(verifyCommand());
program.addCommand(approveCommand());
program.addCommand(promoteCommand());
program.addCommand(integrateCommand());
program.addCommand(expireCommand());
program.addCommand(autoCommand());
program.addCommand(validateOutputCommand());
program.addCommand(hooksCommand());

program.parse();
