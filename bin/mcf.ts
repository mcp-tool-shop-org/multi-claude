#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { featureCommand } from '../src/commands/feature.js';
import { packetCommand } from '../src/commands/packet.js';
import { statusCommand } from '../src/commands/status.js';
import { claimCommand, progressCommand } from '../src/commands/claim.js';
import { renderCommand } from '../src/commands/render.js';
import { submitCommand } from '../src/commands/submit.js';

const program = new Command();

program
  .name('mcf')
  .description('Multi-Claude Factory — lane-based parallel build system')
  .version('0.1.0');

program.addCommand(initCommand());
program.addCommand(featureCommand());
program.addCommand(packetCommand());
program.addCommand(statusCommand());
program.addCommand(claimCommand());
program.addCommand(progressCommand());
program.addCommand(renderCommand());
program.addCommand(submitCommand());

program.parse();
