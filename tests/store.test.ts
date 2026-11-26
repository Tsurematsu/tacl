import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deserializeTaclState,
  loadLocalState,
  saveLocalState,
  serializeTaclState,
} from "../src/engine/store.ts";
import type { TaclState } from "../src/types/model.ts";

describe("local state persistence", () => {
  test("saves and restores unapplied rules, profiles, and uiState (activeTab + hasUnappliedChanges)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tacl-store-test-"));
    try {
      const state: TaclState = {
        version: 1,
        initialized: true,
        defaultPolicy: "deny",
        profiles: [{ id: "p1", name: "Admins", deviceIds: ["d1", "d2"] }],
        rules: [
          {
            id: "r1",
            scope: "device",
            sourceId: "d1",
            targetId: "d2",
            direction: "a_to_b",
            protocol: "tcp",
            ports: ["22", "443"],
          },
        ],
        conflictResolutions: [],
        uiState: {
          activeTab: "profiles",
          hasUnappliedChanges: true,
          updatedAt: "2026-11-25T23:20:00.000Z",
        },
      };

      await saveLocalState("oracle", state, dir);
      const loaded = await loadLocalState("oracle", dir);
      expect(loaded.existed).toBe(true);
      expect(loaded.state).toEqual(state);

      // Roundtrip YAML serialization check
      const roundtrip = deserializeTaclState(serializeTaclState(state));
      expect(roundtrip.uiState?.activeTab).toBe("profiles");
      expect(roundtrip.uiState?.hasUnappliedChanges).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
