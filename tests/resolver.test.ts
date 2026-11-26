import { describe, expect, test } from "bun:test";
import {
  resolveEffectiveConnections,
  validatePortSpec,
} from "../src/engine/resolver.ts";
import type { Device, HeadscaleUser, TaclState } from "../src/types/model.ts";

const users: HeadscaleUser[] = [
  { id: "u1", name: "personal" },
  { id: "u2", name: "trabajo" },
];

const devices: Device[] = [
  {
    id: "d1",
    name: "portatil",
    userId: "u1",
    userName: "personal",
    ipAddresses: ["100.64.0.1"],
    online: true,
    tags: [],
  },
  {
    id: "d2",
    name: "oracle",
    userId: "u1",
    userName: "personal",
    ipAddresses: ["100.64.0.2"],
    online: true,
    tags: [],
  },
  {
    id: "d3",
    name: "pc-trabajo",
    userId: "u2",
    userName: "trabajo",
    ipAddresses: ["100.64.0.3"],
    online: true,
    tags: [],
  },
];

describe("resolveEffectiveConnections", () => {
  test("precedence: Device > Profile > User > Default", () => {
    const state: TaclState = {
      version: 1,
      initialized: true,
      defaultPolicy: "deny",
      profiles: [
        { id: "p1", name: "admins", deviceIds: ["d1", "d2"] },
        { id: "p2", name: "oficina", deviceIds: ["d3"] },
      ],
      rules: [
        // User level allows u1 <-> u1
        {
          id: "r-user",
          scope: "user",
          sourceId: "u1",
          targetId: "u1",
          direction: "both",
          protocol: "both",
          ports: ["*"],
        },
        // Profile level allows p1 -> p2 on TCP 443
        {
          id: "r-prof",
          scope: "profile",
          sourceId: "p1",
          targetId: "p2",
          direction: "a_to_b",
          protocol: "tcp",
          ports: ["443"],
        },
        // Device level explicitly blocks d1 <-> d2 (overrides u1 <-> u1)
        {
          id: "r-dev",
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

    const { connections, conflicts } = resolveEffectiveConnections(devices, users, state);
    expect(conflicts).toHaveLength(0);

    const d1d2 = connections.find((c) => c.deviceAId === "d1" && c.deviceBId === "d2")!;
    expect(d1d2.direction).toBe("deny");
    expect(d1d2.origin.kind).toBe("device");

    const d1d3 = connections.find((c) => c.deviceAId === "d1" && c.deviceBId === "d3")!;
    expect(d1d3.direction).toBe("a_to_b");
    expect(d1d3.protocol).toBe("tcp");
    expect(d1d3.ports).toEqual(["443"]);
    expect(d1d3.origin.kind).toBe("profile");
  });

  test("detects conflict when a device belongs to multiple profiles with opposing rules", () => {
    const state: TaclState = {
      version: 1,
      initialized: true,
      defaultPolicy: "deny",
      profiles: [
        { id: "p1", name: "casa", deviceIds: ["d1", "d2"] },
        { id: "p2", name: "restringidos", deviceIds: ["d1", "d2"] },
      ],
      rules: [
        {
          id: "r1",
          scope: "profile",
          sourceId: "p1",
          targetId: "p1",
          direction: "both",
          protocol: "both",
          ports: ["*"],
        },
        {
          id: "r2",
          scope: "profile",
          sourceId: "p2",
          targetId: "p2",
          direction: "deny",
          protocol: "both",
          ports: ["*"],
        },
      ],
      conflictResolutions: [],
    };

    const { connections, conflicts } = resolveEffectiveConnections(devices, users, state);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.competingRules).toHaveLength(2);

    const d1d2 = connections.find((c) => c.deviceAId === "d1" && c.deviceBId === "d2")!;
    expect(d1d2.hasConflict).toBe(true);
    expect(d1d2.origin.kind).toBe("conflict");

    // Once user resolves conflict choosing r1
    state.conflictResolutions.push({ pairKey: d1d2.pairKey, winningRuleId: "r1" });
    const resolved = resolveEffectiveConnections(devices, users, state);
    expect(resolved.conflicts).toHaveLength(0);
    const d1d2After = resolved.connections.find(
      (c) => c.deviceAId === "d1" && c.deviceBId === "d2"
    )!;
    expect(d1d2After.direction).toBe("both");
    expect(d1d2After.hasConflict).toBe(false);
    expect(d1d2After.origin.kind).toBe("profile");
  });

  test("device rule overrides even a multi-profile conflict", () => {
    const state: TaclState = {
      version: 1,
      initialized: true,
      defaultPolicy: "deny",
      profiles: [
        { id: "p1", name: "casa", deviceIds: ["d1", "d2"] },
        { id: "p2", name: "restringidos", deviceIds: ["d1", "d2"] },
      ],
      rules: [
        {
          id: "r1",
          scope: "profile",
          sourceId: "p1",
          targetId: "p1",
          direction: "both",
          protocol: "both",
          ports: ["*"],
        },
        {
          id: "r2",
          scope: "profile",
          sourceId: "p2",
          targetId: "p2",
          direction: "deny",
          protocol: "both",
          ports: ["*"],
        },
        {
          id: "r-dev-override",
          scope: "device",
          sourceId: "d2",
          targetId: "d1",
          direction: "a_to_b", // d2 -> d1 means b_to_a for canonical (d1, d2)
          protocol: "tcp",
          ports: ["22"],
        },
      ],
      conflictResolutions: [],
    };

    const { connections, conflicts } = resolveEffectiveConnections(devices, users, state);
    expect(conflicts).toHaveLength(0);
    const d1d2 = connections.find((c) => c.deviceAId === "d1" && c.deviceBId === "d2")!;
    expect(d1d2.direction).toBe("b_to_a");
    expect(d1d2.protocol).toBe("tcp");
    expect(d1d2.ports).toEqual(["22"]);
  });

  test("protects SSH management pair from being blocked under default-deny", () => {
    const state: TaclState = {
      version: 1,
      initialized: true,
      defaultPolicy: "deny",
      profiles: [],
      rules: [],
      conflictResolutions: [],
    };

    const { connections } = resolveEffectiveConnections(devices, users, state, {
      localDeviceId: "d1",
      serverDeviceId: "d2",
      sshPort: 22,
    });

    const d1d2 = connections.find((c) => c.deviceAId === "d1" && c.deviceBId === "d2")!;
    expect(d1d2.isSshProtected).toBe(true);
    expect(d1d2.sshFallbackInjected).toBe(true);
    expect(d1d2.direction).toBe("a_to_b");
    expect(d1d2.protocol).toBe("tcp");
    expect(d1d2.ports).toEqual(["22"]);
    expect(d1d2.origin.kind).toBe("protected");
  });

  test("validates port specs properly", () => {
    expect(validatePortSpec("*").valid).toBe(true);
    expect(validatePortSpec("22").valid).toBe(true);
    expect(validatePortSpec("8000-8080").valid).toBe(true);
    expect(validatePortSpec("9000-8000").valid).toBe(false);
    expect(validatePortSpec("70000").valid).toBe(false);
    expect(validatePortSpec("abc").valid).toBe(false);
  });
});
