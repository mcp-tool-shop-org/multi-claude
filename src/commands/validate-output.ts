import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateArtifactManifest, validateWriteback } from '../schema/submission.js';

interface ValidationResult {
  valid: boolean;
  artifacts: { valid: boolean; error?: string };
  writeback: { valid: boolean; error?: string };
}

export function runValidateOutput(outputDir: string): ValidationResult {
  const artifactsPath = join(outputDir, 'artifacts.json');
  const writebackPath = join(outputDir, 'writeback.json');

  const result: ValidationResult = {
    valid: true,
    artifacts: { valid: false },
    writeback: { valid: false },
  };

  // Check artifacts.json
  if (!existsSync(artifactsPath)) {
    result.artifacts = { valid: false, error: 'artifacts.json not found' };
    result.valid = false;
  } else {
    const raw = readFileSync(artifactsPath, 'utf-8');
    const artResult = validateArtifactManifest(raw);
    if ('error' in artResult) {
      result.artifacts = { valid: false, error: artResult.error };
      result.valid = false;
    } else {
      result.artifacts = { valid: true };
    }
  }

  // Check writeback.json
  if (!existsSync(writebackPath)) {
    result.writeback = { valid: false, error: 'writeback.json not found' };
    result.valid = false;
  } else {
    const raw = readFileSync(writebackPath, 'utf-8');
    const wbResult = validateWriteback(raw, true);
    if ('error' in wbResult) {
      result.writeback = { valid: false, error: wbResult.error };
      result.valid = false;
    } else {
      result.writeback = { valid: true };
    }
  }

  return result;
}

export function validateOutputCommand(): Command {
  return new Command('validate-output')
    .description('Validate worker output files against the canonical submission schema')
    .argument('<output-dir>', 'Path to worker output directory')
    .action((outputDir) => {
      const result = runValidateOutput(outputDir);
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exit(1);
    });
}
