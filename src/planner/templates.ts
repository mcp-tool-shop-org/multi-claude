export interface TemplatePacketStub {
  label: string;
  role: string;
  packetClass: string;
  budgetMinutes: [number, number];
  ceilingMinutes: number;
  description: string;
}

export interface TemplateWave {
  wave: number;
  packets: TemplatePacketStub[];
  parallel: boolean;
}

export interface PacketTemplate {
  id: string;
  name: string;
  workClass: string;
  description: string;
  waveStructure: TemplateWave[];
  couplingGuards: string[];
  requiredGates: string[];
  readinessChecks: string[];
  crossTemplateRules: string[];
}

const BACKEND_LAW_TEMPLATE: PacketTemplate = {
  id: 'backend_law',
  name: 'Backend Law',
  workClass: 'backend_state',
  description: 'State-domain backend with invariant/boundary split followed by adversarial + integration verification.',
  waveStructure: [
    {
      wave: 1,
      parallel: true,
      packets: [
        {
          label: 'Invariant/Core',
          role: 'builder',
          packetClass: 'state_domain',
          budgetMinutes: [3, 5],
          ceilingMinutes: 6,
          description: 'Define core invariants and domain state rules.',
        },
        {
          label: 'Boundary/Guardrails',
          role: 'builder',
          packetClass: 'backend',
          budgetMinutes: [3, 5],
          ceilingMinutes: 6,
          description: 'Establish boundary checks and guardrail enforcement.',
        },
      ],
    },
    {
      wave: 2,
      parallel: true,
      packets: [
        {
          label: 'Adversarial Tests',
          role: 'builder',
          packetClass: 'verification',
          budgetMinutes: [5, 7],
          ceilingMinutes: 8,
          description: 'Adversarial test suite proving invariant and boundary correctness.',
        },
        {
          label: 'Integration/Plugin',
          role: 'builder',
          packetClass: 'integration',
          budgetMinutes: [4, 6],
          ceilingMinutes: 8,
          description: 'Integration and plugin wiring consuming wave-1 laws.',
        },
      ],
    },
  ],
  couplingGuards: [
    'No barrel exports by builders',
    'Test files follow source ownership',
  ],
  requiredGates: [
    'Pre-Wave-2 scope verification',
  ],
  readinessChecks: [
    'Wave-1 invariants compile and pass unit tests before wave-2 starts',
    'No cross-packet imports in wave-1',
  ],
  crossTemplateRules: [
    'Backend law packets must not touch UI files',
    'State domain packets own their own test files',
  ],
};

const UI_SEAM_TEMPLATE: PacketTemplate = {
  id: 'ui_seam',
  name: 'UI Seam',
  workClass: 'ui_interaction',
  description: 'Domain/state floor built serially, then parallel UI component packets with CSS ownership.',
  waveStructure: [
    {
      wave: 1,
      parallel: false,
      packets: [
        {
          label: 'Domain/State Floor',
          role: 'builder',
          packetClass: 'state_domain',
          budgetMinutes: [3, 5],
          ceilingMinutes: 6,
          description: 'Establish domain types and state floor before UI work begins.',
        },
      ],
    },
    {
      wave: 2,
      parallel: true,
      packets: [
        {
          label: 'Component A',
          role: 'builder',
          packetClass: 'ui_interaction',
          budgetMinutes: [4, 6],
          ceilingMinutes: 8,
          description: 'First UI component with owned CSS section.',
        },
        {
          label: 'Component B',
          role: 'builder',
          packetClass: 'ui_interaction',
          budgetMinutes: [4, 6],
          ceilingMinutes: 8,
          description: 'Second UI component with owned CSS section.',
        },
      ],
    },
  ],
  couplingGuards: [
    'CSS section ownership',
    'No UI packet touches domain files',
    'No barrel exports by builders',
  ],
  requiredGates: [
    'Pre-Wave-2 scope verification',
    'Pre-Wave-2 CSS ownership verification',
    'Pre-Wave-2 type verification',
    'Mandatory semantic integrator',
  ],
  readinessChecks: [
    'Domain/state floor types exported and compiling before wave-2',
    'CSS ownership map defined before parallel UI work',
  ],
  crossTemplateRules: [
    'UI packets must not redefine domain types',
    'Each component owns its CSS section exclusively',
  ],
};

const CONTROL_PLANE_TEMPLATE: PacketTemplate = {
  id: 'control_plane',
  name: 'Control Plane',
  workClass: 'control_plane',
  description: 'Parallel law definition followed by orchestration wiring and test harness.',
  waveStructure: [
    {
      wave: 1,
      parallel: true,
      packets: [
        {
          label: 'Law A',
          role: 'builder',
          packetClass: 'backend',
          budgetMinutes: [4, 6],
          ceilingMinutes: 8,
          description: 'First law definition for the control plane.',
        },
        {
          label: 'Law B',
          role: 'builder',
          packetClass: 'backend',
          budgetMinutes: [4, 6],
          ceilingMinutes: 8,
          description: 'Second law definition for the control plane.',
        },
      ],
    },
    {
      wave: 2,
      parallel: true,
      packets: [
        {
          label: 'Orchestration Wiring',
          role: 'builder',
          packetClass: 'integration',
          budgetMinutes: [5, 7],
          ceilingMinutes: 10,
          description: 'Wire orchestration consuming wave-1 laws without redefining them.',
        },
        {
          label: 'Test Harness',
          role: 'builder',
          packetClass: 'verification',
          budgetMinutes: [5, 7],
          ceilingMinutes: 10,
          description: 'End-to-end test harness proving control-plane correctness.',
        },
      ],
    },
  ],
  couplingGuards: [
    'No packet both defines law and wires orchestration',
    'Wiring consumes not redefines',
    'No type casts in wiring',
  ],
  requiredGates: [
    'Pre-Wave-2 scope verification',
    'Pre-Wave-2 coupling guard verification',
  ],
  readinessChecks: [
    'Both law packets compile and export clean interfaces before wave-2',
    'No cross-law imports between wave-1 packets',
  ],
  crossTemplateRules: [
    'Orchestration wiring must import law interfaces, never re-declare them',
    'Test harness must cover both laws and wiring integration',
  ],
};

export const TEMPLATE_REGISTRY = new Map<string, PacketTemplate>();
TEMPLATE_REGISTRY.set(BACKEND_LAW_TEMPLATE.id, BACKEND_LAW_TEMPLATE);
TEMPLATE_REGISTRY.set(UI_SEAM_TEMPLATE.id, UI_SEAM_TEMPLATE);
TEMPLATE_REGISTRY.set(CONTROL_PLANE_TEMPLATE.id, CONTROL_PLANE_TEMPLATE);

export function getTemplate(id: string): PacketTemplate | undefined {
  return TEMPLATE_REGISTRY.get(id);
}

export function suggestTemplate(workClass: string): PacketTemplate | undefined {
  for (const template of TEMPLATE_REGISTRY.values()) {
    if (template.workClass === workClass) {
      return template;
    }
  }
  return undefined;
}

export function validateTemplateMatch(
  template: PacketTemplate,
  packetCount: number,
): { valid: boolean; warnings: string[] } {
  const totalTemplatePackets = template.waveStructure.reduce(
    (sum, wave) => sum + wave.packets.length,
    0,
  );
  const warnings: string[] = [];

  if (packetCount < totalTemplatePackets) {
    warnings.push(
      `Packet count ${packetCount} is below template minimum of ${totalTemplatePackets} packets`,
    );
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
