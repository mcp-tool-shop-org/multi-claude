import { randomBytes } from 'node:crypto';

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PACKET_ID_PATTERN = /^[a-z0-9-]+--[a-z]+-[a-z0-9-]+$/;

export function isKebabCase(s: string): boolean {
  return KEBAB_CASE.test(s);
}

export function isValidPacketId(id: string): boolean {
  return PACKET_ID_PATTERN.test(id);
}

export function generateId(prefix?: string): string {
  const hex = randomBytes(8).toString('hex');
  return prefix ? `${prefix}-${hex}` : hex;
}

export function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
