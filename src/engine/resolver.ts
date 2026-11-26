import type {
  ConnectionRule,
  Device,
  Direction,
  EffectiveConnection,
  HeadscaleUser,
  Profile,
  ProfileConflict,
  ProtectedSshLink,
  Protocol,
  TaclState,
} from "../types/model.ts";

export function makePairKey(idA: string, idB: string): string {
  return idA <= idB ? `${idA}::${idB}` : `${idB}::${idA}`;
}

export function flipDirection(dir: Direction): Direction {
  if (dir === "a_to_b") return "b_to_a";
  if (dir === "b_to_a") return "a_to_b";
  return dir;
}

export function normalizePorts(ports: string[]): string[] {
  const cleaned = ports
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (cleaned.length === 0 || cleaned.includes("*")) {
    return ["*"];
  }
  return Array.from(new Set(cleaned)).sort((a, b) => {
    const numA = parseInt(a.split("-")[0] ?? "0", 10);
    const numB = parseInt(b.split("-")[0] ?? "0", 10);
    return numA - numB || a.localeCompare(b);
  });
}

export function validatePortSpec(spec: string): { valid: boolean; error?: string } {
  const trimmed = spec.trim();
  if (trimmed === "*") return { valid: true };
  const rangeMatch = /^(\d+)-(\d+)$/.exec(trimmed);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (start < 1 || end > 65535 || start > end) {
      return { valid: false, error: "Rango inválido (usa 1-65535 con inicio <= fin)" };
    }
    return { valid: true };
  }
  if (/^\d+$/.test(trimmed)) {
    const port = Number(trimmed);
    if (port < 1 || port > 65535) {
      return { valid: false, error: "Puerto fuera de rango (1-65535)" };
    }
    return { valid: true };
  }
  return { valid: false, error: "Formato inválido (usa *, número como 22 o rango 8000-8080)" };
}

export function directionArrow(dir: Direction): string {
  switch (dir) {
    case "both":
      return "↔";
    case "a_to_b":
      return "→";
    case "b_to_a":
      return "←";
    case "deny":
      return "✕";
  }
}

export function protocolLabel(proto: Protocol): string {
  switch (proto) {
    case "tcp":
      return "TCP";
    case "udp":
      return "UDP";
    case "both":
      return "Ambos";
  }
}

export function portsLabel(ports: string[]): string {
  const norm = normalizePorts(ports);
  return norm.join(", ");
}

function getCanonicalDirection(
  rule: ConnectionRule,
  canonicalA: string,
  canonicalB: string
): Direction {
  if (rule.sourceId === rule.targetId) {
    // Intra-entity rule (same profile or same user): directional becomes symmetric
    if (rule.direction === "deny") return "deny";
    return "both";
  }
  if (rule.sourceId === canonicalA && rule.targetId === canonicalB) {
    return rule.direction;
  }
  if (rule.sourceId === canonicalB && rule.targetId === canonicalA) {
    return flipDirection(rule.direction);
  }
  return rule.direction;
}

function rulesAreEquivalent(
  a: { effectiveDirection: Direction; protocol: Protocol; ports: string[] },
  b: { effectiveDirection: Direction; protocol: Protocol; ports: string[] }
): boolean {
  if (a.effectiveDirection !== b.effectiveDirection) return false;
  if (a.effectiveDirection === "deny") return true; // Both deny regardless of proto/ports
  if (a.protocol !== b.protocol) return false;
  const portsA = normalizePorts(a.ports);
  const portsB = normalizePorts(b.ports);
  return portsA.length === portsB.length && portsA.every((p, idx) => p === portsB[idx]);
}

export function portMatchesNumber(ports: string[], targetPort: number): boolean {
  const norm = normalizePorts(ports);
  if (norm.includes("*")) return true;
  for (const spec of norm) {
    if (spec.includes("-")) {
      const [s, e] = spec.split("-").map(Number);
      if (s !== undefined && e !== undefined && targetPort >= s && targetPort <= e) {
        return true;
      }
    } else if (Number(spec) === targetPort) {
      return true;
    }
  }
  return false;
}

export function isProtectedSshPair(
  idA: string,
  idB: string,
  protectedSsh?: ProtectedSshLink
): boolean {
  if (
    !protectedSsh ||
    protectedSsh.localDeviceId === protectedSsh.serverDeviceId
  ) {
    return false;
  }
  return (
    (idA === protectedSsh.localDeviceId && idB === protectedSsh.serverDeviceId) ||
    (idB === protectedSsh.localDeviceId && idA === protectedSsh.serverDeviceId)
  );
}

/**
 * Checks if a rule on (sourceId, targetId) allows localDevice -> serverDevice over TCP/<sshPort>.
 */
export function allowsProtectedSshFlow(
  sourceId: string,
  targetId: string,
  direction: Direction,
  protocol: Protocol,
  ports: string[],
  protectedSsh?: ProtectedSshLink
): boolean {
  if (!protectedSsh || !isProtectedSshPair(sourceId, targetId, protectedSsh)) {
    return true;
  }
  const localIsSource = sourceId === protectedSsh.localDeviceId;
  const dirAllows =
    direction === "both" ||
    (localIsSource && direction === "a_to_b") ||
    (!localIsSource && direction === "b_to_a");
  if (!dirAllows) return false;
  const protoAllows = protocol === "tcp" || protocol === "both";
  if (!protoAllows) return false;
  return portMatchesNumber(ports, protectedSsh.sshPort);
}

export interface ResolutionResult {
  connections: EffectiveConnection[];
  conflicts: ProfileConflict[];
}

/**
 * Resolves the effective connection state for every unique pair of devices
 * using strict precedence:
 *   1. Device rule (absolute weight)
 *   2. Profile rule (tacl-managed; detects multi-profile conflicts)
 *   3. User rule (Headscale users)
 *   4. Default policy (passthrough or deny)
 *
 * When `protectedSsh` is provided, guarantees that the SSH management channel
 * from localDevice -> serverDevice over TCP/<sshPort> is always flagged and preserved.
 */
export function resolveEffectiveConnections(
  devices: Device[],
  users: HeadscaleUser[],
  state: TaclState,
  protectedSsh?: ProtectedSshLink
): ResolutionResult {
  const sortedDevices = [...devices].sort((a, b) => a.id.localeCompare(b.id));
  const profileMap = new Map<string, Profile>(state.profiles.map((p) => [p.id, p]));
  const userMap = new Map<string, HeadscaleUser>(users.map((u) => [u.id, u]));

  // Precompute which profiles each device belongs to
  const deviceProfiles = new Map<string, Set<string>>();
  for (const d of sortedDevices) {
    deviceProfiles.set(d.id, new Set<string>());
  }
  for (const profile of state.profiles) {
    for (const devId of profile.deviceIds) {
      deviceProfiles.get(devId)?.add(profile.id);
    }
  }

  const deviceRules = state.rules.filter((r) => r.scope === "device");
  const profileRules = state.rules.filter((r) => r.scope === "profile");
  const userRules = state.rules.filter((r) => r.scope === "user");

  const resolutionMap = new Map<string, string>(
    state.conflictResolutions.map((cr) => [cr.pairKey, cr.winningRuleId])
  );

  const connections: EffectiveConnection[] = [];
  const conflicts: ProfileConflict[] = [];

  for (let i = 0; i < sortedDevices.length; i++) {
    for (let j = i + 1; j < sortedDevices.length; j++) {
      const devA = sortedDevices[i]!;
      const devB = sortedDevices[j]!;
      const pairKey = makePairKey(devA.id, devB.id);
      const nameA = devA.givenName || devA.name;
      const nameB = devB.givenName || devB.name;

      // 1. Level 1: Device <-> Device (absolute weight)
      const matchingDevRule = deviceRules.find(
        (r) =>
          (r.sourceId === devA.id && r.targetId === devB.id) ||
          (r.sourceId === devB.id && r.targetId === devA.id)
      );

      if (matchingDevRule) {
        const dir = getCanonicalDirection(matchingDevRule, devA.id, devB.id);
        connections.push({
          pairKey,
          deviceAId: devA.id,
          deviceBId: devB.id,
          deviceAName: nameA,
          deviceBName: nameB,
          direction: dir,
          protocol: matchingDevRule.protocol,
          ports: normalizePorts(matchingDevRule.ports),
          origin: {
            kind: "device",
            ruleId: matchingDevRule.id,
            label: "Dispositivo",
          },
          hasConflict: false,
        });
        continue;
      }

      // 2. Level 2: Profile <-> Profile (multi-profile aware)
      const profsA = deviceProfiles.get(devA.id) ?? new Set<string>();
      const profsB = deviceProfiles.get(devB.id) ?? new Set<string>();

      const matchingProfileEntries: Array<{
        rule: ConnectionRule;
        effectiveDirection: Direction;
        sourceProfileName: string;
        targetProfileName: string;
      }> = [];

      for (const r of profileRules) {
        const srcName = profileMap.get(r.sourceId)?.name ?? r.sourceId;
        const dstName = profileMap.get(r.targetId)?.name ?? r.targetId;

        if (r.sourceId === r.targetId) {
          // Intra-profile rule: both devices must be members of this profile
          if (profsA.has(r.sourceId) && profsB.has(r.sourceId)) {
            matchingProfileEntries.push({
              rule: r,
              effectiveDirection: r.direction === "deny" ? "deny" : "both",
              sourceProfileName: srcName,
              targetProfileName: dstName,
            });
          }
        } else {
          const forwardMatch = profsA.has(r.sourceId) && profsB.has(r.targetId);
          const reverseMatch = profsB.has(r.sourceId) && profsA.has(r.targetId);

          if (forwardMatch && reverseMatch) {
            // Both devices belong to both profiles
            const effDir: Direction =
              r.direction === "deny" ? "deny" : "both";
            matchingProfileEntries.push({
              rule: r,
              effectiveDirection: effDir,
              sourceProfileName: srcName,
              targetProfileName: dstName,
            });
          } else if (forwardMatch) {
            matchingProfileEntries.push({
              rule: r,
              effectiveDirection: r.direction,
              sourceProfileName: srcName,
              targetProfileName: dstName,
            });
          } else if (reverseMatch) {
            matchingProfileEntries.push({
              rule: r,
              effectiveDirection: flipDirection(r.direction),
              sourceProfileName: srcName,
              targetProfileName: dstName,
            });
          }
        }
      }

      if (matchingProfileEntries.length === 1) {
        const match = matchingProfileEntries[0]!;
        connections.push({
          pairKey,
          deviceAId: devA.id,
          deviceBId: devB.id,
          deviceAName: nameA,
          deviceBName: nameB,
          direction: match.effectiveDirection,
          protocol: match.rule.protocol,
          ports: normalizePorts(match.rule.ports),
          origin: {
            kind: "profile",
            ruleId: match.rule.id,
            label: `Perfil (${match.sourceProfileName}↔${match.targetProfileName})`,
          },
          hasConflict: false,
        });
        continue;
      }

      if (matchingProfileEntries.length > 1) {
        const first = matchingProfileEntries[0]!;
        const allAgree = matchingProfileEntries.slice(1).every((entry) =>
          rulesAreEquivalent(
            {
              effectiveDirection: first.effectiveDirection,
              protocol: first.rule.protocol,
              ports: first.rule.ports,
            },
            {
              effectiveDirection: entry.effectiveDirection,
              protocol: entry.rule.protocol,
              ports: entry.rule.ports,
            }
          )
        );

        if (allAgree) {
          connections.push({
            pairKey,
            deviceAId: devA.id,
            deviceBId: devB.id,
            deviceAName: nameA,
            deviceBName: nameB,
            direction: first.effectiveDirection,
            protocol: first.rule.protocol,
            ports: normalizePorts(first.rule.ports),
            origin: {
              kind: "profile",
              ruleId: first.rule.id,
              label: `Perfil (${first.sourceProfileName})`,
            },
            hasConflict: false,
          });
          continue;
        }

        // Real conflict! Check if the user has already picked a winning rule for this pair
        const chosenRuleId = resolutionMap.get(pairKey);
        const chosenEntry = chosenRuleId
          ? matchingProfileEntries.find((e) => e.rule.id === chosenRuleId)
          : undefined;

        if (chosenEntry) {
          connections.push({
            pairKey,
            deviceAId: devA.id,
            deviceBId: devB.id,
            deviceAName: nameA,
            deviceBName: nameB,
            direction: chosenEntry.effectiveDirection,
            protocol: chosenEntry.rule.protocol,
            ports: normalizePorts(chosenEntry.rule.ports),
            origin: {
              kind: "profile",
              ruleId: chosenEntry.rule.id,
              label: `Perfil* (${chosenEntry.sourceProfileName}↔${chosenEntry.targetProfileName})`,
              resolvedConflict: true,
            },
            hasConflict: false,
          });
          continue;
        }

        // Unresolved conflict -> surface to user
        conflicts.push({
          pairKey,
          deviceAId: devA.id,
          deviceBId: devB.id,
          competingRules: matchingProfileEntries,
        });

        connections.push({
          pairKey,
          deviceAId: devA.id,
          deviceBId: devB.id,
          deviceAName: nameA,
          deviceBName: nameB,
          direction: "deny",
          protocol: "both",
          ports: ["*"],
          origin: {
            kind: "conflict",
            label: "⚠ Conflicto de perfiles",
          },
          hasConflict: true,
        });
        continue;
      }

      // 3. Level 3: User <-> User (Headscale users)
      const matchingUserRule = userRules.find((r) => {
        if (r.sourceId === r.targetId) {
          return devA.userId === r.sourceId && devB.userId === r.sourceId;
        }
        return (
          (r.sourceId === devA.userId && r.targetId === devB.userId) ||
          (r.sourceId === devB.userId && r.targetId === devA.userId)
        );
      });

      if (matchingUserRule) {
        const dir = getCanonicalDirection(matchingUserRule, devA.userId, devB.userId);
        const srcUser = userMap.get(matchingUserRule.sourceId)?.name ?? matchingUserRule.sourceId;
        const dstUser = userMap.get(matchingUserRule.targetId)?.name ?? matchingUserRule.targetId;
        connections.push({
          pairKey,
          deviceAId: devA.id,
          deviceBId: devB.id,
          deviceAName: nameA,
          deviceBName: nameB,
          direction: dir,
          protocol: matchingUserRule.protocol,
          ports: normalizePorts(matchingUserRule.ports),
          origin: {
            kind: "user",
            ruleId: matchingUserRule.id,
            label: srcUser === dstUser ? `Usuario (${srcUser})` : `Usuario (${srcUser}↔${dstUser})`,
          },
          hasConflict: false,
        });
        continue;
      }

      // 4. Level 4: Default policy
      if (state.defaultPolicy === "passthrough") {
        connections.push({
          pairKey,
          deviceAId: devA.id,
          deviceBId: devB.id,
          deviceAName: nameA,
          deviceBName: nameB,
          direction: "both",
          protocol: "both",
          ports: ["*"],
          origin: {
            kind: "default",
            label: "Sin restricción",
          },
          hasConflict: false,
        });
      } else {
        connections.push({
          pairKey,
          deviceAId: devA.id,
          deviceBId: devB.id,
          deviceAName: nameA,
          deviceBName: nameB,
          direction: "deny",
          protocol: "both",
          ports: ["*"],
          origin: {
            kind: "default",
            label: "Default (Bloqueado)",
          },
          hasConflict: false,
        });
      }
    }
  }

  // Apply SSH management protection overlay on the (localDevice, serverDevice) pair
  if (protectedSsh && protectedSsh.localDeviceId !== protectedSsh.serverDeviceId) {
    for (const conn of connections) {
      if (!isProtectedSshPair(conn.deviceAId, conn.deviceBId, protectedSsh)) {
        continue;
      }
      conn.isSshProtected = true;
      const alreadyAllows = allowsProtectedSshFlow(
        conn.deviceAId,
        conn.deviceBId,
        conn.direction,
        conn.protocol,
        conn.ports,
        protectedSsh
      );
      if (!alreadyAllows) {
        conn.sshFallbackInjected = true;
        const localIsA = conn.deviceAId === protectedSsh.localDeviceId;
        if (conn.direction === "deny") {
          conn.direction = localIsA ? "a_to_b" : "b_to_a";
          conn.protocol = "tcp";
          conn.ports = [String(protectedSsh.sshPort)];
          conn.origin = {
            kind: "protected",
            label: `🛡 Protección SSH:${protectedSsh.sshPort}`,
          };
        } else {
          conn.origin = {
            ...conn.origin,
            label: `${conn.origin.label} +🛡SSH:${protectedSsh.sshPort}`,
          };
        }
      }
    }
  }

  return { connections, conflicts };
}

/**
 * Checks whether a rule already exists for a pair within the same scope.
 */
export function findExistingRule(
  rules: ConnectionRule[],
  scope: ConnectionRule["scope"],
  idA: string,
  idB: string
): ConnectionRule | undefined {
  return rules.find(
    (r) =>
      r.scope === scope &&
      ((r.sourceId === idA && r.targetId === idB) ||
        (r.sourceId === idB && r.targetId === idA))
  );
}
