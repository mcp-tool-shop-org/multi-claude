import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../src/handoff/render/adapters/claude-adapter.js';
import { GptAdapter } from '../../src/handoff/render/adapters/gpt-adapter.js';
import { OllamaAdapter } from '../../src/handoff/render/adapters/ollama-adapter.js';
import { WorkerRenderer } from '../../src/handoff/render/role/worker-renderer.js';
import { makeTestPacket } from './helpers.js';

describe('Model Adapters', () => {
  const packet = makeTestPacket();
  const renderer = new WorkerRenderer();
  const rendered = renderer.render({ packet });

  describe('adapters do not alter semantic content', () => {
    it('Claude adapter preserves all semantic blocks', () => {
      const adapter = new ClaudeAdapter();
      const result = adapter.adapt({ rendered });

      // System should contain instructions
      expect(result.system).toContain('Complete the backend implementation');
      // Developer should contain state/decisions/loops
      expect(result.developer).toContain(packet.summary);
    });

    it('GPT adapter preserves all semantic blocks', () => {
      const adapter = new GptAdapter();
      const result = adapter.adapt({ rendered });

      // All content in system message
      expect(result.system).toContain('Complete the backend implementation');
      expect(result.system).toContain(packet.summary);
    });

    it('Ollama adapter preserves all semantic blocks', () => {
      const adapter = new OllamaAdapter();
      const result = adapter.adapt({ rendered });

      expect(result.system).toContain('Complete the backend implementation');
      expect(result.system).toContain(packet.summary);
    });
  });

  describe('adapters produce structurally different outputs', () => {
    it('Claude uses system + developer split', () => {
      const adapter = new ClaudeAdapter();
      const result = adapter.adapt({ rendered });

      expect(result.system).toBeTruthy();
      expect(result.developer).toBeTruthy();
    });

    it('GPT puts everything in system', () => {
      const adapter = new GptAdapter();
      const result = adapter.adapt({ rendered });

      expect(result.system).toBeTruthy();
      expect(result.developer).toBeUndefined();
    });

    it('Ollama puts everything in system (compact)', () => {
      const adapter = new OllamaAdapter();
      const result = adapter.adapt({ rendered });

      expect(result.system).toBeTruthy();
      expect(result.developer).toBeUndefined();
    });
  });

  describe('adapter metadata', () => {
    it('each adapter reports its name and version', () => {
      const claude = new ClaudeAdapter();
      const gpt = new GptAdapter();
      const ollama = new OllamaAdapter();

      expect(claude.name).toBe('claude');
      expect(gpt.name).toBe('gpt');
      expect(ollama.name).toBe('ollama');

      expect(claude.version).toBeTruthy();
      expect(gpt.version).toBeTruthy();
      expect(ollama.version).toBeTruthy();
    });
  });
});
