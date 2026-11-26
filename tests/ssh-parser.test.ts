import { describe, expect, test } from "bun:test";
import { parseSshConfigContent } from "../src/ssh/config-parser.ts";
import {
  clearSudoPassword,
  getSudoPassword,
  isSudoPasswordError,
  setSudoPassword,
  type SshTarget,
} from "../src/ssh/executor.ts";
import {
  parseNativeProbeOutput,
  parsePolicyFromHeadscaleYaml,
  parseRemoteIdentityOutput,
  patchHeadscalePolicyPathInYaml,
} from "../src/ssh/headscale.ts";

describe("parseSshConfigContent", () => {
  test("parses concrete hosts and skips wildcards and Match blocks", () => {
    const sample = `
# Global defaults
Host *
  ServerAliveInterval 60

Host oracle
  HostName 129.146.10.20
  User ubuntu
  Port 2222
  IdentityFile ~/.ssh/oracle_ed25519

Host nas-local
  HostName 192.168.1.50
  User root

Match host *.internal
  User ops
`;
    const entries = parseSshConfigContent(sample);
    expect(entries).toHaveLength(2);

    expect(entries[0]).toMatchObject({
      alias: "oracle",
      hostName: "129.146.10.20",
      user: "ubuntu",
      port: 2222,
    });
    expect(entries[0]!.identityFile?.endsWith("/.ssh/oracle_ed25519")).toBe(true);

    expect(entries[1]).toEqual({
      alias: "nas-local",
      hostName: "192.168.1.50",
      user: "root",
      port: undefined,
      identityFile: undefined,
    });
  });
});

describe("parseNativeProbeOutput", () => {
  test("extracts executable, version, installer, service unit, and config path", () => {
    const output = `
BIN=/usr/bin/headscale
NEED_SUDO=1
SUDO_USER=headscale
SOCKET_OK=1
VER=headscale version 0.25.1
INSTALLER=dnf
INSTALLER_DETAIL=dnf (headscale-0.25.1-1.x86_64)
SERVICE=/usr/lib/systemd/system/headscale.service (active)
CFG=/etc/headscale/config.yaml
`;
    const parsed = parseNativeProbeOutput(output);
    expect(parsed).toEqual({
      headscaleBin: "/usr/bin/headscale",
      headscaleVersion: "headscale version 0.25.1",
      headscaleInstaller: "dnf",
      headscaleInstallerDetail: "dnf (headscale-0.25.1-1.x86_64)",
      serviceUnit: "/usr/lib/systemd/system/headscale.service (active)",
      useSudo: true,
      sudoUser: "headscale",
      socketAccessible: true,
      configPath: "/etc/headscale/config.yaml",
    });
  });
});

describe("sudo password helpers", () => {
  test("detects sudo password errors and caches password in memory per target", () => {
    expect(isSudoPasswordError("sudo: a password is required")).toBe(true);
    expect(isSudoPasswordError("Sorry, try again.")).toBe(true);
    expect(isSudoPasswordError("file not found")).toBe(false);

    const target: SshTarget = {
      hostAlias: "oracle",
      hostName: "100.64.0.1",
      user: "ubuntu",
      isLocal: false,
    };
    expect(getSudoPassword(target)).toBeUndefined();
    setSudoPassword(target, "secret123");
    expect(getSudoPassword(target)).toBe("secret123");
    clearSudoPassword(target);
    expect(getSudoPassword(target)).toBeUndefined();
  });
});

describe("Headscale policy.path & remote identity parsers", () => {
  test("parseRemoteIdentityOutput strips key= prefix cleanly", () => {
    const parsed = parseRemoteIdentityOutput("TS_IP=100.64.0.3\nHOST=oracle\n");
    expect(parsed).toEqual({
      tailscaleIp: "100.64.0.3",
      remoteHostname: "oracle",
    });
  });

  test("parsePolicyFromHeadscaleYaml flags empty policy.path as unconfigured", () => {
    const emptyPathYaml = `
policy:
  mode: file
  path: ""
`;
    expect(parsePolicyFromHeadscaleYaml(emptyPathYaml, "/etc/headscale")).toEqual({
      policyMode: "file",
      aclPath: "/etc/headscale/acl.hujson",
      policyPathConfigured: false,
    });

    const configuredYaml = `
policy:
  mode: file
  path: "/etc/headscale/custom.hujson"
`;
    expect(parsePolicyFromHeadscaleYaml(configuredYaml, "/etc/headscale")).toEqual({
      policyMode: "file",
      aclPath: "/etc/headscale/custom.hujson",
      policyPathConfigured: true,
    });

    const dbYaml = `
policy:
  mode: database
`;
    expect(parsePolicyFromHeadscaleYaml(dbYaml, "/etc/headscale")).toEqual({
      policyMode: "database",
      policyPathConfigured: true,
    });
  });

  test("patchHeadscalePolicyPathInYaml activates empty policy.path while preserving comments", () => {
    const sample = `# Headscale config
policy:
  # The mode can be "file" or "database"
  mode: file
  # Path to HuJSON file
  path: ""

dns:
  magic_dns: true
`;
    const res = patchHeadscalePolicyPathInYaml(sample, "/etc/headscale/acl.hujson");
    expect(res.changed).toBe(true);
    expect(res.updated).toContain('  path: "/etc/headscale/acl.hujson"');
    expect(res.updated).toContain("# Path to HuJSON file");
    expect(res.updated).toContain("magic_dns: true");

    // Re-running is idempotent
    const second = patchHeadscalePolicyPathInYaml(res.updated, "/etc/headscale/acl.hujson");
    expect(second.changed).toBe(false);
    expect(second.updated).toBe(res.updated);
  });

  test("patchHeadscalePolicyPathInYaml inserts path when policy block only has mode", () => {
    const sample = `policy:\n  mode: file\ndns:\n  magic_dns: true\n`;
    const res = patchHeadscalePolicyPathInYaml(sample, "/etc/headscale/acl.hujson");
    expect(res.changed).toBe(true);
    expect(res.updated).toContain('  mode: file\n  path: "/etc/headscale/acl.hujson"\n');
  });
});
