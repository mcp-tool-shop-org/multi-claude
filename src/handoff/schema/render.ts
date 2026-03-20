/**
 * Handoff Spine — Renderer contracts.
 *
 * Chain: packet → role renderer → model adapter → working context
 *
 * Renderers are views. They MUST NOT mutate packet truth.
 * Instruction/data separation is enforced by the block structure.
 */

import type {
  HandoffPacket,
  HandoffId,
  PacketVersion,
  RendererVersion,
  ContentHash,
  HandoffLane,
} from './packet.js';

// ── Role renderer ─────────────────────────────────────────────────

export interface RoleRendererInput {
  packet: HandoffPacket;
  tokenBudget?: number;
}

export interface RoleRenderedContext {
  role: HandoffLane;
  rendererVersion: RendererVersion;

  instructionBlock: string;
  stateBlock: string;
  decisionsBlock: string;
  openLoopsBlock: string;
  artifactBlock: string;
  warnings: string[];
}

// ── Model adapter ─────────────────────────────────────────────────

export interface ModelAdapterInput {
  rendered: RoleRenderedContext;
  tokenBudget?: number;
}

export interface WorkingContext {
  system: string;
  developer?: string;
  userBootstrap?: string;
  metadata: {
    handoffId: HandoffId;
    packetVersion: PacketVersion;
    rendererVersion: RendererVersion;
    adapterVersion: string;
  };
}

// ── Render event (audit trail) ────────────────────────────────────

export interface RenderEventRecord {
  id?: number;
  handoffId: HandoffId;
  packetVersion: PacketVersion;
  roleRenderer: string;
  rendererVersion: RendererVersion;
  modelAdapter: string;
  adapterVersion: string;
  tokenBudget?: number;
  renderedAt: string;
  outputHash: ContentHash;
}

// ── Use record ────────────────────────────────────────────────────

export interface HandoffUseRecord {
  id?: number;
  handoffId: HandoffId;
  packetVersion: PacketVersion;
  renderEventId?: number;
  consumerRunId: string;
  consumerRole: string;
  usedAt: string;
}

// ── Renderer interface ────────────────────────────────────────────

export interface RoleRenderer {
  readonly role: HandoffLane;
  readonly version: RendererVersion;
  render(input: RoleRendererInput): RoleRenderedContext;
}

export interface ModelAdapter {
  readonly name: string;
  readonly version: string;
  adapt(input: ModelAdapterInput): WorkingContext;
}
