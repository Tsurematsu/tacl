import { useEffect, useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { createEmptyState, saveLocalState } from "../../engine/store.ts";
import {
  discoverReachableHosts,
  gatherHostCandidates,
  getLocalTailscaleInfo,
  type LocalTailscaleInfo,
} from "../../ssh/discovery.ts";
import { execOnTarget, setSudoPassword, type SshTarget } from "../../ssh/executor.ts";
import {
  type ContainerHint,
  detectContainerHints,
  detectNativeHeadscale,
  detectRemoteTailscaleIdentity,
  fetchCurrentPolicyRaw,
  fetchHeadscaleInventory,
  inspectContainerDir,
  loadStateWithLocalPriority,
  type NativeDetectionResult,
  serverToTarget,
} from "../../ssh/headscale.ts";
import type {
  ConnectionRule,
  Device,
  HeadscaleUser,
  ServerConfig,
  SshHostCandidate,
  TaclState,
} from "../../types/model.ts";
import { RemoteBrowser } from "../components/RemoteBrowser.tsx";
import { SudoPasswordModal } from "../modals/SudoPasswordModal.tsx";
import { THEME } from "../theme.ts";

export interface SetupResult {
  server: ServerConfig;
  users: HeadscaleUser[];
  devices: Device[];
  state: TaclState;
  existingPolicyRaw: string;
  tailscaleInfo: LocalTailscaleInfo;
}

export interface SetupWizardProps {
  onComplete: (result: SetupResult) => void;
  onExit: () => void;
}

type WizardStep =
  | "choose_method"
  | "manual_entry"
  | "testing_manual"
  | "scanning"
  | "select_host"
  | "select_mode"
  | "detecting_native"
  | "confirm_native"
  | "browse_container"
  | "loading_inventory"
  | "init_rules_choice";

type ManualField = 0 | 1 | 2 | 3; // 0=host, 1=user, 2=port, 3=identityFile

export function SetupWizard({ onComplete, onExit }: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>("choose_method");
  const [methodCursor, setMethodCursor] = useState<0 | 1>(0); // 0=Auto, 1=Manual
  const [cameFromManual, setCameFromManual] = useState(false);

  // Manual entry fields
  const [manualField, setManualField] = useState<ManualField>(0);
  const [manualHost, setManualHost] = useState("");
  const [manualUser, setManualUser] = useState("");
  const [manualPort, setManualPort] = useState("22");
  const [manualKey, setManualKey] = useState("");
  const [availableHosts, setAvailableHosts] = useState<SshHostCandidate[]>([]);
  const [hostDropdownOpen, setHostDropdownOpen] = useState(false);
  const [dropdownCursor, setDropdownCursor] = useState(0);

  // Preload available server candidates (localhost, ~/.ssh/config, tailscale peers) for manual dropdown
  useEffect(() => {
    void gatherHostCandidates().then(({ candidates, tailscaleInfo: ts }) => {
      setAvailableHosts(candidates);
      setTailscaleInfo(ts);
    });
  }, []);

  const filteredDropdownHosts = useMemo(() => {
    const q = manualHost.trim().toLowerCase();
    if (!q) return availableHosts;
    return availableHosts.filter(
      (h) =>
        h.alias.toLowerCase().includes(q) ||
        h.hostName.toLowerCase().includes(q) ||
        (h.tailscaleIp?.toLowerCase().includes(q) ?? false)
    );
  }, [availableHosts, manualHost]);

  // Auto scan state
  const [scanProgress, setScanProgress] = useState("Iniciando escaneo SSH...");
  const [reachableHosts, setReachableHosts] = useState<SshHostCandidate[]>([]);
  const [totalChecked, setTotalChecked] = useState(0);
  const [tailscaleInfo, setTailscaleInfo] = useState<LocalTailscaleInfo>({
    available: false,
    peers: [],
  });

  const [hostCursor, setHostCursor] = useState(0);
  const [selectedHost, setSelectedHost] = useState<SshHostCandidate | null>(null);
  const [modeCursor, setModeCursor] = useState(0); // 0 = Native, 1 = Container
  const [nativeDetection, setNativeDetection] = useState<NativeDetectionResult | null>(
    null
  );
  const [containerHints, setContainerHints] = useState<ContainerHint[]>([]);
  const [containerUseSudo, setContainerUseSudo] = useState(false);

  const [builtServer, setBuiltServer] = useState<ServerConfig | null>(null);
  const [loadedUsers, setLoadedUsers] = useState<HeadscaleUser[]>([]);
  const [loadedDevices, setLoadedDevices] = useState<Device[]>([]);
  const [loadedPolicyRaw, setLoadedPolicyRaw] = useState("");
  const [initChoiceCursor, setInitChoiceCursor] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sudoPrompt, setSudoPrompt] = useState<{
    server: ServerConfig;
    reason: string;
    error?: string;
  } | null>(null);

  const runScan = async () => {
    setCameFromManual(false);
    setStep("scanning");
    setErrorMsg(null);
    const res = await discoverReachableHosts((done, total, current) => {
      setScanProgress(`Validando acceso SSH (${done}/${total}): ${current}...`);
    });
    setReachableHosts(res.reachable);
    setTotalChecked(res.totalChecked);
    setTailscaleInfo(res.tailscaleInfo);
    setHostCursor(0);
    setStep("select_host");
  };

  const testManualConnection = async () => {
    const host = manualHost.trim();
    const user = manualUser.trim() || undefined;
    const portRaw = manualPort.trim();
    const keyPath = manualKey.trim() || undefined;

    if (!host) {
      setErrorMsg("Debes ingresar el servidor (IP, dominio o alias de SSH).");
      setManualField(0);
      return;
    }

    let port: number | undefined;
    if (portRaw) {
      const parsed = Number(portRaw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        setErrorMsg("Puerto SSH inválido (usa un número entre 1 y 65535).");
        setManualField(2);
        return;
      }
      port = parsed;
    }

    const isLocal = host === "localhost" || host === "127.0.0.1";
    const candidate: SshHostCandidate = {
      id: `manual:${user ? `${user}@` : ""}${host}`,
      alias: host,
      hostName: host,
      user,
      port,
      identityFile: keyPath,
      isLocal,
      source: isLocal ? "local" : "ssh_config",
    };

    setErrorMsg(null);
    setStep("testing_manual");

    const [probeRes, tsInfo] = await Promise.all([
      execOnTarget(
        {
          hostAlias: candidate.alias,
          hostName: candidate.hostName,
          user: candidate.user,
          port: candidate.port,
          identityFile: candidate.identityFile,
          isLocal: candidate.isLocal,
        },
        "echo TACL_MANUAL_OK",
        { timeoutMs: 7000, connectTimeoutSec: 5 }
      ),
      getLocalTailscaleInfo(),
    ]);

    setTailscaleInfo(tsInfo);

    if (!probeRes.stdout.includes("TACL_MANUAL_OK")) {
      const detail = probeRes.stderr.trim() || "No se pudo conectar por llave SSH (BatchMode=yes).";
      setErrorMsg(`Fallo de conexión a ${user ? `${user}@` : ""}${host}: ${detail}`);
      setStep("manual_entry");
      return;
    }

    setCameFromManual(true);
    setSelectedHost({ ...candidate, reachable: true });
    setModeCursor(0);
    setStep("select_mode");
  };

  const candidateToTarget = (c: SshHostCandidate): SshTarget => ({
    hostAlias: c.alias,
    hostName: c.hostName,
    user: c.user,
    port: c.port,
    identityFile: c.identityFile,
    isLocal: c.isLocal,
  });

  const loadServerData = async (rawServer: ServerConfig) => {
    setStep("loading_inventory");
    setErrorMsg(null);

    const [identity, inventory, currentPolicy, savedState] = await Promise.all([
      detectRemoteTailscaleIdentity(serverToTarget(rawServer)),
      fetchHeadscaleInventory(rawServer),
      fetchCurrentPolicyRaw(rawServer),
      loadStateWithLocalPriority(rawServer),
    ]);

    const resolvedBase = inventory.resolvedServer ?? rawServer;
    const server: ServerConfig = {
      ...resolvedBase,
      serverTailscaleIp: identity.tailscaleIp ?? resolvedBase.serverTailscaleIp,
      serverRemoteHostname:
        identity.remoteHostname ?? resolvedBase.serverRemoteHostname,
    };
    setBuiltServer(server);

    if (inventory.error) {
      if (inventory.needsSudoPassword) {
        setSudoPrompt({
          server,
          reason: inventory.error,
          error: inventory.wrongPassword
            ? "Contraseña sudo incorrecta, intenta de nuevo."
            : undefined,
        });
        return;
      }
      setErrorMsg(inventory.error);
      setStep("select_mode");
      return;
    }

    setLoadedUsers(inventory.users);
    setLoadedDevices(inventory.devices);
    setLoadedPolicyRaw(currentPolicy.raw);

    if (savedState.existed && savedState.state.initialized) {
      onComplete({
        server,
        users: inventory.users,
        devices: inventory.devices,
        state: savedState.state,
        existingPolicyRaw: currentPolicy.raw,
        tailscaleInfo,
      });
      return;
    }

    // No prior tacl rules -> politely ask how to initialize
    setInitChoiceCursor(0);
    setStep("init_rules_choice");
  };

  const handleModeSelection = async (modeIndex: number) => {
    if (!selectedHost) return;
    const target = candidateToTarget(selectedHost);
    setErrorMsg(null);

    if (modeIndex === 0) {
      setStep("detecting_native");
      const detection = await detectNativeHeadscale(target);
      setNativeDetection(detection);
      setStep("confirm_native");
    } else {
      setStep("detecting_native");
      const { hints, useSudo } = await detectContainerHints(target);
      setContainerHints(hints);
      setContainerUseSudo(useSudo);
      setStep("browse_container");
    }
  };

  const finalizeInitialChoice = (choice: number) => {
    if (!builtServer) return;
    let state: TaclState;

    if (choice === 0) {
      // Keep default Headscale behavior, empty lists, no extra restrictions
      state = createEmptyState("passthrough", true);
    } else if (choice === 1) {
      // Isolate by Headscale Users: allow each user intra-user, deny cross-user
      const userRules: ConnectionRule[] = loadedUsers.map((u) => ({
        id: `rule-init-user-${u.id}`,
        scope: "user",
        sourceId: u.id,
        targetId: u.id,
        direction: "both",
        protocol: "both",
        ports: ["*"],
      }));
      state = {
        version: 1,
        initialized: true,
        defaultPolicy: "deny",
        profiles: [],
        rules: userRules,
        conflictResolutions: [],
      };
    } else {
      // Strict mode from scratch: empty lists, deny by default
      state = createEmptyState("deny", true);
    }

    void saveLocalState(builtServer.hostAlias, state).catch(() => {});

    onComplete({
      server: builtServer,
      users: loadedUsers,
      devices: loadedDevices,
      state,
      existingPolicyRaw: loadedPolicyRaw,
      tailscaleInfo,
    });
  };

  const updateManualFieldValue = (updater: (v: string) => string) => {
    if (manualField === 0) setManualHost(updater);
    else if (manualField === 1) setManualUser(updater);
    else if (manualField === 2) setManualPort(updater);
    else setManualKey(updater);
  };

  useKeyboard((key) => {
    if (step === "browse_container" || sudoPrompt !== null) {
      // Handled by RemoteBrowser or SudoPasswordModal
      return;
    }

    if (key.ctrl && key.name === "c") {
      onExit();
      return;
    }

    // Manual form needs normal letter keys (including 'q') for typing host/user!
    if (step === "manual_entry") {
      // Dropdown open on Servidor field
      if (hostDropdownOpen) {
        if (key.name === "escape" || key.name === "left") {
          setHostDropdownOpen(false);
          return;
        }
        if (key.name === "up") {
          setDropdownCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (key.name === "down") {
          setDropdownCursor((c) =>
            Math.min(Math.max(0, filteredDropdownHosts.length - 1), c + 1)
          );
          return;
        }
        if (key.name === "return") {
          const picked = filteredDropdownHosts[dropdownCursor];
          if (picked) {
            setManualHost(picked.alias);
            if (picked.user) setManualUser(picked.user);
            if (picked.port) setManualPort(String(picked.port));
            if (picked.identityFile) setManualKey(picked.identityFile);
            setErrorMsg(null);
          }
          setHostDropdownOpen(false);
          setManualField(1);
          return;
        }
        if (key.name === "backspace") {
          setManualHost((v) => v.slice(0, -1));
          setDropdownCursor(0);
          return;
        }
        if (key.name === "space") {
          setHostDropdownOpen(false);
          return;
        }
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          setManualHost((v) => v + key.sequence);
          setDropdownCursor(0);
          return;
        }
        return;
      }

      if (key.name === "escape") {
        setErrorMsg(null);
        setStep("choose_method");
        return;
      }
      if (manualField === 0 && (key.name === "space" || key.name === "right")) {
        setDropdownCursor(0);
        setHostDropdownOpen(true);
        return;
      }
      if (key.name === "up") {
        setManualField((f) => Math.max(0, f - 1) as ManualField);
        return;
      }
      if (key.name === "down" || key.name === "tab") {
        setManualField((f) => ((f + 1) % 4) as ManualField);
        return;
      }
      if (key.name === "return") {
        if (manualField === 0 && !manualHost.trim()) {
          setErrorMsg("Debes ingresar el servidor (o pulsa [Espacio] para elegir de la lista).");
          return;
        }
        if (manualField === 0 && !manualUser.trim()) {
          // Convenient flow: Enter on host jumps to user if empty
          setManualField(1);
          return;
        }
        void testManualConnection();
        return;
      }
      if (key.name === "backspace") {
        updateManualFieldValue((v) => v.slice(0, -1));
        setErrorMsg(null);
        return;
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        if (manualField === 2 && !/[0-9]/.test(key.sequence)) {
          return;
        }
        updateManualFieldValue((v) => v + key.sequence);
        setErrorMsg(null);
      }
      return;
    }

    if (key.name === "q") {
      onExit();
      return;
    }

    if (step === "choose_method") {
      if (key.name === "up" || key.name === "k") {
        setMethodCursor(0);
      } else if (key.name === "down" || key.name === "j") {
        setMethodCursor(1);
      } else if (key.name === "return") {
        setErrorMsg(null);
        if (methodCursor === 0) {
          void runScan();
        } else {
          setManualField(0);
          setStep("manual_entry");
        }
      }
      return;
    }

    if (step === "select_host") {
      if (key.name === "escape") {
        setStep("choose_method");
      } else if (key.name === "m") {
        setErrorMsg(null);
        setManualField(0);
        setStep("manual_entry");
      } else if (key.name === "up" || key.name === "k") {
        setHostCursor((c) => Math.max(0, c - 1));
      } else if (key.name === "down" || key.name === "j") {
        setHostCursor((c) => Math.min(Math.max(0, reachableHosts.length - 1), c + 1));
      } else if (key.name === "r") {
        void runScan();
      } else if (key.name === "return") {
        const chosen = reachableHosts[hostCursor];
        if (chosen) {
          setSelectedHost(chosen);
          setModeCursor(0);
          setErrorMsg(null);
          setStep("select_mode");
        }
      }
      return;
    }

    if (step === "select_mode") {
      if (key.name === "escape") {
        setStep(cameFromManual ? "manual_entry" : "select_host");
      } else if (key.name === "up" || key.name === "k") {
        setModeCursor(0);
      } else if (key.name === "down" || key.name === "j") {
        setModeCursor(1);
      } else if (key.name === "return") {
        void handleModeSelection(modeCursor);
      }
      return;
    }

    if (step === "confirm_native") {
      if (key.name === "escape") {
        setStep("select_mode");
      } else if (key.name === "return" && selectedHost && nativeDetection?.found) {
        const server: ServerConfig = {
          hostAlias: selectedHost.alias,
          hostName: selectedHost.hostName,
          user: selectedHost.user,
          port: selectedHost.port,
          identityFile: selectedHost.identityFile,
          isLocal: selectedHost.isLocal,
          deployMode: "native",
          policyMode: nativeDetection.policyMode,
          headscaleBin: nativeDetection.headscaleBin,
          headscaleVersion: nativeDetection.headscaleVersion,
          headscaleInstaller: nativeDetection.headscaleInstaller,
          headscaleInstallerDetail: nativeDetection.headscaleInstallerDetail,
          serviceUnit: nativeDetection.serviceUnit,
          useSudo: nativeDetection.useSudo,
          sudoUser: nativeDetection.sudoUser,
          configPath: nativeDetection.configPath,
          aclPath: nativeDetection.aclPath,
          policyPathConfigured: nativeDetection.policyPathConfigured,
          taclStatePath: nativeDetection.taclStatePath,
        };
        void loadServerData(server);
      }
      return;
    }

    if (step === "init_rules_choice") {
      if (key.name === "up" || key.name === "k") {
        setInitChoiceCursor((c) => Math.max(0, c - 1));
      } else if (key.name === "down" || key.name === "j") {
        setInitChoiceCursor((c) => Math.min(2, c + 1));
      } else if (key.name === "return") {
        finalizeInitialChoice(initChoiceCursor);
      }
    }
  });

  const manualFields: Array<{
    idx: ManualField;
    label: string;
    value: string;
    placeholder: string;
  }> = [
    {
      idx: 0,
      label: "Servidor (IP, dominio o alias ~/.ssh/config)",
      value: manualHost,
      placeholder: "ej. oracle, 100.64.0.1 o 129.146.x.y",
    },
    {
      idx: 1,
      label: "Usuario SSH",
      value: manualUser,
      placeholder: "ej. ubuntu, opc, root (vacío = usuario actual / ssh config)",
    },
    {
      idx: 2,
      label: "Puerto SSH (opcional)",
      value: manualPort,
      placeholder: "22",
    },
    {
      idx: 3,
      label: "Llave privada SSH (opcional)",
      value: manualKey,
      placeholder: "ej. ~/.ssh/id_ed25519 (vacío = llaves por defecto)",
    },
  ];

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={THEME.bg}
      padding={1}
      gap={1}
    >
      {/* Header */}
      <box
        border
        borderStyle="rounded"
        borderColor={THEME.borderActive}
        backgroundColor={THEME.surface}
        paddingX={2}
        paddingY={0}
        flexShrink={0}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text fg={THEME.accent}>
          <b>tacl — Asistente de Conexión a Headscale</b>
        </text>
        <text fg={THEME.muted}>
          {step === "manual_entry" ? "[Esc] Volver" : "[q] Salir"}
        </text>
      </box>

      {errorMsg ? (
        <box
          border
          borderColor={THEME.borderDanger}
          backgroundColor={THEME.surface}
          paddingX={2}
          paddingY={0}
        >
          <text fg={THEME.red}>{`⚠ ${errorMsg}`}</text>
        </box>
      ) : null}

      {/* Step 0: Choose Automatic vs Manual */}
      {step === "choose_method" ? (
        <box
          border
          borderStyle="rounded"
          borderColor={THEME.border}
          backgroundColor={THEME.surface}
          padding={2}
          flexGrow={1}
          flexDirection="column"
          gap={1}
        >
          <text fg={THEME.text}>
            <b>Paso 1/4 — ¿Cómo deseas seleccionar el servidor Headscale?</b>
          </text>

          <box flexDirection="column" gap={1} paddingTop={1}>
            <box
              padding={1}
              border
              borderColor={methodCursor === 0 ? THEME.borderActive : THEME.border}
              backgroundColor={methodCursor === 0 ? THEME.selectedBg : THEME.bg}
            >
              <text fg={methodCursor === 0 ? THEME.accent : THEME.text}>
                {methodCursor === 0 ? "▸ " : "  "}
                <b>Detección Automática (Recomendado)</b>
                {"\n"}
                <span fg={THEME.subtext}>
                  {"  "}Escanea tus hosts accesibles por llave SSH (~/.ssh/config, Tailscale y localhost) y detecta Headscale.
                </span>
              </text>
            </box>

            <box
              padding={1}
              border
              borderColor={methodCursor === 1 ? THEME.borderActive : THEME.border}
              backgroundColor={methodCursor === 1 ? THEME.selectedBg : THEME.bg}
            >
              <text fg={methodCursor === 1 ? THEME.accent : THEME.text}>
                {methodCursor === 1 ? "▸ " : "  "}
                <b>Selección Manual (Servidor y Usuario SSH)</b>
                {"\n"}
                <span fg={THEME.subtext}>
                  {"  "}Ingresa manualmente el servidor (IP/host), usuario SSH, puerto y llave opcional.
                </span>
              </text>
            </box>
          </box>

          <box flexGrow={1} />
          <text fg={THEME.subtext}>
            <span fg={THEME.accent}>[↑/↓]</span> Cambiar opción{"  "}
            <span fg={THEME.green}>[Enter]</span> Continuar{"  "}
            <span fg={THEME.muted}>[q]</span> Salir
          </text>
        </box>
      ) : null}

      {/* Step 1B: Manual Server + User form */}
      {step === "manual_entry" ? (
        <box
          border
          borderStyle="rounded"
          borderColor={THEME.borderActive}
          backgroundColor={THEME.surface}
          padding={1}
          flexGrow={1}
          flexDirection="column"
          gap={1}
        >
          <text fg={THEME.accent}>
            <b>Paso 1/4 — Conexión Manual (Servidor y Usuario SSH)</b>
          </text>

          <box flexDirection="column" gap={0} flexShrink={0}>
            {manualFields.map((f) => {
              const active = manualField === f.idx;
              const isHostField = f.idx === 0;
              return (
                <box
                  key={f.idx}
                  flexDirection="column"
                  flexShrink={0}
                  height={4}
                  border
                  borderColor={active ? THEME.borderActive : THEME.border}
                  backgroundColor={active ? THEME.surfaceAlt : THEME.bg}
                  paddingX={1}
                >
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={active ? THEME.accent : THEME.subtext}>
                      <b>{`${active ? "▸ " : "  "}${f.label}:`}</b>
                    </text>
                    {isHostField ? (
                      <text fg={hostDropdownOpen ? THEME.green : THEME.cyan}>
                        {hostDropdownOpen
                          ? `▴ Lista abierta (${filteredDropdownHosts.length})`
                          : `▾ Disponibles (${availableHosts.length}) [Espacio / →]`}
                      </text>
                    ) : null}
                  </box>
                  <text fg={f.value ? THEME.text : THEME.muted} truncate>
                    {f.value ? `${f.value}${active ? "█" : ""}` : active ? "█" : f.placeholder}
                  </text>
                </box>
              );
            })}
          </box>

          {/* Floating dropdown of available servers */}
          {hostDropdownOpen ? (
            <box
              position="absolute"
              top={7}
              left={2}
              right={2}
              zIndex={20}
              border
              borderStyle="rounded"
              borderColor={THEME.cyan}
              backgroundColor={THEME.modalBg}
              padding={1}
              flexDirection="column"
              gap={0}
            >
              <text fg={THEME.cyan}>
                <b>
                  {`Servidores disponibles (${filteredDropdownHosts.length}) — [↑/↓] elegir · [Enter] seleccionar · [Esc] cerrar:`}
                </b>
              </text>
              {filteredDropdownHosts.length === 0 ? (
                <text fg={THEME.muted}>
                  {"  (Sin coincidencias; escribe o pulsa Esc para usar el texto ingresado)"}
                </text>
              ) : (
                filteredDropdownHosts
                  .slice(
                    Math.max(0, dropdownCursor - 3),
                    Math.max(0, dropdownCursor - 3) + 7
                  )
                  .map((host, i) => {
                    const idx = Math.max(0, dropdownCursor - 3) + i;
                    const sel = idx === dropdownCursor;
                    const meta: string[] = [];
                    if (host.isLocal) meta.push("local");
                    else {
                      if (host.user) meta.push(`${host.user}@${host.hostName}`);
                      else meta.push(host.hostName);
                      meta.push(host.source === "ssh_config" ? "ssh_config" : "tailscale");
                    }
                    if (host.isControlServer) meta.push("ControlURL");

                    return (
                      <box
                        key={host.id}
                        paddingX={1}
                        backgroundColor={sel ? THEME.selectedBg : THEME.modalBg}
                      >
                        <text fg={sel ? THEME.green : THEME.text}>
                          {sel ? "▸ " : "  "}
                          <b>{host.alias}</b>
                          <span fg={THEME.muted}>{`  [${meta.join(" · ")}]`}</span>
                        </text>
                      </box>
                    );
                  })
              )}
            </box>
          ) : null}

          <box flexGrow={1} />
          <text fg={THEME.subtext}>
            {manualField === 0 ? (
              <>
                <span fg={THEME.cyan}>[Espacio / →]</span> Desplegar servidores{"  "}
              </>
            ) : null}
            <span fg={THEME.accent}>[↑/↓ / Tab]</span> Cambiar campo{"  "}
            <span fg={THEME.green}>[Enter]</span> Probar conexión y continuar{"  "}
            <span fg={THEME.muted}>[Esc]</span> Volver a Automático/Manual
          </text>
        </box>
      ) : null}

      {step === "testing_manual" ? (
        <box
          border
          borderStyle="rounded"
          borderColor={THEME.border}
          backgroundColor={THEME.surface}
          padding={2}
          flexGrow={1}
          flexDirection="column"
          gap={1}
        >
          <text fg={THEME.cyan}>
            <b>
              {`Validando acceso SSH con ${manualUser.trim() ? `${manualUser.trim()}@` : ""}${manualHost.trim()}...`}
            </b>
          </text>
          <text fg={THEME.muted}>Usando autenticación por llave SSH (BatchMode=yes).</text>
        </box>
      ) : null}

      {/* Step 1A: Automatic scan */}
      {step === "scanning" ? (
        <box
          border
          borderStyle="rounded"
          borderColor={THEME.border}
          backgroundColor={THEME.surface}
          padding={2}
          flexGrow={1}
          flexDirection="column"
          gap={1}
        >
          <text fg={THEME.cyan}>
            <b>Escaneando máquinas con acceso SSH (solo llaves configuradas)...</b>
          </text>
          <text fg={THEME.subtext}>{scanProgress}</text>
          <text fg={THEME.muted}>
            Solo se mostrarán máquinas donde tu cliente tiene acceso SSH real (BatchMode=yes).
          </text>
        </box>
      ) : null}

      {step === "select_host" ? (
        <box
          border
          borderStyle="rounded"
          borderColor={THEME.border}
          backgroundColor={THEME.surface}
          padding={2}
          flexGrow={1}
          flexDirection="column"
          gap={1}
        >
          <text fg={THEME.text}>
            <b>{`Paso 2/4 — Selecciona el servidor Headscale (${reachableHosts.length} accesibles de ${totalChecked} revisados):`}</b>
          </text>

          <box flexDirection="column" gap={0} flexGrow={1}>
            {reachableHosts.map((host, idx) => {
              const selected = idx === hostCursor;
              const tags: string[] = [];
              if (host.hasHeadscaleHint) tags.push("★ Headscale detectado");
              if (host.isControlServer) tags.push("ControlURL");
              if (host.isLocal) tags.push("Local");
              else if (host.user) tags.push(`${host.user}@${host.hostName}`);
              else tags.push(host.hostName);

              return (
                <box
                  key={host.id}
                  paddingX={1}
                  backgroundColor={selected ? THEME.selectedBg : THEME.surface}
                >
                  <text fg={selected ? THEME.accent : THEME.text}>
                    {selected ? "▸ " : "  "}
                    <b>{host.alias}</b>
                    <span fg={host.hasHeadscaleHint ? THEME.green : THEME.muted}>
                      {`   [${tags.join(" · ")}]`}
                    </span>
                  </text>
                </box>
              );
            })}
          </box>

          <text fg={THEME.subtext}>
            <span fg={THEME.accent}>[↑/↓]</span> Elegir{"  "}
            <span fg={THEME.green}>[Enter]</span> Continuar{"  "}
            <span fg={THEME.cyan}>[m]</span> Ingresar manual{"  "}
            <span fg={THEME.yellow}>[r]</span> Re-escanear{"  "}
            <span fg={THEME.muted}>[Esc]</span> Volver
          </text>
        </box>
      ) : null}

      {step === "select_mode" && selectedHost ? (
        <box
          border
          borderStyle="rounded"
          borderColor={THEME.border}
          backgroundColor={THEME.surface}
          padding={2}
          flexGrow={1}
          flexDirection="column"
          gap={1}
        >
          <text fg={THEME.text}>
            <b>
              {`Paso 3/4 — ¿Cómo está instalado Headscale en "${
                selectedHost.user ? `${selectedHost.user}@` : ""
              }${selectedHost.alias}"?`}
            </b>
          </text>

          <box flexDirection="column" gap={1} paddingTop={1}>
            <box
              padding={1}
              border
              borderColor={modeCursor === 0 ? THEME.borderActive : THEME.border}
              backgroundColor={modeCursor === 0 ? THEME.selectedBg : THEME.bg}
            >
              <text fg={modeCursor === 0 ? THEME.accent : THEME.text}>
                {modeCursor === 0 ? "▸ " : "  "}
                <b>Instalación Nativa (binario / systemd)</b>
                {"\n"}
                <span fg={THEME.subtext}>
                  {"  "}Intentará detectar automáticamente headscale, config.yaml y ruta del ACL.
                </span>
              </text>
            </box>

            <box
              padding={1}
              border
              borderColor={modeCursor === 1 ? THEME.borderActive : THEME.border}
              backgroundColor={modeCursor === 1 ? THEME.selectedBg : THEME.bg}
            >
              <text fg={modeCursor === 1 ? THEME.accent : THEME.text}>
                {modeCursor === 1 ? "▸ " : "  "}
                <b>Contenedor (Docker / Podman)</b>
                {"\n"}
                <span fg={THEME.subtext}>
                  {"  "}Te permitirá explorar y seleccionar la carpeta del contenedor y sus políticas.
                </span>
              </text>
            </box>
          </box>

          <box flexGrow={1} />
          <text fg={THEME.subtext}>
            <span fg={THEME.accent}>[↑/↓]</span> Cambiar{"  "}
            <span fg={THEME.green}>[Enter]</span> Seleccionar{"  "}
            <span fg={THEME.muted}>[Esc]</span> Volver
          </text>
        </box>
      ) : null}

      {step === "detecting_native" ? (
        <box
          border
          borderStyle="rounded"
          borderColor={THEME.border}
          backgroundColor={THEME.surface}
          padding={2}
          flexGrow={1}
        >
          <text fg={THEME.cyan}>Inspeccionando instalación de Headscale en el servidor...</text>
        </box>
      ) : null}

      {step === "confirm_native" && nativeDetection ? (
        <box
          border
          borderStyle="rounded"
          borderColor={nativeDetection.found ? THEME.green : THEME.borderDanger}
          backgroundColor={THEME.surface}
          padding={2}
          flexGrow={1}
          flexDirection="column"
          gap={1}
        >
          <text fg={nativeDetection.found ? THEME.green : THEME.red}>
            <b>
              {nativeDetection.found
                ? "✓ Headscale nativo detectado correctamente"
                : "✕ No se detectó Headscale nativo en este host"}
            </b>
          </text>
          <text fg={THEME.text}>{nativeDetection.message}</text>
          {nativeDetection.found ? (
            <box flexDirection="column" padding={1} backgroundColor={THEME.bg}>
              <text fg={THEME.subtext}>{`Ejecutable:  ${nativeDetection.headscaleBin}`}</text>
              {nativeDetection.headscaleVersion ? (
                <text fg={THEME.subtext}>{`Versión:     ${nativeDetection.headscaleVersion}`}</text>
              ) : null}
              <text fg={THEME.cyan}>{`Instalador:  ${nativeDetection.headscaleInstallerDetail}`}</text>
              {nativeDetection.serviceUnit ? (
                <text fg={THEME.subtext}>{`Servicio:    ${nativeDetection.serviceUnit}`}</text>
              ) : null}
              <text fg={THEME.subtext}>{`Config:      ${nativeDetection.configPath}`}</text>
              <text fg={THEME.subtext}>{`Modo ACL:    ${nativeDetection.policyMode}`}</text>
              <text fg={nativeDetection.socketAccessible ? THEME.green : THEME.yellow}>
                {`Permisos:    ${
                  !nativeDetection.socketAccessible
                    ? "⚠ Sin acceso al socket (verifica grupo 'headscale' o sudo sin contraseña)"
                    : nativeDetection.useSudo
                      ? nativeDetection.sudoUser
                        ? `sudo -u ${nativeDetection.sudoUser} (automático)`
                        : "sudo sin contraseña (automático)"
                      : "Acceso directo al socket"
                }`}
              </text>
              {nativeDetection.aclPath ? (
                <text fg={nativeDetection.policyPathConfigured ? THEME.subtext : THEME.yellow}>
                  {`Archivo ACL: ${nativeDetection.aclPath}${
                    nativeDetection.policyMode === "file" && !nativeDetection.policyPathConfigured
                      ? "  (⚠ policy.path vacío en config.yaml — se activará al aplicar)"
                      : ""
                  }`}
                </text>
              ) : null}
              <text fg={THEME.subtext}>{`Estado tacl: ${nativeDetection.taclStatePath}`}</text>
              <text fg={THEME.muted}>
                (Estos datos se guardarán automáticamente en ~/.config/tacl/config.json)
              </text>
            </box>
          ) : (
            <text fg={THEME.muted}>
              Pulsa [Esc] para volver y elegir modo Contenedor u otro servidor.
            </text>
          )}
          <box flexGrow={1} />
          <text fg={THEME.subtext}>
            {nativeDetection.found ? (
              <>
                <span fg={THEME.green}>[Enter]</span> Confirmar y conectar{"  "}
              </>
            ) : null}
            <span fg={THEME.muted}>[Esc]</span> Volver
          </text>
        </box>
      ) : null}

      {step === "browse_container" && selectedHost ? (
        <RemoteBrowser
          target={candidateToTarget(selectedHost)}
          hints={containerHints}
          onCancel={() => setStep("select_mode")}
          onSelectDir={async (dirPath, matchedHint) => {
            const target = candidateToTarget(selectedHost);
            const inspected = await inspectContainerDir(
              target,
              dirPath,
              matchedHint,
              containerUseSudo
            );
            const server: ServerConfig = {
              hostAlias: selectedHost.alias,
              hostName: selectedHost.hostName,
              user: selectedHost.user,
              port: selectedHost.port,
              identityFile: selectedHost.identityFile,
              isLocal: selectedHost.isLocal,
              deployMode: "container",
              policyMode: inspected.policyMode,
              containerRuntime: inspected.containerRuntime,
              containerName: inspected.containerName || "headscale",
              containerDir: inspected.dirPath,
              useSudo: inspected.useSudo,
              configPath: inspected.configPath,
              aclPath: inspected.aclPath,
              policyPathConfigured: inspected.policyPathConfigured,
              taclStatePath: inspected.taclStatePath,
            };
            void loadServerData(server);
          }}
        />
      ) : null}

      {step === "loading_inventory" ? (
        <box
          border
          borderStyle="rounded"
          borderColor={THEME.border}
          backgroundColor={THEME.surface}
          padding={2}
          flexGrow={1}
        >
          <text fg={THEME.cyan}>
            Cargando dispositivos, usuarios y política actual desde Headscale...
          </text>
        </box>
      ) : null}

      {step === "init_rules_choice" ? (
        <box
          border
          borderStyle="rounded"
          borderColor={THEME.borderActive}
          backgroundColor={THEME.surface}
          padding={2}
          flexGrow={1}
          flexDirection="column"
          gap={1}
        >
          <text fg={THEME.accent}>
            <b>Paso 4/4 — Aún no hay reglas configuradas en tacl</b>
          </text>
          <text fg={THEME.subtext}>
            {`Se encontraron ${loadedDevices.length} dispositivos y ${loadedUsers.length} usuarios en Headscale. ¿Cómo te gustaría comenzar?`}
          </text>

          <box flexDirection="column" gap={1} paddingTop={1}>
            {[
              {
                title: "1. Mantener como viene por defecto (Recomendado)",
                desc: "Deja las listas vacías y no añade restricciones adicionales hasta que ligues tus primeras reglas.",
              },
              {
                title: "2. Aislar automáticamente por Usuarios de Headscale",
                desc: "Permite que cada usuario vea sus propios dispositivos, pero bloquea la visibilidad entre usuarios distintos.",
              },
              {
                title: "3. Modo estricto desde cero (Default Deny)",
                desc: "Empieza con tablas vacías bloqueando todo lo que no ligues explícitamente.",
              },
            ].map((opt, idx) => {
              const active = idx === initChoiceCursor;
              return (
                <box
                  key={opt.title}
                  padding={1}
                  border
                  borderColor={active ? THEME.borderActive : THEME.border}
                  backgroundColor={active ? THEME.selectedBg : THEME.bg}
                >
                  <text fg={active ? THEME.green : THEME.text}>
                    {active ? "▸ " : "  "}
                    <b>{opt.title}</b>
                    {"\n"}
                    <span fg={THEME.subtext}>{`  ${opt.desc}`}</span>
                  </text>
                </box>
              );
            })}
          </box>

          <box flexGrow={1} />
          <text fg={THEME.subtext}>
            <span fg={THEME.accent}>[↑/↓]</span> Elegir opción{"  "}
            <span fg={THEME.green}>[Enter]</span> Comenzar
          </text>
        </box>
      ) : null}
      {sudoPrompt ? (
        <SudoPasswordModal
          hostLabel={`${sudoPrompt.server.user ? `${sudoPrompt.server.user}@` : ""}${sudoPrompt.server.hostAlias}`}
          reason={sudoPrompt.reason}
          errorMessage={sudoPrompt.error}
          onCancel={() => {
            setSudoPrompt(null);
            setErrorMsg("Se canceló la autenticación sudo.");
            setStep("select_mode");
          }}
          onSubmit={(pwd) => {
            const targetServer = sudoPrompt.server;
            setSudoPassword(serverToTarget(targetServer), pwd);
            setSudoPrompt(null);
            void loadServerData(targetServer);
          }}
        />
      ) : null}
    </box>
  );
}
