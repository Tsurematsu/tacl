import { describe, expect, test } from "bun:test";
import { compileToHeadscalePolicy } from "../src/engine/compiler.ts";
import type { Device, HeadscaleUser, TaclState } from "../src/types/model.ts";

const users: HeadscaleUser[] = [{ id: "u1", name: "admin" }];
const devices: Device[] = [
  {
    id: "d1",
    name: "portatil",
    userId: "u1",
    userName: "admin",
    ipAddresses: ["100.64.0.1"],
    online: true,
    tags: [],
  },
  {
    id: "d2",
    name: "oracle",
    userId: "u1",
    userName: "admin",
    ipAddresses: ["100.64.0.2"],
    online: true,
    tags: [],
  },
];

describe("compileToHeadscalePolicy", () => {
  test("passthrough mode with zero rules preserves existing policy without extra restrictions", () => {
    const existing = `{
      // Existing comment
      "autoApprovers": { "exitNode": ["tag:exit"] },
      "acls": [{ "action": "accept", "src": ["*"], "dst": ["*:*"] }]
    }`;
    const state: TaclState = {
      version: 1,
      initialized: true,
      defaultPolicy: "passthrough",
      profiles: [],
      rules: [],
      conflictResolutions: [],
    };

    const res = compileToHeadscalePolicy(devices, users, state, {
      existingPolicyRaw: existing,
    });
    expect(res.isPassthrough).toBe(true);
    expect(res.policy.autoApprovers).toEqual({ exitNode: ["tag:exit"] });
    expect(res.policy.acls).toHaveLength(1);
  });

  test("compiles TCP, UDP, and Both protocols with ports and preserves extra sections", () => {
    const existing = `{
      "ssh": [{ "action": "accept", "src": ["admin"], "dst": ["admin"], "users": ["root"] }]
    }`;
    const state: TaclState = {
      version: 1,
      initialized: true,
      defaultPolicy: "deny",
      profiles: [],
      rules: [
        {
          id: "r1",
          scope: "device",
          sourceId: "d1",
          targetId: "d2",
          direction: "a_to_b",
          protocol: "both",
          ports: ["22", "443"],
        },
      ],
      conflictResolutions: [],
    };

    const res = compileToHeadscalePolicy(devices, users, state, {
      existingPolicyRaw: existing,
      localDeviceId: "d1",
      serverDeviceId: "d2",
    });

    expect(res.isPassthrough).toBe(false);
    expect(res.warnings).toHaveLength(0);
    expect(res.policy.ssh).toBeDefined();
    expect(res.policy.hosts).toEqual({
      portatil: "100.64.0.1",
      oracle: "100.64.0.2",
    });
    // Both + specific ports generates one TCP rule and one UDP rule
    expect(res.policy.acls).toEqual([
      { action: "accept", proto: "tcp", src: ["portatil"], dst: ["oracle:22,443"] },
      { action: "accept", proto: "udp", src: ["portatil"], dst: ["oracle:22,443"] },
    ]);
  });

  test("enforces SSH management protection automatically if rules would block local -> server", () => {
    const state: TaclState = {
      version: 1,
      initialized: true,
      defaultPolicy: "deny",
      profiles: [],
      rules: [
        {
          id: "r1",
          scope: "device",
          sourceId: "d1",
          targetId: "d2",
          direction: "deny",
          protocol: "both",
          ports: ["*"],
        },
      ],
      conflictResolutions: [],
    };

    const res = compileToHeadscalePolicy(devices, users, state, {
      localDeviceId: "d1",
      serverDeviceId: "d2",
      sshPort: 2222,
    });

    expect(res.protectedSshApplied).toBe(true);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]!.message).toContain("Protección SSH activa");
    // Compiled ACL MUST still include TCP/2222 from portatil -> oracle!
    expect(res.policy.acls).toEqual([
      { action: "accept", proto: "tcp", src: ["portatil"], dst: ["oracle:2222"] },
    ]);
  });
});
