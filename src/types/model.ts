export type Direction = "both" | "a_to_b" | "b_to_a" | "deny";
export type Protocol = "tcp" | "udp" | "both";
export type RuleScope = "device" | "profile" | "user";
export type TabId = "devices" | "profiles" | "users" | "direct";

/**
 * Default policy behavior when no explicit rule matches a pair of devices.
 * - "passthrough": Keep Headscale's existing ACL untouched if no rules exist,
 *   and avoid imposing destructive restrictions on unlinked devices.
 * - "deny": Strict default-deny for any pair without an explicit rule.
 */
export type DefaultPolicyMode = "passthrough" | "deny";

export interface HeadscaleUser {
  id: string;
  name: string;
  displayName?: string;
}

export interface Device {
  id: string;
  name: string;
  givenName?: string;
  userId: string;
  userName: string;
  ipAddresses: string[];
  online: boolean;
  tags: string[];
}

export interface Profile {
  id: string;
  name: string;
  deviceIds: string[];
}

export interface ConnectionRule {
  id: string;
  scope: RuleScope;
  sourceId: string;
  targetId: string;
  direction: Direction;
  protocol: Protocol;
  ports: string[]; // ["*"] by default, or specific ports/ranges like ["22", "443", "8000-8080"]
}

export interface ConflictResolution {
  pairKey: string; // Canonical sorted "devA::devB"
  winningRuleId: string;
}

export interface ProfileConflict {
  pairKey: string;
  deviceAId: string;
  deviceBId: string;
  competingRules: Array<{
    rule: ConnectionRule;
    effectiveDirection: Direction; // Normalized relative to (deviceA, deviceB)
    sourceProfileName: string;
    targetProfileName: string;
  }>;
}

export interface ProtectedSshLink {
  localDeviceId: string;
  serverDeviceId: string;
  sshPort: number;
}

export type ResolutionOrigin =
  | { kind: "device"; ruleId: string; label: string }
  | { kind: "profile"; ruleId: string; label: string; resolvedConflict?: boolean }
  | { kind: "user"; ruleId: string; label: string }
  | { kind: "protected"; label: string }
  | { kind: "default"; label: string }
  | { kind: "conflict"; label: string };

export interface EffectiveConnection {
  pairKey: string;
  deviceAId: string;
  deviceBId: string;
  deviceAName: string;
  deviceBName: string;
  direction: Direction;
  protocol: Protocol;
  ports: string[];
  origin: ResolutionOrigin;
  hasConflict: boolean;
  isSshProtected?: boolean;
  sshFallbackInjected?: boolean;
}

export interface TaclUiState {
  activeTab?: TabId;
  hasUnappliedChanges?: boolean;
  updatedAt?: string;
}

export interface TaclState {
  version: 1;
  initialized: boolean;
  defaultPolicy: DefaultPolicyMode;
  profiles: Profile[];
  rules: ConnectionRule[];
  conflictResolutions: ConflictResolution[];
  uiState?: TaclUiState;
}

export type HeadscaleDeployMode = "native" | "container";
export type HeadscalePolicyMode = "file" | "database";
export type NativeInstallerKind =
  | "apt"
  | "dnf"
  | "yum"
  | "rpm"
  | "pacman"
  | "apk"
  | "snap"
  | "brew"
  | "go"
  | "binary"
  | "unknown";

export interface SshHostCandidate {
  id: string;
  alias: string;
  hostName: string;
  user?: string;
  port?: number;
  identityFile?: string;
  isLocal: boolean;
  source: "local" | "ssh_config" | "tailscale";
  tailscaleIp?: string;
  isControlServer?: boolean;
  reachable?: boolean;
  hasHeadscaleHint?: boolean;
}

export interface ServerConfig {
  hostAlias: string;
  hostName: string;
  user?: string;
  port?: number;
  identityFile?: string;
  isLocal: boolean;
  serverTailscaleIp?: string;
  serverRemoteHostname?: string;
  deployMode: HeadscaleDeployMode;
  policyMode: HeadscalePolicyMode;
  // Native details
  headscaleBin?: string;
  headscaleVersion?: string;
  headscaleInstaller?: NativeInstallerKind;
  headscaleInstallerDetail?: string;
  serviceUnit?: string;
  useSudo?: boolean;
  sudoUser?: string;
  // Container details
  containerRuntime?: "docker" | "podman";
  containerName?: string;
  containerDir?: string; // Host folder selected by user
  // Paths on server
  configPath: string;
  aclPath?: string;
  taclStatePath: string;
}

export interface LocalAppConfig {
  version: 1;
  server?: ServerConfig;
}
