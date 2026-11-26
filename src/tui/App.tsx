import { useEffect, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { loadLocalConfig, saveLocalConfig } from "../engine/store.ts";
import { createDemoEnvironment } from "../ssh/demo-data.ts";
import { getLocalTailscaleInfo, type LocalTailscaleInfo } from "../ssh/discovery.ts";
import {
  detectRemoteTailscaleIdentity,
  fetchCurrentPolicyRaw,
  fetchHeadscaleInventory,
  loadStateWithLocalPriority,
  serverToTarget,
} from "../ssh/headscale.ts";
import type {
  Device,
  HeadscaleUser,
  ServerConfig,
  TaclState,
} from "../types/model.ts";
import { MainLayout } from "./screens/MainLayout.tsx";
import { type SetupResult, SetupWizard } from "./screens/SetupWizard.tsx";
import { THEME } from "./theme.ts";

export interface AppProps {
  demoMode: boolean;
  forceRescan: boolean;
}

type BootState =
  | { status: "booting"; message: string }
  | { status: "wizard" }
  | {
      status: "ready";
      server: ServerConfig;
      users: HeadscaleUser[];
      devices: Device[];
      state: TaclState;
      existingPolicyRaw: string;
      tailscaleInfo?: LocalTailscaleInfo;
    };

export function App({ demoMode, forceRescan }: AppProps) {
  const renderer = useRenderer();
  const [boot, setBoot] = useState<BootState>(() => {
    if (demoMode) {
      const demo = createDemoEnvironment();
      return {
        status: "ready",
        ...demo,
      };
    }
    return { status: "booting", message: "Cargando configuración de tacl..." };
  });

  const handleExit = () => {
    renderer.destroy();
    process.exit(0);
  };

  // Allow Ctrl+C to exit during booting splash screen
  useKeyboard((key) => {
    if (boot.status === "booting" && key.ctrl && key.name === "c") {
      handleExit();
    }
  });

  useEffect(() => {
    if (demoMode) return;
    if (forceRescan) {
      setBoot({ status: "wizard" });
      return;
    }

    const tryAutoConnect = async () => {
      const cfg = await loadLocalConfig();
      if (!cfg.server) {
        setBoot({ status: "wizard" });
        return;
      }

      setBoot({
        status: "booting",
        message: `Conectando con ${cfg.server.hostAlias}...`,
      });

      const [identity, inv, pol, savedState, tsInfo] = await Promise.all([
        detectRemoteTailscaleIdentity(serverToTarget(cfg.server)),
        fetchHeadscaleInventory(cfg.server),
        fetchCurrentPolicyRaw(cfg.server),
        loadStateWithLocalPriority(cfg.server),
        getLocalTailscaleInfo(),
      ]);

      if (inv.error || !savedState.state.initialized) {
        // Fallback to wizard if cached server is unreachable or uninitialized
        setBoot({ status: "wizard" });
        return;
      }

      const resolvedBase = inv.resolvedServer ?? cfg.server;
      const enrichedServer: ServerConfig = {
        ...resolvedBase,
        serverTailscaleIp: identity.tailscaleIp ?? resolvedBase.serverTailscaleIp,
        serverRemoteHostname:
          identity.remoteHostname ?? resolvedBase.serverRemoteHostname,
      };

      setBoot({
        status: "ready",
        server: enrichedServer,
        users: inv.users,
        devices: inv.devices,
        state: savedState.state,
        existingPolicyRaw: pol.raw,
        tailscaleInfo: tsInfo,
      });
    };

    void tryAutoConnect();
  }, [demoMode, forceRescan]);

  const handleWizardComplete = async (res: SetupResult) => {
    await saveLocalConfig({ version: 1, server: res.server });
    setBoot({
      status: "ready",
      server: res.server,
      users: res.users,
      devices: res.devices,
      state: res.state,
      existingPolicyRaw: res.existingPolicyRaw,
      tailscaleInfo: res.tailscaleInfo,
    });
  };

  if (boot.status === "booting") {
    return (
      <box
        width="100%"
        height="100%"
        justifyContent="center"
        alignItems="center"
        backgroundColor={THEME.bg}
      >
        <box
          border
          borderStyle="rounded"
          borderColor={THEME.borderActive}
          backgroundColor={THEME.surface}
          padding={2}
        >
          <text fg={THEME.cyan}>{boot.message}</text>
        </box>
      </box>
    );
  }

  if (boot.status === "wizard") {
    return (
      <SetupWizard
        onComplete={(res) => {
          void handleWizardComplete(res);
        }}
        onExit={handleExit}
      />
    );
  }

  return (
    <MainLayout
      server={boot.server}
      initialUsers={boot.users}
      initialDevices={boot.devices}
      initialState={boot.state}
      initialPolicyRaw={boot.existingPolicyRaw}
      tailscaleInfo={boot.tailscaleInfo}
      isDemo={demoMode}
      onRescan={() => setBoot({ status: "wizard" })}
      onExit={handleExit}
    />
  );
}
