/**
 * Handoff Spine — Claude model adapter.
 *
 * Formats rendered context for Claude's prompt structure.
 * Does NOT alter semantic content — only presentation/dialect.
 */

import type { ModelAdapter, ModelAdapterInput, WorkingContext } from '../../schema/render.js';

const ADAPTER_VERSION = '1.0.0';

export class ClaudeAdapter implements ModelAdapter {
  readonly name = 'claude';
  readonly version = ADAPTER_VERSION;

  adapt(input: ModelAdapterInput): WorkingContext {
    const { rendered } = input;

    const systemParts = [
      rendered.instructionBlock,
    ].filter(Boolean);

    const developerParts = [
      rendered.stateBlock,
      rendered.decisionsBlock,
      rendered.openLoopsBlock,
      rendered.artifactBlock,
    ].filter(Boolean);

    if (rendered.warnings.length > 0) {
      developerParts.push('\n## Warnings\n' + rendered.warnings.map(w => `- ${w}`).join('\n'));
    }

    const system = systemParts.join('\n\n');
    const developer = developerParts.join('\n\n');

    return {
      system,
      developer: developer || undefined,
      metadata: {
        handoffId: '', // filled by compose
        packetVersion: 0,
        rendererVersion: rendered.rendererVersion,
        adapterVersion: this.version,
      },
    };
  }
}
