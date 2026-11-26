import { dirname, join } from "node:path";
import YAML from "yaml";
import {
  createEmptyState,
  deserializeTaclState,
  loadLocalState,
  saveLocalState,
  saveLocalStateBackup,
  serializeTaclState,
} from "../engine/store.ts";
import type {
  Device,
  HeadscalePolicyMode,
  HeadscaleUser,
  NativeInstallerKind,
  ServerConfig,
  TaclState,
} from "../types/model.ts";
import {
  execOnTarget,
  execSudoOnTarget,
  isPermissionError,
  readFileOnTarget,
  shellQuote,
  type SshTarget,
  writeFileOnTarget,
} from "./executor.ts";

export interface NativeDetectionResult {
  found: boolean;
  headscaleBin?: string;
  headscaleVersion?: string;
  headscaleInstaller: NativeInstallerKind;
  headscaleInstallerDetail: string;
  serviceUnit?: string;
  useSudo: boolean;
  sudoUser?: string;
  socketAccessible: boolean;
  configPath: string;
  policyMode: HeadscalePolicyMode;
  aclPath?: string;
  taclStatePath: string;
  message: string;
}

export interface ContainerHint {
  runtime: "docker" | "podman";
  containerName: string;
  image: string;
  suggestedDirs: string[];
}

export interface RemoteDirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface ContainerDirInspection {
  dirPath: string;
  configPath: string;
  aclPath?: string;
  policyMode: HeadscalePolicyMode;
  taclStatePath: string;
  containerRuntime: "docker" | "podman";
  containerName?: string;
  useSudo: boolean;
  hasConfigFile: boolean;
}

export function serverToTarget(server: ServerConfig): SshTarget {
  return {
    hostAlias: server.hostAlias,
    hostName: server.hostName,
    user: server.user,
    port: server.port,
    identityFile: server.identityFile,
    isLocal: server.isLocal,
  };
}

/**
 * Detects the remote SSH server's Tailscale IPv4 and hostname so tacl can
 * reliably identify and protect the SSH management link even when SSH connects
 * via a public IP or custom alias.
 */
export async function detectRemoteTailscaleIdentity(
  target: SshTarget
): Promise<{ tailscaleIp?: string; remoteHostname?: string }> {
  const cmd = [
    "TS_IP=$(tailscale ip -4 2>/dev/null | head -n 1 || true)",
    "HOST=$(hostname -s 2>/dev/null || hostname 2>/dev/null || true)",
    "echo TS_IP=$TS_IP",
    "echo HOST=$HOST",
  ].join("; ");
  const res = await execOnTarget(target, cmd, { timeoutMs: 5000 });
  const lines = res.stdout.split("\n");
  const getVal = (p: string) =>
    lines.find((l) => l.startsWith(p))?.slice(p.length).trim() || undefined;
  return {
    tailscaleIp: getVal("TS_IP"),
    remoteHostname: getVal("HOST"),
  };
}

function parsePolicyFromHeadscaleYaml(
  yamlRaw: string,
  baseDir: string
): { policyMode: HeadscalePolicyMode; aclPath?: string } {
  try {
    const parsed = YAML.parse(yamlRaw) as {
      policy?: { mode?: string; path?: string };
      acl_policy_path?: string;
    } | null;

    if (parsed?.policy?.mode === "database") {
      return { policyMode: "database" };
    }
    const rawPath = parsed?.policy?.path || parsed?.acl_policy_path;
    if (rawPath) {
      // If container uses /etc/headscale/acl.hujson while host mount is baseDir, keep rawPath for native
      return {
        policyMode: "file",
        aclPath: rawPath.startsWith("/") ? rawPath : join(baseDir, rawPath),
      };
    }
  } catch {
    // Fallback
  }
  return { policyMode: "file", aclPath: join(baseDir, "acl.hujson") };
}

export function parseNativeProbeOutput(stdout: string): {
  headscaleBin?: string;
  headscaleVersion?: string;
  headscaleInstaller: NativeInstallerKind;
  headscaleInstallerDetail: string;
  serviceUnit?: string;
  useSudo: boolean;
  sudoUser?: string;
  socketAccessible: boolean;
  configPath: string;
} {
  const lines = stdout.split("\n");
  const getVal = (prefix: string) =>
    lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim() ?? "";

  const headscaleBin = getVal("BIN=") || undefined;
  const headscaleVersion = getVal("VER=") || undefined;
  const rawInstaller = getVal("INSTALLER=") as NativeInstallerKind;
  const validInstallers: NativeInstallerKind[] = [
    "apt",
    "dnf",
    "yum",
    "rpm",
    "pacman",
    "apk",
    "snap",
    "brew",
    "go",
    "binary",
    "unknown",
  ];
  const headscaleInstaller: NativeInstallerKind = validInstallers.includes(rawInstaller)
    ? rawInstaller
    : headscaleBin
      ? "binary"
      : "unknown";
  const headscaleInstallerDetail =
    getVal("INSTALLER_DETAIL=") ||
    (headscaleBin ? `Binario en ${headscaleBin}` : "No detectado");
  const serviceUnit = getVal("SERVICE=") || undefined;
  const useSudo = getVal("NEED_SUDO=") === "1";
  const sudoUser = getVal("SUDO_USER=") || undefined;
  const socketAccessible = getVal("SOCKET_OK=") !== "0";
  const configPath = getVal("CFG=") || "/etc/headscale/config.yaml";

  return {
    headscaleBin,
    headscaleVersion,
    headscaleInstaller,
    headscaleInstallerDetail,
    serviceUnit,
    useSudo,
    sudoUser,
    socketAccessible,
    configPath,
  };
}

/**
 * Deeply searches for a native Headscale executable, its installer/package manager,
 * systemd service unit, config.yaml, and policy path on the selected target.
 */
export async function detectNativeHeadscale(
  target: SshTarget
): Promise<NativeDetectionResult> {
  const probe = `
    BIN=$(command -v headscale 2>/dev/null || true)

    # Check common paths if not in default non-interactive PATH
    if [ -z "$BIN" ]; then
      for p in /usr/bin/headscale /usr/local/bin/headscale /opt/headscale/headscale /snap/bin/headscale "$HOME/go/bin/headscale" "$HOME/.local/bin/headscale"; do
        if [ -x "$p" ] || sudo -n test -x "$p" 2>/dev/null; then
          BIN="$p"
          break
        fi
      done
    fi

    # Check systemd unit ExecStart (can reveal both binary and custom -c config path)
    UNIT_FILE=$(systemctl show -p FragmentPath --value headscale 2>/dev/null || true)
    UNIT_STATE=$(systemctl is-active headscale 2>/dev/null || true)
    EXEC_LINE=$(systemctl cat headscale 2>/dev/null | grep -E '^ExecStart=' | head -n 1 || true)
    if [ -z "$BIN" ] && [ -n "$EXEC_LINE" ]; then
      CAND=$(echo "$EXEC_LINE" | sed -E 's/^ExecStart=-?//' | awk '{print $1}')
      if [ -n "$CAND" ] && { [ -x "$CAND" ] || sudo -n test -x "$CAND" 2>/dev/null; }; then
        BIN="$CAND"
      fi
    fi

    # Final fallback: quick bounded search for executable named headscale
    if [ -z "$BIN" ]; then
      BIN=$(find /usr/local/bin /usr/bin /opt "$HOME" -maxdepth 4 -type f -name headscale -executable 2>/dev/null | head -n 1 || true)
    fi

    echo "BIN=$BIN"

    # Locate config.yaml early (prefer ExecStart -c/--config if present)
    CFG=""
    if [ -n "$EXEC_LINE" ]; then
      CFG=$(echo "$EXEC_LINE" | sed -nE 's/.*(-c|--config)[= ]+([^ ]+).*/\\2/p' | head -n 1)
    fi
    if [ -z "$CFG" ]; then
      for p in /etc/headscale/config.yaml /usr/local/etc/headscale/config.yaml /opt/headscale/config.yaml "$HOME/.config/headscale/config.yaml"; do
        if [ -f "$p" ] || sudo -n test -f "$p" 2>/dev/null; then
          CFG="$p"
          break
        fi
      done
    fi
    echo "CFG=$CFG"

    # Check REAL socket access (headscale version does not touch the unix socket!)
    NEED_SUDO=0
    SUDO_USER=""
    SOCKET_OK=0
    VER=""
    if [ -n "$BIN" ]; then
      VER=$("$BIN" version 2>/dev/null | head -n 1 || sudo -n "$BIN" version 2>/dev/null | head -n 1 || true)
      if [ -n "$CFG" ] && [ "$CFG" != "/etc/headscale/config.yaml" ]; then
        if "$BIN" -c "$CFG" users list -o json >/dev/null 2>&1; then
          SOCKET_OK=1
        elif sudo -n "$BIN" -c "$CFG" users list -o json >/dev/null 2>&1; then
          NEED_SUDO=1
          SOCKET_OK=1
        elif sudo -n -u headscale "$BIN" -c "$CFG" users list -o json >/dev/null 2>&1; then
          NEED_SUDO=1
          SUDO_USER="headscale"
          SOCKET_OK=1
        fi
      else
        if "$BIN" users list -o json >/dev/null 2>&1; then
          SOCKET_OK=1
        elif sudo -n "$BIN" users list -o json >/dev/null 2>&1; then
          NEED_SUDO=1
          SOCKET_OK=1
        elif sudo -n -u headscale "$BIN" users list -o json >/dev/null 2>&1; then
          NEED_SUDO=1
          SUDO_USER="headscale"
          SOCKET_OK=1
        fi
      fi
    fi
    echo "NEED_SUDO=$NEED_SUDO"
    echo "SUDO_USER=$SUDO_USER"
    echo "SOCKET_OK=$SOCKET_OK"
    echo "VER=$VER"

    # Detect installer / package manager that owns the executable or installer file
    INSTALLER="unknown"
    INSTALLER_DETAIL=""
    if [ -n "$BIN" ]; then
      REAL_BIN=$(readlink -f "$BIN" 2>/dev/null || echo "$BIN")
      if command -v dpkg >/dev/null 2>&1 && PKG=$(dpkg -S "$REAL_BIN" 2>/dev/null || dpkg -S "$BIN" 2>/dev/null); then
        INSTALLER="apt"
        INSTALLER_DETAIL="apt/dpkg ($PKG)"
      elif command -v rpm >/dev/null 2>&1 && PKG=$(rpm -qf "$REAL_BIN" 2>/dev/null || rpm -qf "$BIN" 2>/dev/null); then
        if command -v dnf >/dev/null 2>&1; then INSTALLER="dnf";
        elif command -v yum >/dev/null 2>&1; then INSTALLER="yum";
        else INSTALLER="rpm"; fi
        INSTALLER_DETAIL="$INSTALLER ($PKG)"
      elif command -v pacman >/dev/null 2>&1 && PKG=$(pacman -Qo "$REAL_BIN" 2>/dev/null); then
        INSTALLER="pacman"
        INSTALLER_DETAIL="pacman ($PKG)"
      elif command -v apk >/dev/null 2>&1 && PKG=$(apk info --who-owns "$REAL_BIN" 2>/dev/null | tail -n 1); then
        INSTALLER="apk"
        INSTALLER_DETAIL="apk ($PKG)"
      elif echo "$REAL_BIN" | grep -q '/snap/'; then
        INSTALLER="snap"
        INSTALLER_DETAIL="snap ($REAL_BIN)"
      elif echo "$REAL_BIN" | grep -qiE 'homebrew|linuxbrew'; then
        INSTALLER="brew"
        INSTALLER_DETAIL="brew ($REAL_BIN)"
      elif echo "$REAL_BIN" | grep -q '/go/bin/'; then
        INSTALLER="go"
        INSTALLER_DETAIL="go install ($REAL_BIN)"
      else
        INSTALLER="binary"
        # Look for local downloaded installer package (.deb / .rpm) in common folders
        LOCAL_PKG=$(find /tmp /root "$HOME" "$HOME/Downloads" /opt -maxdepth 2 -type f \\( -name 'headscale*.deb' -o -name 'headscale*.rpm' \\) 2>/dev/null | head -n 1 || true)
        if [ -n "$LOCAL_PKG" ]; then
          INSTALLER_DETAIL="Binario manual ($REAL_BIN · instalador: $LOCAL_PKG)"
        else
          INSTALLER_DETAIL="Binario directo ($REAL_BIN)"
        fi
      fi
    fi
    echo "INSTALLER=$INSTALLER"
    echo "INSTALLER_DETAIL=$INSTALLER_DETAIL"

    if [ -n "$UNIT_FILE" ]; then
      echo "SERVICE=$UNIT_FILE ($UNIT_STATE)"
    elif [ -n "$UNIT_STATE" ] && [ "$UNIT_STATE" != "unknown" ]; then
      echo "SERVICE=headscale.service ($UNIT_STATE)"
    fi
  `;

  const res = await execOnTarget(target, probe, { timeoutMs: 10_000 });
  const parsedProbe = parseNativeProbeOutput(res.stdout);

  if (!parsedProbe.headscaleBin) {
    return {
      found: false,
      headscaleInstaller: "unknown",
      headscaleInstallerDetail: "No encontrado",
      useSudo: false,
      socketAccessible: false,
      configPath: parsedProbe.configPath,
      policyMode: "file",
      aclPath: "/etc/headscale/acl.hujson",
      taclStatePath: "/etc/headscale/tacl.yaml",
      message:
        "No se encontró el ejecutable 'headscale' en PATH, rutas estándar ni systemd en esta máquina.",
    };
  }

  let policyMode: HeadscalePolicyMode = "file";
  let aclPath: string | undefined = join(dirname(parsedProbe.configPath), "acl.hujson");
  let cfgRead = await readFileOnTarget(
    target,
    parsedProbe.configPath,
    parsedProbe.useSudo
  );
  if (!cfgRead.ok && !parsedProbe.useSudo) {
    cfgRead = await readFileOnTarget(target, parsedProbe.configPath, true);
  }
  if (cfgRead.ok) {
    const parsed = parsePolicyFromHeadscaleYaml(
      cfgRead.content,
      dirname(parsedProbe.configPath)
    );
    policyMode = parsed.policyMode;
    aclPath = parsed.aclPath;
  }

  return {
    found: true,
    headscaleBin: parsedProbe.headscaleBin,
    headscaleVersion: parsedProbe.headscaleVersion,
    headscaleInstaller: parsedProbe.headscaleInstaller,
    headscaleInstallerDetail: parsedProbe.headscaleInstallerDetail,
    serviceUnit: parsedProbe.serviceUnit,
    useSudo: parsedProbe.useSudo,
    sudoUser: parsedProbe.sudoUser,
    socketAccessible: parsedProbe.socketAccessible,
    configPath: parsedProbe.configPath,
    policyMode,
    aclPath,
    taclStatePath: join(dirname(parsedProbe.configPath), "tacl.yaml"),
    message: `Ejecutable ${parsedProbe.headscaleBin} · Instalador: ${parsedProbe.headscaleInstallerDetail}`,
  };
}

/**
 * Inspects Docker/Podman on the target for running Headscale containers and host volume directories.
 */
export async function detectContainerHints(target: SshTarget): Promise<{
  hints: ContainerHint[];
  useSudo: boolean;
}> {
  const probe = `
    RUNTIME=""
    SUDO_PREFIX=""
    if command -v docker >/dev/null 2>&1; then
      if docker ps >/dev/null 2>&1; then RUNTIME="docker";
      elif sudo -n docker ps >/dev/null 2>&1; then RUNTIME="docker"; SUDO_PREFIX="sudo -n "; fi
    elif command -v podman >/dev/null 2>&1; then
      if podman ps >/dev/null 2>&1; then RUNTIME="podman";
      elif sudo -n podman ps >/dev/null 2>&1; then RUNTIME="podman"; SUDO_PREFIX="sudo -n "; fi
    fi
    echo "RUNTIME=$RUNTIME"
    echo "SUDO=$SUDO_PREFIX"
    if [ -n "$RUNTIME" ]; then
      $SUDO_PREFIX$RUNTIME ps --format '{{.Names}}|{{.Image}}' | grep -i headscale | while IFS='|' read -r name img; do
        MOUNTS=$($SUDO_PREFIX$RUNTIME inspect -f '{{range .Mounts}}{{.Source}},{{end}}' "$name" 2>/dev/null || true)
        WORKDIR=$($SUDO_PREFIX$RUNTIME inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$name" 2>/dev/null || true)
        echo "CONTAINER=$name|$img|$WORKDIR|$MOUNTS"
      done
    fi
  `;

  const res = await execOnTarget(target, probe, { timeoutMs: 8000 });
  const lines = res.stdout.split("\n");
  const runtimeRaw = lines.find((l) => l.startsWith("RUNTIME="))?.slice(8).trim();
  const runtime: "docker" | "podman" = runtimeRaw === "podman" ? "podman" : "docker";
  const useSudo = Boolean(lines.find((l) => l.startsWith("SUDO="))?.slice(5).trim());

  const hints: ContainerHint[] = [];
  for (const line of lines) {
    if (!line.startsWith("CONTAINER=")) continue;
    const [containerName = "", image = "", workdir = "", mounts = ""] = line
      .slice("CONTAINER=".length)
      .split("|");
    const dirs = new Set<string>();
    if (workdir.trim()) dirs.add(workdir.trim());
    for (const m of mounts.split(",")) {
      const cleaned = m.trim();
      if (cleaned.startsWith("/")) dirs.add(cleaned);
    }
    hints.push({
      runtime,
      containerName,
      image,
      suggestedDirs: Array.from(dirs),
    });
  }

  return { hints, useSudo };
}

/**
 * Lists directories and relevant config files in a remote folder so the user can pick the container directory.
 */
export async function listRemoteDirectory(
  target: SshTarget,
  dirPath: string
): Promise<{ currentPath: string; entries: RemoteDirEntry[]; error?: string }> {
  const safePath = dirPath.trim() || "/";
  const cmd = `
    TARGET=${shellQuote(safePath)}
    if [ "$TARGET" = "~" ]; then TARGET="$HOME"; fi
    REAL=$(cd "$TARGET" 2>/dev/null && pwd)
    if [ -z "$REAL" ]; then echo "ERR=No se puede abrir $TARGET"; exit 1; fi
    echo "PWD=$REAL"
    ls -1Ap "$REAL" 2>/dev/null | head -n 120
  `;
  const res = await execOnTarget(target, cmd, { timeoutMs: 6000 });
  const lines = res.stdout.split("\n").filter(Boolean);
  const errLine = lines.find((l) => l.startsWith("ERR="));
  if (res.exitCode !== 0 || errLine) {
    return {
      currentPath: safePath,
      entries: [],
      error: errLine ? errLine.slice(4) : res.stderr.trim() || "Error listando directorio",
    };
  }

  const realPwd = lines.find((l) => l.startsWith("PWD="))?.slice(4).trim() || safePath;
  const entries: RemoteDirEntry[] = [];

  if (realPwd !== "/") {
    entries.push({
      name: "..",
      path: dirname(realPwd),
      isDir: true,
    });
  }

  for (const line of lines) {
    if (line.startsWith("PWD=")) continue;
    const isDir = line.endsWith("/");
    const name = isDir ? line.slice(0, -1) : line;
    if (!name) continue;
    // Show directories plus relevant config/compose/acl files
    if (
      isDir ||
      /\.(ya?ml|hujson|json)$/i.test(name) ||
      name.toLowerCase().includes("headscale") ||
      name.toLowerCase().includes("acl")
    ) {
      entries.push({
        name,
        path: join(realPwd, name),
        isDir,
      });
    }
  }

  entries.sort((a, b) => {
    if (a.name === "..") return -1;
    if (b.name === "..") return 1;
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { currentPath: realPwd, entries };
}

/**
 * Inspects a user-selected container folder to locate config.yaml, ACL file, and container name.
 */
export async function inspectContainerDir(
  target: SshTarget,
  dirPath: string,
  preferredHint?: ContainerHint,
  useSudo = false
): Promise<ContainerDirInspection> {
  const probe = `
    DIR=${shellQuote(dirPath)}
    for rel in config.yaml config/config.yaml etc/config.yaml headscale/config.yaml; do
      if [ -f "$DIR/$rel" ]; then echo "CFG=$DIR/$rel"; break; fi
    done
    for rel in acl.hujson acl.json policy.hujson policy.json config/acl.hujson config/acl.json config/policy.hujson; do
      if [ -f "$DIR/$rel" ]; then echo "ACL=$DIR/$rel"; break; fi
    done
  `;
  const res = await execOnTarget(target, probe, { timeoutMs: 6000 });
  const lines = res.stdout.split("\n");
  const getVal = (prefix: string) =>
    lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim() ?? "";

  const foundCfg = getVal("CFG");
  const foundAcl = getVal("ACL");
  const configPath = foundCfg || join(dirPath, "config.yaml");
  const cfgDir = dirname(configPath);

  let policyMode: HeadscalePolicyMode = "file";
  let aclPath: string | undefined = foundAcl || join(cfgDir, "acl.hujson");

  if (foundCfg) {
    const cfgRead = await readFileOnTarget(target, foundCfg, useSudo);
    if (cfgRead.ok) {
      const parsed = parsePolicyFromHeadscaleYaml(cfgRead.content, cfgDir);
      policyMode = parsed.policyMode;
      // Map container internal path like /etc/headscale/acl.hujson to host cfgDir if not found directly
      if (parsed.aclPath && !foundAcl) {
        const baseName = parsed.aclPath.split("/").pop() || "acl.hujson";
        aclPath = join(cfgDir, baseName);
      }
    }
  }

  return {
    dirPath,
    configPath,
    aclPath,
    policyMode,
    taclStatePath: join(cfgDir, "tacl.yaml"),
    containerRuntime: preferredHint?.runtime ?? "docker",
    containerName: preferredHint?.containerName,
    useSudo,
    hasConfigFile: Boolean(foundCfg),
  };
}

function buildRawHeadscaleCmd(server: ServerConfig, subcommand: string): string {
  if (server.deployMode === "container") {
    const runtime = server.containerRuntime ?? "docker";
    const container = server.containerName || "headscale";
    return `${runtime} exec ${shellQuote(container)} headscale ${subcommand}`;
  }
  const bin = server.headscaleBin || "headscale";
  const cfgFlag =
    server.configPath && server.configPath !== "/etc/headscale/config.yaml"
      ? ` -c ${shellQuote(server.configPath)}`
      : "";
  return `${shellQuote(bin)}${cfgFlag} ${subcommand}`;
}

async function runHeadscaleSubcommand(
  server: ServerConfig,
  subcommand: string,
  timeoutMs = 10_000
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  needsSudoPassword: boolean;
  wrongPassword?: boolean;
}> {
  const target = serverToTarget(server);
  const rawCmd = buildRawHeadscaleCmd(server, subcommand);
  if (server.useSudo) {
    return execSudoOnTarget(target, rawCmd, {
      sudoUser: server.sudoUser,
      timeoutMs,
    });
  }
  const res = await execOnTarget(target, rawCmd, { timeoutMs });
  return { ...res, needsSudoPassword: false };
}

/**
 * Fetches users and devices (nodes) from Headscale CLI (supports v0.22–v0.26 JSON schemas).
 * Automatically retries with sudo (-n or session password) if socket permission is denied.
 */
export async function fetchHeadscaleInventory(server: ServerConfig): Promise<{
  users: HeadscaleUser[];
  devices: Device[];
  resolvedServer?: ServerConfig;
  needsSudoPassword?: boolean;
  wrongPassword?: boolean;
  error?: string;
}> {
  const attempt = async (cfg: ServerConfig) =>
    Promise.all([
      runHeadscaleSubcommand(cfg, "users list -o json", 10_000),
      runHeadscaleSubcommand(cfg, "nodes list -o json", 10_000),
    ]);

  let activeServer = server;
  let [usersRes, nodesRes] = await attempt(activeServer);

  // Auto-retry with sudo / sudo -u headscale on socket permission denied
  if (nodesRes.exitCode !== 0 && activeServer.deployMode === "native") {
    const errText = `${nodesRes.stderr} ${nodesRes.stdout}`;
    const isPermError =
      isPermissionError(errText) || errText.toLowerCase().includes("socket");
    if (isPermError && !nodesRes.needsSudoPassword) {
      const fallbacks: ServerConfig[] = [];
      if (!activeServer.useSudo) {
        fallbacks.push({ ...activeServer, useSudo: true, sudoUser: undefined });
      }
      if (activeServer.sudoUser !== "headscale") {
        fallbacks.push({ ...activeServer, useSudo: true, sudoUser: "headscale" });
      }
      for (const candidate of fallbacks) {
        const [uTry, nTry] = await attempt(candidate);
        if (nTry.exitCode === 0) {
          activeServer = candidate;
          usersRes = uTry;
          nodesRes = nTry;
          break;
        }
        if (nTry.needsSudoPassword) {
          nodesRes = nTry;
          break;
        }
      }
    }
  }

  if (nodesRes.exitCode !== 0) {
    const rawErr = nodesRes.stderr.trim() || nodesRes.stdout.trim();
    if (nodesRes.needsSudoPassword) {
      return {
        users: [],
        devices: [],
        needsSudoPassword: true,
        wrongPassword: nodesRes.wrongPassword,
        error: nodesRes.wrongPassword
          ? "Contraseña sudo incorrecta."
          : "Se requiere contraseña sudo para acceder al socket de Headscale.",
      };
    }
    const lower = rawErr.toLowerCase();
    const hint =
      lower.includes("permission denied") || lower.includes("socket")
        ? " — Sugerencia: ingresa la contraseña sudo o agrega tu usuario al grupo headscale."
        : "";
    return {
      users: [],
      devices: [],
      error: `Error ejecutando headscale nodes list: ${rawErr}${hint}`,
    };
  }

  const users: HeadscaleUser[] = [];
  if (usersRes.exitCode === 0 && usersRes.stdout.trim()) {
    try {
      const rawUsers = JSON.parse(usersRes.stdout) as Array<Record<string, unknown>>;
      if (Array.isArray(rawUsers)) {
        for (const u of rawUsers) {
          const id = String(u.id ?? u.name ?? "");
          const name = String(u.name ?? id);
          if (!id) continue;
          users.push({
            id,
            name,
            displayName: typeof u.display_name === "string" ? u.display_name : undefined,
          });
        }
      }
    } catch {
      // Users can also be inferred from nodes below
    }
  }

  const userByName = new Map<string, HeadscaleUser>(users.map((u) => [u.name, u]));
  const userById = new Map<string, HeadscaleUser>(users.map((u) => [u.id, u]));
  const devices: Device[] = [];

  try {
    const rawNodes = JSON.parse(nodesRes.stdout) as Array<Record<string, unknown>>;
    if (Array.isArray(rawNodes)) {
      for (const n of rawNodes) {
        const id = String(n.id ?? "");
        const name = String(n.name ?? `node-${id}`);
        const givenName =
          typeof n.given_name === "string"
            ? n.given_name
            : typeof n.givenName === "string"
              ? n.givenName
              : name;

        const rawUser = n.user as Record<string, unknown> | string | undefined;
        let userId = "";
        let userName = "default";

        if (typeof rawUser === "string") {
          userName = rawUser;
          userId = userByName.get(rawUser)?.id ?? rawUser;
        } else if (rawUser && typeof rawUser === "object") {
          userName = String(rawUser.name ?? rawUser.id ?? "default");
          userId = String(rawUser.id ?? userByName.get(userName)?.id ?? userName);
        }

        if (userId && !userById.has(userId)) {
          const inferred: HeadscaleUser = { id: userId, name: userName };
          users.push(inferred);
          userById.set(userId, inferred);
          userByName.set(userName, inferred);
        }

        const ips = Array.isArray(n.ip_addresses)
          ? (n.ip_addresses as string[])
          : Array.isArray(n.ipAddresses)
            ? (n.ipAddresses as string[])
            : [];

        const tags = Array.isArray(n.forced_tags)
          ? (n.forced_tags as string[])
          : Array.isArray(n.valid_tags)
            ? (n.valid_tags as string[])
            : [];

        devices.push({
          id,
          name,
          givenName,
          userId,
          userName,
          ipAddresses: ips,
          online: Boolean(n.online),
          tags,
        });
      }
    }
  } catch (err) {
    return {
      users,
      devices: [],
      error: `Error parseando JSON de nodos: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { users, devices, resolvedServer: activeServer };
}

export async function fetchCurrentPolicyRaw(server: ServerConfig): Promise<{
  raw: string;
  exists: boolean;
}> {
  const target = serverToTarget(server);

  if (server.policyMode === "database") {
    const res = await runHeadscaleSubcommand(server, "policy get", 8000);
    if (res.exitCode === 0 && res.stdout.trim()) {
      return { raw: res.stdout, exists: true };
    }
    return { raw: "", exists: false };
  }

  if (!server.aclPath) {
    return { raw: "", exists: false };
  }

  const readRes = await readFileOnTarget(target, server.aclPath, server.useSudo);
  return { raw: readRes.ok ? readRes.content : "", exists: readRes.ok };
}

export async function loadRemoteTaclState(server: ServerConfig): Promise<{
  state: TaclState;
  existed: boolean;
}> {
  const target = serverToTarget(server);
  const res = await readFileOnTarget(target, server.taclStatePath, server.useSudo);
  if (res.ok && res.content.trim()) {
    return { state: deserializeTaclState(res.content), existed: true };
  }
  // Fallback: check user's remote ~/.config/tacl/tacl.yaml if /etc/headscale/tacl.yaml wasn't writable
  const homeRes = await execOnTarget(
    target,
    'if [ -f "$HOME/.config/tacl/tacl.yaml" ]; then cat "$HOME/.config/tacl/tacl.yaml"; fi',
    { timeoutMs: 6000 }
  );
  if (homeRes.exitCode === 0 && homeRes.stdout.trim()) {
    return { state: deserializeTaclState(homeRes.stdout), existed: true };
  }
  return { state: createEmptyState("passthrough", false), existed: false };
}

/**
 * Loads saved tacl state giving strict priority to the LOCAL machine over the remote copy.
 * If no local state exists yet, falls back to the remote server state.
 */
export async function loadStateWithLocalPriority(server: ServerConfig): Promise<{
  state: TaclState;
  existed: boolean;
  source: "local" | "remote" | "none";
}> {
  const [localRes, remoteRes] = await Promise.all([
    loadLocalState(server.hostAlias),
    loadRemoteTaclState(server),
  ]);

  if (localRes.existed && localRes.state.initialized) {
    return { state: localRes.state, existed: true, source: "local" };
  }
  if (remoteRes.existed && remoteRes.state.initialized) {
    // Cache remote state locally so local stays in sync
    await saveLocalState(server.hostAlias, remoteRes.state).catch(() => {});
    return { state: remoteRes.state, existed: true, source: "remote" };
  }
  return {
    state: createEmptyState("passthrough", false),
    existed: false,
    source: "none",
  };
}

async function writeRemoteTaclYamlWithFallback(
  server: ServerConfig,
  yamlContent: string
): Promise<{ ok: boolean; savedPath?: string; error?: string }> {
  const target = serverToTarget(server);
  const primary = await writeFileOnTarget(
    target,
    server.taclStatePath,
    yamlContent,
    server.useSudo
  );
  if (primary.ok) {
    return { ok: true, savedPath: server.taclStatePath };
  }

  // Fallback to remote user's $HOME/.config/tacl/tacl.yaml so state always saves cleanly
  const fallbackRes = await execOnTarget(
    target,
    'mkdir -p "$HOME/.config/tacl" && cat > "$HOME/.config/tacl/tacl.yaml"',
    { stdinText: yamlContent, timeoutMs: 10_000 }
  );
  if (fallbackRes.exitCode === 0) {
    return { ok: true, savedPath: "~/.config/tacl/tacl.yaml" };
  }

  return {
    ok: false,
    error: primary.error || fallbackRes.stderr.trim() || "Error escribiendo tacl.yaml",
  };
}

export async function saveRemoteTaclState(
  server: ServerConfig,
  state: TaclState
): Promise<{ ok: boolean; savedPath?: string; error?: string }> {
  // Always persist local state and backup first (local prevails)
  await saveLocalState(server.hostAlias, state);
  await saveLocalStateBackup(server.hostAlias, state);

  return writeRemoteTaclYamlWithFallback(server, serializeTaclState(state));
}

/**
 * Saves current selections, profiles, unapplied rules, and options to BOTH
 * the local machine and the remote server (never failing locally if remote is unreachable).
 */
export async function saveStateLocalAndRemote(
  server: ServerConfig,
  state: TaclState
): Promise<{ localOk: boolean; remoteOk: boolean; remoteError?: string }> {
  let localOk = false;
  try {
    await saveLocalState(server.hostAlias, state);
    await saveLocalStateBackup(server.hostAlias, state);
    localOk = true;
  } catch {
    localOk = false;
  }

  const remoteRes = await writeRemoteTaclYamlWithFallback(
    server,
    serializeTaclState(state)
  );

  return {
    localOk,
    remoteOk: remoteRes.ok,
    remoteError: remoteRes.error,
  };
}

/**
 * Applies a compiled HuJSON policy to Headscale with automatic backup, reload,
 * and sudo password prompt support if sudo requires authentication.
 */
export async function applyPolicyToHeadscale(
  server: ServerConfig,
  hujson: string,
  state: TaclState
): Promise<{
  ok: boolean;
  backupPath?: string;
  needsSudoPassword?: boolean;
  wrongPassword?: boolean;
  message: string;
}> {
  const target = serverToTarget(server);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  // 1. Save tacl state YAML (falls back cleanly to remote ~/.config/tacl/tacl.yaml if needed)
  await saveRemoteTaclState(server, state);

  // 2. Database policy mode
  if (server.policyMode === "database") {
    const tmpFile = `/tmp/tacl-policy-${timestamp}.hujson`;
    const writeTmp = await writeFileOnTarget(target, tmpFile, hujson, false);
    if (!writeTmp.ok) {
      return { ok: false, message: `Error escribiendo archivo temporal: ${writeTmp.error}` };
    }

    let applyRes;
    if (server.deployMode === "container") {
      const runtime = server.containerRuntime ?? "docker";
      const container = server.containerName || "headscale";
      const inner = `${runtime} cp ${shellQuote(tmpFile)} ${shellQuote(container)}:/tmp/tacl-policy.hujson && ${buildRawHeadscaleCmd(server, "policy set -f /tmp/tacl-policy.hujson")} && rm -f ${shellQuote(tmpFile)}`;
      applyRes = server.useSudo
        ? await execSudoOnTarget(target, inner, { timeoutMs: 12_000 })
        : { ...(await execOnTarget(target, inner, { timeoutMs: 12_000 })), needsSudoPassword: false };
    } else {
      applyRes = await runHeadscaleSubcommand(
        server,
        `policy set -f ${shellQuote(tmpFile)}`,
        12_000
      );
      if (applyRes.exitCode !== 0 && !server.useSudo && isPermissionError(`${applyRes.stderr} ${applyRes.stdout}`)) {
        applyRes = await execSudoOnTarget(
          target,
          buildRawHeadscaleCmd(server, `policy set -f ${shellQuote(tmpFile)}`),
          { timeoutMs: 12_000 }
        );
      }
      await execOnTarget(target, `rm -f ${shellQuote(tmpFile)}`, { timeoutMs: 4000 }).catch(() => {});
    }

    if (applyRes.exitCode !== 0) {
      if (applyRes.needsSudoPassword) {
        return {
          ok: false,
          needsSudoPassword: true,
          wrongPassword: applyRes.wrongPassword,
          message: applyRes.wrongPassword
            ? "Contraseña sudo incorrecta."
            : "Se requiere contraseña sudo para aplicar la política en Headscale.",
        };
      }
      return {
        ok: false,
        message: `Error aplicando política en Headscale (database): ${applyRes.stderr.trim() || applyRes.stdout.trim()}`,
      };
    }
    return {
      ok: true,
      message: "Política aplicada correctamente en Headscale (modo database).",
    };
  }

  // 3. File policy mode: backup existing file -> write new file -> reload Headscale
  if (!server.aclPath) {
    return { ok: false, message: "No se definió ruta de archivo ACL." };
  }

  const backupPath = `${server.aclPath}.bak-${timestamp}`;

  // Attempt backup (direct or via sudo)
  const backupDirect = await execOnTarget(
    target,
    `if [ -f ${shellQuote(server.aclPath)} ]; then cp ${shellQuote(server.aclPath)} ${shellQuote(backupPath)}; fi`
  );
  if (backupDirect.exitCode !== 0) {
    await execSudoOnTarget(
      target,
      `if [ -f ${shellQuote(server.aclPath)} ]; then cp ${shellQuote(server.aclPath)} ${shellQuote(backupPath)}; fi`,
      { timeoutMs: 8000 }
    );
  }

  // Write ACL file (automatically falls back to sudo -n or session sudo password)
  const writeRes = await writeFileOnTarget(
    target,
    server.aclPath,
    hujson,
    server.useSudo
  );
  if (!writeRes.ok) {
    if (writeRes.needsSudoPassword) {
      return {
        ok: false,
        backupPath,
        needsSudoPassword: true,
        wrongPassword: writeRes.wrongPassword,
        message: writeRes.wrongPassword
          ? "Contraseña sudo incorrecta."
          : `Se requiere contraseña sudo para escribir ${server.aclPath}.`,
      };
    }
    return {
      ok: false,
      backupPath,
      message: `Error escribiendo ${server.aclPath}: ${writeRes.error}`,
    };
  }

  // Re-save tacl.yaml in /etc/headscale now that sudo password may be cached in session
  await saveRemoteTaclState(server, state);

  // Reload Headscale (direct first, then sudo with session password if needed)
  let reloadOk = false;
  let reloadErr = "";
  if (server.deployMode === "container") {
    const runtime = server.containerRuntime ?? "docker";
    const container = server.containerName || "headscale";
    const cmd = `${runtime} kill -s HUP ${shellQuote(container)}`;
    const direct = server.useSudo
      ? await execSudoOnTarget(target, cmd, { timeoutMs: 8000 })
      : { ...(await execOnTarget(target, cmd, { timeoutMs: 8000 })), needsSudoPassword: false };
    if (direct.exitCode === 0) {
      reloadOk = true;
    } else {
      const elevated = await execSudoOnTarget(target, cmd, { timeoutMs: 8000 });
      reloadOk = elevated.exitCode === 0;
      reloadErr = elevated.stderr.trim();
    }
  } else {
    const cmd = "systemctl reload headscale 2>/dev/null || pkill -HUP headscale";
    const direct = await execOnTarget(target, cmd, { timeoutMs: 8000 });
    if (direct.exitCode === 0) {
      reloadOk = true;
    } else {
      const elevated = await execSudoOnTarget(target, cmd, { timeoutMs: 8000 });
      if (elevated.exitCode === 0) {
        reloadOk = true;
      } else if (elevated.needsSudoPassword) {
        return {
          ok: false,
          backupPath,
          needsSudoPassword: true,
          wrongPassword: elevated.wrongPassword,
          message: "ACL escrita, pero se requiere contraseña sudo para recargar el servicio headscale.",
        };
      } else {
        reloadErr = elevated.stderr.trim();
      }
    }
  }

  if (!reloadOk) {
    return {
      ok: true,
      backupPath,
      message: `ACL escrita en ${server.aclPath} (backup en ${backupPath}), pero recarga manual requerida: ${reloadErr}`,
    };
  }

  return {
    ok: true,
    backupPath,
    message: `Política aplicada y Headscale recargado (backup: ${backupPath}).`,
  };
}
