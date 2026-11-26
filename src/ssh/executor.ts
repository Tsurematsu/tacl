import { homedir } from "node:os";
import { join } from "node:path";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface SshTarget {
  hostAlias: string;
  hostName: string;
  user?: string;
  port?: number;
  identityFile?: string;
  isLocal: boolean;
}

// In-memory ONLY session cache for sudo passwords (never written to disk)
const sessionSudoPasswords = new Map<string, string>();

function targetKey(target: SshTarget): string {
  return `${target.isLocal ? "local" : "ssh"}:${target.user ?? ""}@${target.hostAlias || target.hostName}:${target.port ?? 22}`;
}

export function setSudoPassword(target: SshTarget, password: string): void {
  sessionSudoPasswords.set(targetKey(target), password);
}

export function getSudoPassword(target: SshTarget): string | undefined {
  return sessionSudoPasswords.get(targetKey(target));
}

export function hasSudoPassword(target: SshTarget): boolean {
  return sessionSudoPasswords.has(targetKey(target));
}

export function clearSudoPassword(target: SshTarget): void {
  sessionSudoPasswords.delete(targetKey(target));
}

export function isSudoPasswordError(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes("a password is required") ||
    lower.includes("password is required") ||
    lower.includes("incorrect password") ||
    lower.includes("sorry, try again") ||
    lower.includes("terminal is required to read the password") ||
    lower.includes("no tty present")
  );
}

export function isPermissionError(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes("permission denied") ||
    lower.includes("cannot open") ||
    lower.includes("operation not permitted") ||
    isSudoPasswordError(lower)
  );
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function spawnWithTimeout(
  cmd: string[],
  options: { timeoutMs?: number; stdinText?: string } = {}
): Promise<ExecResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;

  const proc = Bun.spawn(cmd, {
    stdin: options.stdinText !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  if (options.stdinText !== undefined && proc.stdin) {
    proc.stdin.write(options.stdinText);
    proc.stdin.end();
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {
      // Ignore kill errors
    }
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return { exitCode, stdout, stderr, timedOut };
}

export function buildSshArgs(target: SshTarget, connectTimeoutSec = 4): string[] {
  const args = [
    "ssh",
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${connectTimeoutSec}`,
    "-o",
    "StrictHostKeyChecking=accept-new",
  ];

  // OpenSSH ControlMaster uses Unix domain sockets, which are not supported on Windows OpenSSH
  if (process.platform !== "win32") {
    args.push(
      "-o",
      "ControlMaster=auto",
      "-o",
      "ControlPersist=60s",
      "-o",
      "ControlPath=/tmp/tacl-ssh-%C"
    );
  }

  if (target.port) {
    args.push("-p", String(target.port));
  }
  if (target.identityFile) {
    const resolvedKey =
      target.identityFile.startsWith("~/") || target.identityFile.startsWith("~\\")
        ? join(homedir(), target.identityFile.slice(2))
        : target.identityFile;
    args.push("-i", resolvedKey);
  }
  if (target.user) {
    args.push("-l", target.user);
  }

  const destination = target.hostAlias || target.hostName;
  args.push(destination);
  return args;
}

export async function execOnTarget(
  target: SshTarget,
  remoteCommand: string,
  options: { timeoutMs?: number; stdinText?: string; connectTimeoutSec?: number } = {}
): Promise<ExecResult> {
  if (target.isLocal) {
    return spawnWithTimeout(["bash", "-lc", remoteCommand], options);
  }
  const sshArgs = buildSshArgs(target, options.connectTimeoutSec ?? 4);
  return spawnWithTimeout([...sshArgs, remoteCommand], options);
}

/**
 * Executes a command with sudo on target:
 * - Tries `sudo -n` first (passwordless).
 * - If a session sudo password is stored in memory, uses `sudo -S -p ''` cleanly via stdin.
 * - If password is missing or wrong, signals `needsSudoPassword: true` without ever persisting it.
 */
export async function execSudoOnTarget(
  target: SshTarget,
  innerCommand: string,
  options: { sudoUser?: string; timeoutMs?: number } = {}
): Promise<ExecResult & { needsSudoPassword: boolean; wrongPassword?: boolean }> {
  const userFlag = options.sudoUser ? `-u ${shellQuote(options.sudoUser)} ` : "";
  const timeoutMs = options.timeoutMs ?? 12_000;
  const cachedPwd = getSudoPassword(target);

  // If we already have a session password, use sudo -S directly so we don't waste an extra roundtrip
  if (cachedPwd !== undefined) {
    const res = await execOnTarget(
      target,
      `sudo -S -p '' ${userFlag}sh -c ${shellQuote(innerCommand)}`,
      { stdinText: `${cachedPwd}\n`, timeoutMs }
    );
    if (res.exitCode === 0) {
      return { ...res, needsSudoPassword: false };
    }
    const combined = `${res.stderr} ${res.stdout}`;
    if (isSudoPasswordError(combined)) {
      clearSudoPassword(target);
      return { ...res, needsSudoPassword: true, wrongPassword: true };
    }
    return { ...res, needsSudoPassword: false };
  }

  // Otherwise try passwordless sudo -n first
  const res = await execOnTarget(
    target,
    `sudo -n ${userFlag}sh -c ${shellQuote(innerCommand)}`,
    { timeoutMs }
  );
  if (res.exitCode === 0) {
    return { ...res, needsSudoPassword: false };
  }
  const combined = `${res.stderr} ${res.stdout}`;
  if (isSudoPasswordError(combined)) {
    return { ...res, needsSudoPassword: true };
  }
  return { ...res, needsSudoPassword: false };
}

export async function readFileOnTarget(
  target: SshTarget,
  filePath: string,
  useSudo = false
): Promise<{
  ok: boolean;
  content: string;
  error?: string;
  usedSudo?: boolean;
  needsSudoPassword?: boolean;
}> {
  const quoted = shellQuote(filePath);

  if (!useSudo) {
    const direct = await execOnTarget(target, `cat ${quoted}`);
    if (direct.exitCode === 0) {
      return { ok: true, content: direct.stdout, usedSudo: false };
    }
    if (!isPermissionError(`${direct.stderr} ${direct.stdout}`)) {
      return {
        ok: false,
        content: "",
        error: direct.stderr.trim() || "No se pudo leer el archivo",
      };
    }
  }

  // Elevated read via sudo (-n or -S with in-memory password)
  const elevated = await execSudoOnTarget(target, `cat ${quoted}`, {
    timeoutMs: 10_000,
  });
  if (elevated.exitCode === 0) {
    return { ok: true, content: elevated.stdout, usedSudo: true };
  }
  return {
    ok: false,
    content: "",
    needsSudoPassword: elevated.needsSudoPassword,
    error: elevated.stderr.trim() || `No se pudo leer ${filePath}`,
  };
}

/**
 * Safely writes a file on the target:
 * - Tries direct write when `!useSudo`.
 * - On permission error (or when `useSudo` is true), writes content to a private temp file first
 *   and copies it via `execSudoOnTarget` so sudo's password stdin NEVER mixes with file contents.
 */
export async function writeFileOnTarget(
  target: SshTarget,
  filePath: string,
  content: string,
  useSudo = false
): Promise<{
  ok: boolean;
  error?: string;
  usedSudo?: boolean;
  needsSudoPassword?: boolean;
  wrongPassword?: boolean;
}> {
  const quoted = shellQuote(filePath);

  if (!useSudo) {
    const direct = await execOnTarget(target, `cat > ${quoted}`, {
      stdinText: content,
      timeoutMs: 12_000,
    });
    if (direct.exitCode === 0) {
      return { ok: true, usedSudo: false };
    }
    if (!isPermissionError(`${direct.stderr} ${direct.stdout}`)) {
      return {
        ok: false,
        error: direct.stderr.trim() || `Error escribiendo ${filePath}`,
      };
    }
  }

  // Elevated write: 1) stage content in /tmp without sudo, 2) copy with sudo (-n or -S) & remove tmp
  const tmpName = `/tmp/tacl-stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const quotedTmp = shellQuote(tmpName);
  const stageRes = await execOnTarget(target, `cat > ${quotedTmp}`, {
    stdinText: content,
    timeoutMs: 12_000,
  });
  if (stageRes.exitCode !== 0) {
    return {
      ok: false,
      error: stageRes.stderr.trim() || `Error creando archivo temporal ${tmpName}`,
    };
  }

  const copyRes = await execSudoOnTarget(
    target,
    `cat ${quotedTmp} > ${quoted} && rm -f ${quotedTmp}`,
    { timeoutMs: 12_000 }
  );

  if (copyRes.exitCode === 0) {
    return { ok: true, usedSudo: true };
  }

  // Cleanup temp file on failure
  await execOnTarget(target, `rm -f ${quotedTmp}`, { timeoutMs: 4000 }).catch(() => {});

  return {
    ok: false,
    needsSudoPassword: copyRes.needsSudoPassword,
    wrongPassword: copyRes.wrongPassword,
    error: copyRes.stderr.trim() || `Error escribiendo ${filePath} con sudo`,
  };
}
