import type { SshHostCandidate } from "../types/model.ts";
import { readUserSshConfig } from "./config-parser.ts";
import { execOnTarget, spawnWithTimeout } from "./executor.ts";

export interface LocalTailscaleInfo {
  available: boolean;
  selfHostName?: string;
  selfIp?: string;
  controlHost?: string;
  peers: Array<{
    hostName: string;
    dnsName?: string;
    ip?: string;
    online: boolean;
  }>;
}

export async function getLocalTailscaleInfo(): Promise<LocalTailscaleInfo> {
  try {
    const res = await spawnWithTimeout(["tailscale", "status", "--json"], {
      timeoutMs: 4000,
    });
    if (res.exitCode !== 0 || !res.stdout.trim()) {
      return { available: false, peers: [] };
    }
    const parsed = JSON.parse(res.stdout) as {
      Self?: { HostName?: string; TailscaleIPs?: string[] };
      CurrentTailnet?: { Name?: string };
      Peer?: Record<
        string,
        {
          HostName?: string;
          DNSName?: string;
          TailscaleIPs?: string[];
          Online?: boolean;
        }
      >;
    };

    const peers: LocalTailscaleInfo["peers"] = [];
    if (parsed.Peer) {
      for (const peer of Object.values(parsed.Peer)) {
        if (!peer.HostName) continue;
        peers.push({
          hostName: peer.HostName,
          dnsName: peer.DNSName?.replace(/\.$/, ""),
          ip: peer.TailscaleIPs?.[0],
          online: Boolean(peer.Online),
        });
      }
    }

    // Try reading ControlURL from tailscale debug prefs if available
    let controlHost: string | undefined;
    try {
      const prefsRes = await spawnWithTimeout(["tailscale", "debug", "prefs"], {
        timeoutMs: 3000,
      });
      if (prefsRes.exitCode === 0 && prefsRes.stdout.trim()) {
        const prefs = JSON.parse(prefsRes.stdout) as { ControlURL?: string };
        if (prefs.ControlURL) {
          controlHost = new URL(prefs.ControlURL).hostname;
        }
      }
    } catch {
      // Optional hint
    }

    return {
      available: true,
      selfHostName: parsed.Self?.HostName,
      selfIp: parsed.Self?.TailscaleIPs?.[0],
      controlHost,
      peers,
    };
  } catch {
    return { available: false, peers: [] };
  }
}

export async function gatherHostCandidates(): Promise<{
  candidates: SshHostCandidate[];
  tailscaleInfo: LocalTailscaleInfo;
}> {
  const [sshEntries, tailscaleInfo] = await Promise.all([
    readUserSshConfig(),
    getLocalTailscaleInfo(),
  ]);

  const byKey = new Map<string, SshHostCandidate>();

  // 1. Check local machine on Unix systems (Linux/macOS)
  if (process.platform !== "win32") {
    byKey.set("localhost", {
      id: "localhost",
      alias: "localhost",
      hostName: "localhost",
      isLocal: true,
      source: "local",
    });
  }

  // 2. Add hosts from ~/.ssh/config
  for (const entry of sshEntries) {
    const key = entry.alias.toLowerCase();
    const isControl =
      Boolean(tailscaleInfo.controlHost) &&
      (entry.hostName === tailscaleInfo.controlHost ||
        entry.alias.toLowerCase() === tailscaleInfo.controlHost?.toLowerCase());

    byKey.set(key, {
      id: `ssh:${entry.alias}`,
      alias: entry.alias,
      hostName: entry.hostName,
      user: entry.user,
      port: entry.port,
      identityFile: entry.identityFile,
      isLocal: false,
      source: "ssh_config",
      isControlServer: isControl,
    });
  }

  // 3. Add Tailscale peers (enriching existing ssh_config entries if names/IPs match)
  for (const peer of tailscaleInfo.peers) {
    const key = peer.hostName.toLowerCase();
    const existing = Array.from(byKey.values()).find(
      (c) =>
        c.alias.toLowerCase() === key ||
        c.hostName.toLowerCase() === key ||
        (peer.ip && c.hostName === peer.ip)
    );

    const isControl =
      Boolean(tailscaleInfo.controlHost) &&
      (peer.hostName.toLowerCase() === tailscaleInfo.controlHost?.toLowerCase() ||
        peer.ip === tailscaleInfo.controlHost);

    if (existing) {
      existing.tailscaleIp = peer.ip;
      if (isControl) existing.isControlServer = true;
    } else if (peer.ip || peer.hostName) {
      byKey.set(key, {
        id: `ts:${peer.hostName}`,
        alias: peer.hostName,
        hostName: peer.ip ?? peer.hostName,
        isLocal: false,
        source: "tailscale",
        tailscaleIp: peer.ip,
        isControlServer: isControl,
      });
    }
  }

  return {
    candidates: Array.from(byKey.values()),
    tailscaleInfo,
  };
}

/**
 * Probes all candidate hosts in parallel using strict SSH key auth (BatchMode=yes).
 * Returns ONLY hosts that are truly reachable with the client's SSH keys (plus localhost).
 */
export async function discoverReachableHosts(
  onProgress?: (probed: number, total: number, current: string) => void
): Promise<{
  reachable: SshHostCandidate[];
  totalChecked: number;
  tailscaleInfo: LocalTailscaleInfo;
}> {
  const { candidates, tailscaleInfo } = await gatherHostCandidates();
  let completed = 0;

  const probeCmd = [
    "echo TACL_PROBE_OK",
    "(command -v headscale >/dev/null 2>&1 || [ -f /etc/headscale/config.yaml ]) && echo TACL_HS_HINT",
    "((docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null || sudo -n docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null || podman ps --format '{{.Names}} {{.Image}}' 2>/dev/null) | grep -iq headscale) && echo TACL_HS_HINT",
  ].join("; ");

  const results = await Promise.all(
    candidates.map(async (candidate) => {
      const res = await execOnTarget(
        {
          hostAlias: candidate.alias,
          hostName: candidate.hostName,
          user: candidate.user,
          port: candidate.port,
          identityFile: candidate.identityFile,
          isLocal: candidate.isLocal,
        },
        probeCmd,
        { timeoutMs: 5000, connectTimeoutSec: 3 }
      );

      completed++;
      onProgress?.(completed, candidates.length, candidate.alias);

      const ok = res.stdout.includes("TACL_PROBE_OK");
      if (!ok) {
        return null;
      }

      const found: SshHostCandidate = {
        ...candidate,
        reachable: true,
        hasHeadscaleHint: res.stdout.includes("TACL_HS_HINT"),
      };
      return found;
    })
  );

  const reachable: SshHostCandidate[] = results
    .filter((r): r is SshHostCandidate => r !== null)
    .sort((a, b) => {
      // Prioritize Headscale hints, then control server, then remote ssh_config, then localhost
      const score = (c: SshHostCandidate) =>
        (c.hasHeadscaleHint ? 10 : 0) +
        (c.isControlServer ? 5 : 0) +
        (c.source === "ssh_config" ? 2 : 0) +
        (c.isLocal ? 0 : 1);
      return score(b) - score(a) || a.alias.localeCompare(b.alias);
    });

  return {
    reachable,
    totalChecked: candidates.length,
    tailscaleInfo,
  };
}
