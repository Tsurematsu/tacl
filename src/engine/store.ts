import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import YAML from "yaml";
import type { LocalAppConfig, TabId, TaclState } from "../types/model.ts";

export function getLocalConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, "tacl") : join(homedir(), ".config", "tacl");
}

export function getLocalConfigPath(): string {
  return join(getLocalConfigDir(), "config.json");
}

export function getLocalStatePath(hostAlias: string, baseDir?: string): string {
  const safeAlias = hostAlias.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(baseDir ?? getLocalConfigDir(), "state", `${safeAlias}-tacl.yaml`);
}

export function getLocalStateBackupPath(hostAlias: string): string {
  const safeAlias = hostAlias.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(getLocalConfigDir(), "backups", `${safeAlias}-tacl.yaml`);
}

export function createEmptyState(
  defaultPolicy: TaclState["defaultPolicy"] = "passthrough",
  initialized = false
): TaclState {
  return {
    version: 1,
    initialized,
    defaultPolicy,
    profiles: [],
    rules: [],
    conflictResolutions: [],
  };
}

export function serializeTaclState(state: TaclState): string {
  return YAML.stringify(state, { indent: 2 });
}

const VALID_TABS: TabId[] = ["devices", "profiles", "users", "direct"];

export function deserializeTaclState(raw: string): TaclState {
  const parsed = YAML.parse(raw) as Partial<TaclState> | null;
  if (!parsed || typeof parsed !== "object") {
    return createEmptyState("passthrough", false);
  }
  const rawUi = parsed.uiState;
  const uiState =
    rawUi && typeof rawUi === "object"
      ? {
          activeTab:
            rawUi.activeTab && VALID_TABS.includes(rawUi.activeTab)
              ? rawUi.activeTab
              : undefined,
          hasUnappliedChanges: Boolean(rawUi.hasUnappliedChanges),
          updatedAt:
            typeof rawUi.updatedAt === "string" ? rawUi.updatedAt : undefined,
        }
      : undefined;

  return {
    version: 1,
    initialized: Boolean(parsed.initialized),
    defaultPolicy: parsed.defaultPolicy === "deny" ? "deny" : "passthrough",
    profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    conflictResolutions: Array.isArray(parsed.conflictResolutions)
      ? parsed.conflictResolutions
      : [],
    ...(uiState ? { uiState } : {}),
  };
}

export async function loadLocalConfig(customPath?: string): Promise<LocalAppConfig> {
  const path = customPath ?? getLocalConfigPath();
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as LocalAppConfig;
    if (parsed && parsed.version === 1) {
      return parsed;
    }
  } catch {
    // File does not exist yet
  }
  return { version: 1 };
}

export async function saveLocalConfig(
  config: LocalAppConfig,
  customPath?: string
): Promise<void> {
  const path = customPath ?? getLocalConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export async function loadLocalState(
  hostAlias: string,
  baseDir?: string
): Promise<{ state: TaclState; existed: boolean }> {
  const path = getLocalStatePath(hostAlias, baseDir);
  try {
    const raw = await readFile(path, "utf8");
    if (raw.trim()) {
      return { state: deserializeTaclState(raw), existed: true };
    }
  } catch {
    // Local state does not exist yet
  }
  return { state: createEmptyState("passthrough", false), existed: false };
}

export async function saveLocalState(
  hostAlias: string,
  state: TaclState,
  baseDir?: string
): Promise<string> {
  const path = getLocalStatePath(hostAlias, baseDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeTaclState(state), "utf8");
  return path;
}

export async function saveLocalStateBackup(
  hostAlias: string,
  state: TaclState
): Promise<string> {
  const path = getLocalStateBackupPath(hostAlias);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeTaclState(state), "utf8");
  return path;
}
