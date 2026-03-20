import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: 'Multi-Claude',
  description: 'Lane-based parallel build system for Claude Code. Orchestrates multiple sessions with dependency resolution, operator intervention, and evidence-bound handoff.',
  logoBadge: 'MC',
  brandName: 'Multi-Claude',
  repoUrl: 'https://github.com/mcp-tool-shop-org/multi-claude',
  npmUrl: 'https://www.npmjs.com/package/@multi-claude/cli',
  footerText: 'MIT Licensed — built by <a href="https://github.com/mcp-tool-shop-org" style="color:var(--color-muted);text-decoration:underline">mcp-tool-shop-org</a>',

  hero: {
    badge: 'Open source',
    headline: 'Multi-Claude',
    headlineAccent: 'parallel builds for Claude Code.',
    description: 'Turn large tasks into packet graphs. Multiple Claude sessions execute in parallel waves while you observe, intervene, and approve through a unified control plane.',
    primaryCta: { href: '#usage', label: 'Get started' },
    secondaryCta: { href: 'handbook/', label: 'Read the Handbook' },
    previews: [
      { label: 'Install', code: 'npm install -g @multi-claude/cli' },
      { label: 'Plan', code: 'multi-claude plan evaluate --work-class backend_law --packets 6' },
      { label: 'Run', code: 'multi-claude run && multi-claude console watch' },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'features',
      title: 'Features',
      subtitle: 'Everything an operator needs to run parallel Claude sessions.',
      features: [
        { title: 'Packet Graphs', desc: 'Break work into small, independently claimable units with explicit file ownership and dependency edges.' },
        { title: 'Fitness Assessment', desc: 'Deterministic fit scoring from work class, packet count, coupling level, and ownership clarity.' },
        { title: 'Live Console', desc: '5-pane operator console: overview, packets, workers, hooks, fitness — with auto-refresh and next-action guidance.' },
        { title: 'Operator Intervention', desc: 'Stop runs, retry packets, resolve hooks, approve gates — with full audit trail and lawful refusal.' },
        { title: 'Evidence Handoff', desc: '12-law handoff spine: execution through promotion. Review-readiness rules, fingerprint-locked approvals.' },
        { title: '1600+ Tests', desc: 'Comprehensive test suite covering control plane, handoff spine, monitor commands, and contract guards.' },
      ],
    },
    {
      kind: 'code-cards',
      id: 'usage',
      title: 'Usage',
      cards: [
        { title: 'Install', code: 'npm install -g @multi-claude/cli' },
        { title: 'Assess fitness', code: 'multi-claude plan evaluate \\\n  --work-class backend_law \\\n  --packets 6 \\\n  --coupling low' },
        { title: 'Build and run', code: 'multi-claude blueprint init --template backend_law\nmulti-claude blueprint validate\nmulti-claude blueprint freeze\nmulti-claude run' },
        { title: 'Monitor', code: 'multi-claude console watch\nmulti-claude console next\nmulti-claude monitor --port 3100' },
      ],
    },
  ],
};
