/**
 * Handoff Spine — Ollama model adapter.
 *
 * Formats rendered context for local Ollama models.
 * More concise than cloud adapters — local models often have
 * smaller context windows and benefit from tighter formatting.
 */

import type { ModelAdapter, ModelAdapterInput, WorkingContext } from '../../schema/render.js';

const ADAPTER_VERSION = '1.0.0';

export class OllamaAdapter implements ModelAdapter {
  readonly name = 'ollama';
  readonly version = ADAPTER_VERSION;

  adapt(input: ModelAdapterInput): WorkingContext {
    const { rendered } = input;

    // Ollama: single compact system prompt, no developer message
    const parts = [
      rendered.instructionBlock,
      rendered.stateBlock,
      rendered.decisionsBlock,
      rendered.openLoopsBlock,
      rendered.artifactBlock,
    ].filter(Boolean);

    if (rendered.warnings.length > 0) {
      parts.push('Warnings: ' + rendered.warnings.join('; '));
    }

    return {
      system: parts.join('\n\n'),
      metadata: {
        handoffId: '',
        packetVersion: 0,
        rendererVersion: rendered.rendererVersion,
        adapterVersion: this.version,
      },
    };
  }
}
