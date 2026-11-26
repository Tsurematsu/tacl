import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SshConfigEntry {
  alias: string;
  hostName: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

function expandHome(path: string): string {
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function parseSshConfigContent(content: string): SshConfigEntry[] {
  const entries: SshConfigEntry[] = [];
  let currentHosts: string[] = [];
  let currentProps: {
    hostName?: string;
    user?: string;
    port?: number;
    identityFile?: string;
  } = {};
  let inMatchBlock = false;

  const flush = () => {
    if (inMatchBlock || currentHosts.length === 0) return;
    for (const host of currentHosts) {
      // Skip wildcards or negated patterns
      if (host.includes("*") || host.includes("?") || host.startsWith("!")) {
        continue;
      }
      entries.push({
        alias: host,
        hostName: currentProps.hostName ?? host,
        user: currentProps.user,
        port: currentProps.port,
        identityFile: currentProps.identityFile
          ? expandHome(currentProps.identityFile)
          : undefined,
      });
    }
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const match = /^([A-Za-z]+)\s*=?\s*(.+)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const val = match[2]!.trim().replace(/^"(.*)"$/, "$1");

    if (key === "host") {
      flush();
      inMatchBlock = false;
      currentHosts = val.split(/\s+/).filter(Boolean);
      currentProps = {};
    } else if (key === "match") {
      flush();
      inMatchBlock = true;
      currentHosts = [];
      currentProps = {};
    } else if (!inMatchBlock && currentHosts.length > 0) {
      if (key === "hostname") currentProps.hostName = val;
      else if (key === "user") currentProps.user = val;
      else if (key === "port") {
        const parsed = parseInt(val, 10);
        if (!Number.isNaN(parsed)) currentProps.port = parsed;
      } else if (key === "identityfile" && !currentProps.identityFile) {
        currentProps.identityFile = val;
      }
    }
  }

  flush();
  return entries;
}

export async function readUserSshConfig(): Promise<SshConfigEntry[]> {
  try {
    const raw = await readFile(join(homedir(), ".ssh", "config"), "utf8");
    return parseSshConfigContent(raw);
  } catch {
    return [];
  }
}
