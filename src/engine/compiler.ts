import { parse as parseJsonc } from "jsonc-parser";
import type {
  CompileResult,
  HeadscaleAclEntry,
  HeadscalePolicy,
  LockoutWarning,
} from "../types/headscale.ts";
import type {
  Device,
  EffectiveConnection,
  HeadscaleUser,
  ProtectedSshLink,
  Protocol,
  TaclState,
} from "../types/model.ts";
import {
  allowsProtectedSshFlow,
  normalizePorts,
  portMatchesNumber,
  resolveEffectiveConnections,
} from "./resolver.ts";

export interface CompileOptions {
  existingPolicyRaw?: string;
  localDeviceId?: string;
  serverDeviceId?: string;
  sshPort?: number;
}

function sanitizeHostName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "node";
}

function getPrimaryIpv4(device: Device): string | undefined {
  return (
    device.ipAddresses.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) ??
    device.ipAddresses[0]
  );
}

export function parseHujsonPolicy(raw?: string): HeadscalePolicy {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  const errors: unknown[] = [];
  const parsed = parseJsonc(raw, errors as never, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as HeadscalePolicy;
  }
  return {};
}

interface RawFlow {
  src: string;
  dst: string;
  proto?: string;
  ports: string;
}

function expandFlows(
  srcHost: string,
  dstHost: string,
  protocol: Protocol,
  ports: string[]
): RawFlow[] {
  const norm = normalizePorts(ports);
  const portExpr = norm.join(",");

  if (protocol === "tcp") {
    return [{ src: srcHost, dst: dstHost, proto: "tcp", ports: portExpr }];
  }
  if (protocol === "udp") {
    return [{ src: srcHost, dst: dstHost, proto: "udp", ports: portExpr }];
  }
  // protocol === "both"
  if (norm.length === 1 && norm[0] === "*") {
    // Omit proto so TCP, UDP, and ICMP all work cleanly
    return [{ src: srcHost, dst: dstHost, ports: "*" }];
  }
  // Specific ports with "both": emit TCP and UDP explicitly
  return [
    { src: srcHost, dst: dstHost, proto: "tcp", ports: portExpr },
    { src: srcHost, dst: dstHost, proto: "udp", ports: portExpr },
  ];
}

/**
 * Compacts individual flows by grouping identical (proto, dst:ports) under shared src[],
 * then grouping identical (proto, src[]) under shared dst[].
 */
function compactFlows(flows: RawFlow[]): HeadscaleAclEntry[] {
  // Pass 1: group by (proto, dst:ports) -> Set<src>
  const byProtoDst = new Map<string, { proto?: string; dst: string; srcs: Set<string> }>();
  for (const f of flows) {
    const dstSpec = `${f.dst}:${f.ports}`;
    const key = `${f.proto ?? ""}||${dstSpec}`;
    let bucket = byProtoDst.get(key);
    if (!bucket) {
      bucket = { proto: f.proto, dst: dstSpec, srcs: new Set() };
      byProtoDst.set(key, bucket);
    }
    bucket.srcs.add(f.src);
  }

  // Pass 2: group by (proto, sorted src[]) -> Set<dstSpec>
  const byProtoSrcs = new Map<
    string,
    { proto?: string; srcs: string[]; dsts: Set<string> }
  >();
  for (const bucket of byProtoDst.values()) {
    const sortedSrcs = Array.from(bucket.srcs).sort();
    const key = `${bucket.proto ?? ""}||${sortedSrcs.join(",")}`;
    let entry = byProtoSrcs.get(key);
    if (!entry) {
      entry = { proto: bucket.proto, srcs: sortedSrcs, dsts: new Set() };
      byProtoSrcs.set(key, entry);
    }
    entry.dsts.add(bucket.dst);
  }

  const acls: HeadscaleAclEntry[] = [];
  const sortedEntries = Array.from(byProtoSrcs.values()).sort((a, b) => {
    const pa = a.proto ?? "";
    const pb = b.proto ?? "";
    return pa.localeCompare(pb) || a.srcs.join(",").localeCompare(b.srcs.join(","));
  });

  for (const item of sortedEntries) {
    const acl: HeadscaleAclEntry = {
      action: "accept",
      src: item.srcs,
      dst: Array.from(item.dsts).sort(),
    };
    if (item.proto) {
      acl.proto = item.proto;
    }
    acls.push(acl);
  }

  return acls;
}

export function checkLockoutRisk(
  connections: EffectiveConnection[],
  devices: Device[],
  localDeviceId?: string,
  serverDeviceId?: string,
  sshPort = 22
): LockoutWarning[] {
  const warnings: LockoutWarning[] = [];
  if (!localDeviceId || !serverDeviceId || localDeviceId === serverDeviceId) {
    return warnings;
  }

  const conn = connections.find(
    (c) =>
      (c.deviceAId === localDeviceId && c.deviceBId === serverDeviceId) ||
      (c.deviceBId === localDeviceId && c.deviceAId === serverDeviceId)
  );

  if (!conn) return warnings;

  const localDev = devices.find((d) => d.id === localDeviceId);
  const serverDev = devices.find((d) => d.id === serverDeviceId);
  const localName = localDev?.givenName || localDev?.name || localDeviceId;
  const serverName = serverDev?.givenName || serverDev?.name || serverDeviceId;

  const localIsA = conn.deviceAId === localDeviceId;
  const localCanReachServer =
    conn.direction === "both" ||
    (localIsA && conn.direction === "a_to_b") ||
    (!localIsA && conn.direction === "b_to_a");

  if (!localCanReachServer) {
    warnings.push({
      severity: "critical",
      localDeviceName: localName,
      serverDeviceName: serverName,
      message: `¡ALERTA ANTI-LOCKOUT! Tu equipo (${localName}) perdería acceso hacia el servidor Headscale (${serverName}).`,
    });
    return warnings;
  }

  const allowsTcp = conn.protocol === "tcp" || conn.protocol === "both";
  const allowsSshPort = portMatchesNumber(conn.ports, sshPort);
  if (!allowsTcp || !allowsSshPort) {
    warnings.push({
      severity: "warning",
      localDeviceName: localName,
      serverDeviceName: serverName,
      message: `Advertencia: la regla hacia ${serverName} no incluye TCP/${sshPort}; podrías perder tu conexión SSH por Tailscale.`,
    });
  }

  return warnings;
}

export function compileToHeadscalePolicy(
  devices: Device[],
  users: HeadscaleUser[],
  state: TaclState,
  options: CompileOptions = {}
): CompileResult {
  const basePolicy = parseHujsonPolicy(options.existingPolicyRaw);
  const sshPort = options.sshPort ?? 22;
  const protectedSsh: ProtectedSshLink | undefined =
    options.localDeviceId &&
    options.serverDeviceId &&
    options.localDeviceId !== options.serverDeviceId
      ? {
          localDeviceId: options.localDeviceId,
          serverDeviceId: options.serverDeviceId,
          sshPort,
        }
      : undefined;

  // Check raw resolution BEFORE protection so we know if protection had to step in
  const rawResolution = resolveEffectiveConnections(devices, users, state);
  const { connections } = resolveEffectiveConnections(
    devices,
    users,
    state,
    protectedSsh
  );

  // Safe passthrough: if no rules are defined yet and defaultPolicy is passthrough,
  // keep existing Headscale policy untouched (or a clean allow-all default if empty).
  if (state.rules.length === 0 && state.defaultPolicy === "passthrough") {
    const preserved: HeadscalePolicy =
      Object.keys(basePolicy).length > 0
        ? { ...basePolicy }
        : {
            acls: [{ action: "accept", src: ["*"], dst: ["*:*"] }],
          };
    const header =
      "// Gestionado por tacl (modo sin restricciones adicionales: aún no hay reglas definidas)\n";
    const hujson = header + JSON.stringify(preserved, null, 2) + "\n";

    return {
      policy: preserved,
      hujson,
      isPassthrough: true,
      protectedSshApplied: false,
      warnings: [],
      stats: {
        hostCount: Object.keys(preserved.hosts ?? {}).length,
        aclRuleCount: preserved.acls?.length ?? 0,
        allowedPairs: connections.length,
        blockedPairs: 0,
      },
    };
  }

  // Build unique host aliases for all managed devices
  const deviceHostAlias = new Map<string, string>();
  const usedAliases = new Set<string>();
  const managedHosts: Record<string, string> = {};

  const sortedDevices = [...devices].sort((a, b) => a.id.localeCompare(b.id));
  for (const dev of sortedDevices) {
    const ip = getPrimaryIpv4(dev);
    if (!ip) continue;

    const baseAlias = sanitizeHostName(dev.givenName || dev.name);
    let alias = baseAlias;
    let counter = 2;
    while (usedAliases.has(alias)) {
      alias = `${baseAlias}-${counter++}`;
    }
    usedAliases.add(alias);
    deviceHostAlias.set(dev.id, alias);
    managedHosts[alias] = ip;
  }

  // Preserve custom hosts from existing policy that do not collide with managed IPs/aliases
  const mergedHosts: Record<string, string> = {};
  const managedIps = new Set(Object.values(managedHosts));
  if (basePolicy.hosts && typeof basePolicy.hosts === "object") {
    for (const [k, v] of Object.entries(basePolicy.hosts)) {
      if (!usedAliases.has(k) && !managedIps.has(v)) {
        mergedHosts[k] = v;
      }
    }
  }
  for (const [k, v] of Object.entries(managedHosts)) {
    mergedHosts[k] = v;
  }

  // Convert resolved connections into flows
  const flows: RawFlow[] = [];
  let allowedPairs = 0;
  let blockedPairs = 0;

  for (const conn of connections) {
    const hostA = deviceHostAlias.get(conn.deviceAId);
    const hostB = deviceHostAlias.get(conn.deviceBId);
    if (!hostA || !hostB) continue;

    if (conn.direction === "deny") {
      blockedPairs++;
      continue;
    }

    allowedPairs++;
    if (conn.direction === "a_to_b" || conn.direction === "both") {
      flows.push(...expandFlows(hostA, hostB, conn.protocol, conn.ports));
    }
    if (conn.direction === "b_to_a" || conn.direction === "both") {
      flows.push(...expandFlows(hostB, hostA, conn.protocol, conn.ports));
    }
  }

  // Enforce hard SSH management protection: ALWAYS guarantee local -> server TCP/<sshPort>
  let protectedSshApplied = false;
  const warnings: LockoutWarning[] = [];

  if (protectedSsh) {
    const localHost = deviceHostAlias.get(protectedSsh.localDeviceId);
    const serverHost = deviceHostAlias.get(protectedSsh.serverDeviceId);

    const rawConn = rawResolution.connections.find(
      (c) =>
        (c.deviceAId === protectedSsh.localDeviceId &&
          c.deviceBId === protectedSsh.serverDeviceId) ||
        (c.deviceBId === protectedSsh.localDeviceId &&
          c.deviceAId === protectedSsh.serverDeviceId)
    );

    const rawAllowedSsh = rawConn
      ? allowsProtectedSshFlow(
          rawConn.deviceAId,
          rawConn.deviceBId,
          rawConn.direction,
          rawConn.protocol,
          rawConn.ports,
          protectedSsh
        )
      : false;

    if (localHost && serverHost && !rawAllowedSsh) {
      flows.push({
        src: localHost,
        dst: serverHost,
        proto: "tcp",
        ports: String(sshPort),
      });
      protectedSshApplied = true;
      const localDev = devices.find((d) => d.id === protectedSsh.localDeviceId);
      const serverDev = devices.find((d) => d.id === protectedSsh.serverDeviceId);
      const localName = localDev?.givenName || localDev?.name || localHost;
      const serverName = serverDev?.givenName || serverDev?.name || serverHost;
      warnings.push({
        severity: "warning",
        localDeviceName: localName,
        serverDeviceName: serverName,
        message: `🛡 Protección SSH activa: se conservó automáticamente TCP/${sshPort} desde "${localName}" → "${serverName}" para no perder acceso SSH.`,
      });
    }
  }

  const acls = compactFlows(flows);

  // Preserve all extra sections from basePolicy (groups, tagOwners, autoApprovers, ssh, etc.)
  const { hosts: _oldHosts, acls: _oldAcls, ...preservedExtras } = basePolicy;
  const policy: HeadscalePolicy = {
    ...preservedExtras,
    hosts: mergedHosts,
    acls,
  };

  const header = [
    "// Política compilada automáticamente por tacl",
    `// Precedencia: Dispositivo > Perfil > Usuario (modo base: ${state.defaultPolicy})`,
    ...(protectedSshApplied
      ? [`// Protección SSH activa: acceso TCP/${sshPort} garantizado hacia el servidor Headscale`]
      : []),
    "",
  ].join("\n");

  const hujson = header + JSON.stringify(policy, null, 2) + "\n";

  return {
    policy,
    hujson,
    isPassthrough: false,
    protectedSshApplied,
    warnings,
    stats: {
      hostCount: Object.keys(mergedHosts).length,
      aclRuleCount: acls.length,
      allowedPairs,
      blockedPairs,
    },
  };
}

/**
 * Simple line-based diff between existing policy and compiled HuJSON for TUI preview.
 */
export interface DiffLine {
  kind: "same" | "add" | "remove";
  text: string;
}

export function computeSimpleDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    const a = oldLines[i];
    const b = newLines[j];

    if (a === b && a !== undefined) {
      result.push({ kind: "same", text: a });
      i++;
      j++;
    } else if (a !== undefined && !newSet.has(a)) {
      result.push({ kind: "remove", text: a });
      i++;
    } else if (b !== undefined && !oldSet.has(b)) {
      result.push({ kind: "add", text: b });
      j++;
    } else if (a !== undefined) {
      result.push({ kind: "remove", text: a });
      i++;
    } else if (b !== undefined) {
      result.push({ kind: "add", text: b });
      j++;
    }
  }

  return result;
}
