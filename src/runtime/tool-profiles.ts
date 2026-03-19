/** Role-based tool permissions — makes role separation real in execution */

export type RoleToolProfile = {
  role: string;
  tools: string[];
  description: string;
};

export const ROLE_TOOL_PROFILES: Record<string, RoleToolProfile> = {
  architect: {
    role: 'architect',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    description: 'Full access for architecture/contract work',
  },
  builder: {
    role: 'builder',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    description: 'Full access for implementation within allowed scope',
  },
  'verifier-checklist': {
    role: 'verifier-checklist',
    tools: ['Read', 'Bash', 'Glob', 'Grep'],
    description: 'Read-only + Bash for running verification commands. No Write/Edit.',
  },
  'verifier-analysis': {
    role: 'verifier-analysis',
    tools: ['Read', 'Bash', 'Glob', 'Grep'],
    description: 'Read-only + Bash for failure analysis. No Write/Edit.',
  },
  integrator: {
    role: 'integrator',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    description: 'Full access for seam resolution and integration',
  },
  knowledge: {
    role: 'knowledge',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    description: 'Read + Write for notes/docs. No Bash.',
  },
  docs: {
    role: 'docs',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    description: 'Read + Write for documentation. No Bash.',
  },
};

export function getToolProfile(role: string): string[] {
  return ROLE_TOOL_PROFILES[role]?.tools ?? ROLE_TOOL_PROFILES['builder']!.tools;
}
