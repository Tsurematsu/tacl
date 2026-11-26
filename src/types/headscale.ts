export interface HeadscaleAclEntry {
  action: "accept";
  src: string[];
  dst: string[];
  proto?: string;
}

export interface HeadscalePolicy {
  hosts?: Record<string, string>;
  groups?: Record<string, string[]>;
  tagOwners?: Record<string, string[]>;
  acls?: HeadscaleAclEntry[];
  ssh?: unknown[];
  autoApprovers?: Record<string, unknown>;
  tests?: unknown[];
  [key: string]: unknown;
}

export interface LockoutWarning {
  severity: "critical" | "warning";
  message: string;
  localDeviceName?: string;
  serverDeviceName?: string;
}

export interface CompileResult {
  policy: HeadscalePolicy;
  hujson: string;
  isPassthrough: boolean;
  protectedSshApplied: boolean;
  warnings: LockoutWarning[];
  stats: {
    hostCount: number;
    aclRuleCount: number;
    allowedPairs: number;
    blockedPairs: number;
  };
}
