/**
 * Handoff Spine — GPT model adapter.
 *
 * Formats rendered context for OpenAI GPT prompt structure.
 * Does NOT alter semantic content — only presentation/dialect.
 */

import type { ModelAdapter, ModelAdapterInput, WorkingContext } from '../../schema/render.js';

const ADAPTER_VERSION = '1.0.0';

export class GptAdapter implements ModelAdapter {
  readonly name = 'gpt';
  readonly version = ADAPTER_VERSION;

  adapt(input: ModelAdapterInput): WorkingContext {
    const { rendered } = input;

    const allParts = [
      rendered.instructionBlock,
      rendered.stateBlock,
      rendered.decisionsBlock,
      rendered.openLoopsBlock,
      rendered.artifactBlock,
    ].filter(Boolean);

    if (rendered.warnings.length > 0) {
      allParts.push('## Warnings\n' + rendered.warnings.map(w => `- ${w}`).join('\n'));
    }

    // GPT uses a single system message for all content
    return {
      system: allParts.join('\n\n---\n\n'),
      metadata: {
        handoffId: '',
        packetVersion: 0,
        rendererVersion: rendered.rendererVersion,
        adapterVersion: this.version,
      },
    };
  }
}
