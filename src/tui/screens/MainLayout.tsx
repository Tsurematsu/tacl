import { useEffect, useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { compileToHeadscalePolicy } from "../../engine/compiler.ts";
import {
  allowsProtectedSshFlow,
  directionArrow,
  findExistingRule,
  isProtectedSshPair,
  normalizePorts,
  portsLabel,
  protocolLabel,
  resolveEffectiveConnections,
} from "../../engine/resolver.ts";
import { saveLocalState } from "../../engine/store.ts";
import type { LocalTailscaleInfo } from "../../ssh/discovery.ts";
import { setSudoPassword } from "../../ssh/executor.ts";
import {
  applyPolicyToHeadscale,
  fetchCurrentPolicyRaw,
  fetchHeadscaleInventory,
  saveStateLocalAndRemote,
  serverToTarget,
} from "../../ssh/headscale.ts";
import type {
  ConnectionRule,
  Device,
  Direction,
  EffectiveConnection,
  HeadscaleUser,
  Profile,
  ProtectedSshLink,
  Protocol,
  RuleScope,
  ServerConfig,
  TabId,
  TaclState,
} from "../../types/model.ts";
import {
  buildDisplayTableItems,
  type DisplayTableItem,
  RulesTable,
  type TableRow,
} from "../components/RulesTable.tsx";
import { StatusBar } from "../components/StatusBar.tsx";
import { TabBar } from "../components/TabBar.tsx";
import { ApplyDiffModal } from "../modals/ApplyDiffModal.tsx";
import { ConflictModal } from "../modals/ConflictModal.tsx";
import { type DeletableItem, DeleteModal } from "../modals/DeleteModal.tsx";
import { EditConnectionModal } from "../modals/EditConnectionModal.tsx";
import { ItemsPanelModal } from "../modals/ItemsPanelModal.tsx";
import { type LinkEntityOption, LinkModal } from "../modals/LinkModal.tsx";
import { PortsModal } from "../modals/PortsModal.tsx";
import { ProfileModal } from "../modals/ProfileModal.tsx";
import { QuickConnectModal } from "../modals/QuickConnectModal.tsx";
import { SudoPasswordModal } from "../modals/SudoPasswordModal.tsx";
import { directionColor, directionLabel, THEME } from "../theme.ts";

export interface MainLayoutProps {
  server: ServerConfig;
  initialUsers: HeadscaleUser[];
  initialDevices: Device[];
  initialState: TaclState;
  initialPolicyRaw: string;
  tailscaleInfo?: LocalTailscaleInfo;
  isDemo: boolean;
  onRescan: () => void;
  onExit: () => void;
}

const TAB_ORDER: TabId[] = ["devices", "profiles", "users", "direct"];

type ActiveModal =
  | null
  | { kind: "edit_conn"; rule: ConnectionRule; srcLabel: string; dstLabel: string }
  | { kind: "ports"; rule: ConnectionRule; ruleLabel: string }
  | { kind: "link"; scope: RuleScope }
  | { kind: "quick_connect"; scope: RuleScope }
  | { kind: "profile"; editing?: Profile; returnToItemsPanel?: { cursor: number } }
  | { kind: "items_panel"; scope: RuleScope; initialCursor?: number }
  | { kind: "delete"; preselectedId?: string }
  | { kind: "conflicts" }
  | { kind: "apply_diff" }
  | { kind: "sudo_refresh"; reason: string; error?: string }
  | { kind: "inspect_direct"; conn: EffectiveConnection };

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function MainLayout({
  server,
  initialUsers,
  initialDevices,
  initialState,
  initialPolicyRaw,
  tailscaleInfo,
  isDemo,
  onRescan,
  onExit,
}: MainLayoutProps) {
  const { height: termHeight } = useTerminalDimensions();

  const [users, setUsers] = useState<HeadscaleUser[]>(initialUsers);
  const [devices, setDevices] = useState<Device[]>(initialDevices);
  const [state, setState] = useState<TaclState>(initialState);
  const [existingPolicyRaw, setExistingPolicyRaw] = useState(initialPolicyRaw);
  const [policyPathConfigured, setPolicyPathConfigured] = useState(
    server.policyPathConfigured !== false
  );
  const [dirty, setDirty] = useState(Boolean(initialState.uiState?.hasUnappliedChanges));
  const [exiting, setExiting] = useState(false);

  const [activeTab, setActiveTab] = useState<TabId>(
    initialState.uiState?.activeTab ?? "devices"
  );
  const [selectedByTab, setSelectedByTab] = useState<Record<TabId, number>>({
    devices: 0,
    profiles: 0,
    users: 0,
    direct: 0,
  });

  // Grouped by origin by default; tracks expanded origin dropdowns per tab
  const [groupedByOrigin, setGroupedByOrigin] = useState(true);
  const [expandedGroupsByTab, setExpandedGroupsByTab] = useState<
    Record<TabId, Set<string>>
  >({
    devices: new Set(),
    profiles: new Set(),
    users: new Set(),
    direct: new Set(),
  });

  const [filtering, setFiltering] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [modal, setModal] = useState<ActiveModal>(null);
  const [toast, setToast] = useState<
    { message: string; kind: "info" | "success" | "warn" | "error" } | undefined
  >(undefined);

  const showToast = (
    message: string,
    kind: "info" | "success" | "warn" | "error" = "info"
  ) => {
    setToast({ message, kind });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const buildPersistableState = (
    overrideDirty?: boolean,
    overrideState?: TaclState
  ): TaclState => ({
    ...(overrideState ?? state),
    uiState: {
      activeTab,
      hasUnappliedChanges: overrideDirty ?? dirty,
      updatedAt: new Date().toISOString(),
    },
  });

  // Auto-save local snapshot on changes so local copy is always current
  useEffect(() => {
    if (isDemo) return;
    const timer = setTimeout(() => {
      void saveLocalState(server.hostAlias, buildPersistableState()).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [state, activeTab, dirty, isDemo, server.hostAlias]);

  const handleSaveAndExit = () => {
    if (exiting) return;
    if (isDemo) {
      onExit();
      return;
    }
    setExiting(true);
    showToast("Guardando selecciones y cambios en local y remoto...", "info");
    const snapshot = buildPersistableState();
    void saveStateLocalAndRemote(server, snapshot)
      .catch(() => {})
      .finally(() => {
        onExit();
      });
  };

  // Lookup maps
  const deviceMap = useMemo(
    () => new Map(devices.map((d) => [d.id, d])),
    [devices]
  );
  const profileMap = useMemo(
    () => new Map(state.profiles.map((p) => [p.id, p])),
    [state.profiles]
  );
  const userMap = useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );

  const labelFor = (scope: RuleScope, id: string): string => {
    if (scope === "device") {
      const d = deviceMap.get(id);
      return d?.givenName || d?.name || id;
    }
    if (scope === "profile") {
      return profileMap.get(id)?.name || id;
    }
    return userMap.get(id)?.name || id;
  };

  // Identify local & server device IDs for SSH management link protection
  const localDeviceId = useMemo(() => {
    if (isDemo) return "dev-portatil";
    if (!tailscaleInfo?.selfIp && !tailscaleInfo?.selfHostName) return undefined;
    return devices.find(
      (d) =>
        (tailscaleInfo.selfIp && d.ipAddresses.includes(tailscaleInfo.selfIp)) ||
        (tailscaleInfo.selfHostName &&
          (d.name === tailscaleInfo.selfHostName ||
            d.givenName === tailscaleInfo.selfHostName))
    )?.id;
  }, [devices, tailscaleInfo, isDemo]);

  const serverDeviceId = useMemo(() => {
    if (isDemo) return "dev-oracle";
    const remoteName = server.serverRemoteHostname?.toLowerCase();
    const aliasName = server.hostAlias.toLowerCase();
    return devices.find(
      (d) =>
        (server.serverTailscaleIp &&
          d.ipAddresses.includes(server.serverTailscaleIp)) ||
        d.ipAddresses.includes(server.hostName) ||
        (remoteName &&
          (d.name.toLowerCase() === remoteName ||
            d.givenName?.toLowerCase() === remoteName)) ||
        d.name.toLowerCase() === aliasName ||
        d.givenName?.toLowerCase() === aliasName
    )?.id;
  }, [devices, server, isDemo]);

  const protectedSsh = useMemo<ProtectedSshLink | undefined>(() => {
    if (!localDeviceId || !serverDeviceId || localDeviceId === serverDeviceId) {
      return undefined;
    }
    return {
      localDeviceId,
      serverDeviceId,
      sshPort: server.port ?? 22,
    };
  }, [localDeviceId, serverDeviceId, server.port]);

  // Resolve effective connections & detect profile conflicts (with SSH protection overlay)
  const resolution = useMemo(
    () => resolveEffectiveConnections(devices, users, state, protectedSsh),
    [devices, users, state, protectedSsh]
  );

  /**
   * Guards direct device rules on the protected SSH pair (localDevice -> serverDevice)
   * so the user cannot accidentally cut off TCP/<sshPort> management access.
   */
  const checkProtectedDeviceRule = (
    scope: RuleScope,
    sourceId: string,
    targetId: string,
    direction: Direction,
    protocol: Protocol,
    ports: string[]
  ): { allowed: boolean; message?: string } => {
    if (scope !== "device" || !protectedSsh) return { allowed: true };
    if (!isProtectedSshPair(sourceId, targetId, protectedSsh)) {
      return { allowed: true };
    }
    const ok = allowsProtectedSshFlow(
      sourceId,
      targetId,
      direction,
      protocol,
      ports,
      protectedSsh
    );
    if (!ok) {
      const localName = labelFor("device", protectedSsh.localDeviceId);
      const serverName = labelFor("device", protectedSsh.serverDeviceId);
      return {
        allowed: false,
        message: `🛡 Conexión SSH protegida: no se puede bloquear TCP/${protectedSsh.sshPort} de "${localName}" → "${serverName}" (servidor de configuración).`,
      };
    }
    return { allowed: true };
  };

  // Build rows for each tab
  const deviceRules = useMemo(
    () => state.rules.filter((r) => r.scope === "device"),
    [state.rules]
  );
  const profileRules = useMemo(
    () => state.rules.filter((r) => r.scope === "profile"),
    [state.rules]
  );
  const userRules = useMemo(
    () => state.rules.filter((r) => r.scope === "user"),
    [state.rules]
  );

  const currentRawRows = useMemo((): TableRow[] => {
    const toRuleRows = (rules: ConnectionRule[]): TableRow[] =>
      rules.map((r) => ({
        id: r.id,
        sourceKey: r.sourceId,
        sourceLabel: labelFor(r.scope, r.sourceId),
        targetLabel: labelFor(r.scope, r.targetId),
        direction: r.direction,
        protocol: r.protocol,
        ports: r.ports,
        isProtected:
          r.scope === "device" &&
          isProtectedSshPair(r.sourceId, r.targetId, protectedSsh),
      }));

    if (activeTab === "devices") return toRuleRows(deviceRules);
    if (activeTab === "profiles") return toRuleRows(profileRules);
    if (activeTab === "users") return toRuleRows(userRules);

    return resolution.connections.map((c) => ({
      id: c.pairKey,
      sourceKey: c.deviceAId,
      sourceLabel: c.deviceAName,
      targetLabel: c.deviceBName,
      direction: c.direction,
      protocol: c.protocol,
      ports: c.ports,
      originLabel: c.origin.label,
      hasConflict: c.hasConflict,
      isProtected: Boolean(c.isSshProtected),
    }));
  }, [activeTab, deviceRules, profileRules, userRules, resolution.connections, deviceMap, profileMap, userMap, protectedSsh]);

  const filteredRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return currentRawRows;
    return currentRawRows.filter(
      (r) =>
        r.sourceLabel.toLowerCase().includes(q) ||
        r.targetLabel.toLowerCase().includes(q) ||
        (r.originLabel?.toLowerCase().includes(q) ?? false)
    );
  }, [currentRawRows, filterQuery]);

  const displayItems = useMemo(
    () =>
      buildDisplayTableItems(
        filteredRows,
        expandedGroupsByTab[activeTab],
        groupedByOrigin,
        filterQuery.trim().length > 0
      ),
    [filteredRows, expandedGroupsByTab, activeTab, groupedByOrigin, filterQuery]
  );

  const selectedIndex = Math.min(
    selectedByTab[activeTab],
    Math.max(0, displayItems.length - 1)
  );

  const setCurrentSelection = (next: number) => {
    setSelectedByTab((prev) => ({
      ...prev,
      [activeTab]: Math.max(0, Math.min(next, Math.max(0, displayItems.length - 1))),
    }));
  };

  const toggleGroupExpanded = (sourceKey: string) => {
    setExpandedGroupsByTab((prev) => {
      const nextSet = new Set(prev[activeTab]);
      if (nextSet.has(sourceKey)) nextSet.delete(sourceKey);
      else nextSet.add(sourceKey);
      return { ...prev, [activeTab]: nextSet };
    });
  };

  const expandGroupAndFocusFirstChild = (sourceKey: string, headerIndex: number) => {
    setExpandedGroupsByTab((prev) => {
      const nextSet = new Set(prev[activeTab]);
      nextSet.add(sourceKey);
      return { ...prev, [activeTab]: nextSet };
    });
    setSelectedByTab((prev) => ({
      ...prev,
      [activeTab]: headerIndex + 1,
    }));
  };

  const getSelectedDisplayItem = (): DisplayTableItem | undefined =>
    displayItems[selectedIndex];

  const getSelectedRule = (): ConnectionRule | undefined => {
    if (activeTab === "direct") return undefined;
    const item = getSelectedDisplayItem();
    if (!item || item.kind === "group_header") return undefined;
    return state.rules.find((r) => r.id === item.row.id);
  };

  // Helper to update state and automatically prompt ConflictModal if a new profile conflict arises
  const updateStateAndCheckConflicts = (updater: (prev: TaclState) => TaclState) => {
    setState((prev) => {
      const next = updater(prev);
      const nextRes = resolveEffectiveConnections(devices, users, next);
      if (nextRes.conflicts.length > 0) {
        setTimeout(() => {
          setModal({ kind: "conflicts" });
        }, 0);
      }
      return next;
    });
    setDirty(true);
  };

  // Build deletable items for Ctrl+X DeleteModal
  const deletableItems = useMemo((): DeletableItem[] => {
    const items: DeletableItem[] = [];
    const scopeForTab: RuleScope | null =
      activeTab === "devices"
        ? "device"
        : activeTab === "profiles"
          ? "profile"
          : activeTab === "users"
            ? "user"
            : null;

    if (scopeForTab) {
      const scopedRules = state.rules.filter((r) => r.scope === scopeForTab);
      for (const r of scopedRules) {
        const src = labelFor(r.scope, r.sourceId);
        const dst = labelFor(r.scope, r.targetId);
        items.push({
          id: `rule:${r.id}`,
          kind: "rule",
          targetId: r.id,
          label: `${src} ${directionArrow(r.direction)} ${dst} (${protocolLabel(r.protocol)}, puertos: ${portsLabel(r.ports)})`,
        });
      }
    }

    if (activeTab === "profiles") {
      for (const p of state.profiles) {
        const linkedCount = state.rules.filter(
          (r) => r.scope === "profile" && (r.sourceId === p.id || r.targetId === p.id)
        ).length;
        items.push({
          id: `profile:${p.id}`,
          kind: "profile",
          targetId: p.id,
          label: `Perfil "${p.name}" (${p.deviceIds.length} dispositivos)`,
          impactDetail:
            linkedCount > 0
              ? `También eliminará ${linkedCount} regla(s) ligada(s) a este perfil.`
              : undefined,
        });
      }
    }

    if (state.conflictResolutions.length > 0) {
      items.push({
        id: "conflicts:all",
        kind: "conflict_resolutions",
        targetId: "all",
        label: `Limpiar ${state.conflictResolutions.length} decisión(es) guardada(s) de conflictos de perfil`,
      });
    }

    return items;
  }, [activeTab, state.rules, state.profiles, state.conflictResolutions, deviceMap, profileMap, userMap]);

  const linkEntitiesForActiveTab = useMemo((): LinkEntityOption[] => {
    if (activeTab === "devices") {
      return devices.map((d) => ({
        id: d.id,
        label: d.givenName || d.name,
        detail: `${d.userName}${d.ipAddresses[0] ? ` · ${d.ipAddresses[0]}` : ""}`,
      }));
    }
    if (activeTab === "profiles") {
      return state.profiles.map((p) => ({
        id: p.id,
        label: p.name,
        detail: `${p.deviceIds.length} disp.`,
      }));
    }
    return users.map((u) => ({
      id: u.id,
      label: u.name,
      detail: `${devices.filter((d) => d.userId === u.id).length} disp.`,
    }));
  }, [activeTab, devices, state.profiles, users]);

  const handleRefresh = async () => {
    if (isDemo) {
      showToast("Modo demo: inventario simulado actualizado.", "info");
      return;
    }
    showToast("Refrescando nodos y usuarios desde Headscale...", "info");
    const [inv, pol] = await Promise.all([
      fetchHeadscaleInventory(server),
      fetchCurrentPolicyRaw(server),
    ]);
    if (inv.error) {
      if (inv.needsSudoPassword) {
        setModal({
          kind: "sudo_refresh",
          reason: inv.error,
          error: inv.wrongPassword ? "Contraseña sudo incorrecta, intenta de nuevo." : undefined,
        });
        return;
      }
      showToast(inv.error, "error");
      return;
    }
    setUsers(inv.users);
    setDevices(inv.devices);
    setExistingPolicyRaw(pol.raw);
    showToast(
      `Inventario actualizado (${inv.devices.length} dispositivos, ${inv.users.length} usuarios).`,
      "success"
    );
  };

  useKeyboard((key) => {
    if (exiting) return;

    // Always allow Ctrl+C to save and exit even if a modal is open
    if (key.ctrl && key.name === "c") {
      handleSaveAndExit();
      return;
    }

    // Do not intercept keys while a modal is open
    if (modal !== null) {
      if (modal.kind === "inspect_direct" && (key.name === "escape" || key.name === "return")) {
        setModal(null);
      }
      return;
    }

    // Filter input mode
    if (filtering) {
      if (key.name === "escape") {
        setFiltering(false);
        setFilterQuery("");
      } else if (key.name === "return") {
        setFiltering(false);
      } else if (key.name === "backspace") {
        setFilterQuery((q) => q.slice(0, -1));
      } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setFilterQuery((q) => q + key.sequence);
      }
      return;
    }

    // Quit (saves local + remote before exiting)
    if (key.name === "q") {
      handleSaveAndExit();
      return;
    }

    // Tab navigation (← / → / Tab / 1-4)
    if (key.name === "left" || (key.name === "tab" && key.shift)) {
      const idx = TAB_ORDER.indexOf(activeTab);
      setActiveTab(TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]!);
      return;
    }
    if (key.name === "right" || key.name === "tab") {
      const idx = TAB_ORDER.indexOf(activeTab);
      setActiveTab(TAB_ORDER[(idx + 1) % TAB_ORDER.length]!);
      return;
    }
    if (key.name === "1") {
      setActiveTab("devices");
      return;
    }
    if (key.name === "2") {
      setActiveTab("profiles");
      return;
    }
    if (key.name === "3") {
      setActiveTab("users");
      return;
    }
    if (key.name === "4") {
      setActiveTab("direct");
      return;
    }

    // Row navigation
    if (key.name === "up" || key.name === "k") {
      setCurrentSelection(selectedIndex - 1);
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setCurrentSelection(selectedIndex + 1);
      return;
    }

    // Filter
    if (key.sequence === "/") {
      setFiltering(true);
      return;
    }
    if (key.name === "escape" && filterQuery) {
      setFilterQuery("");
      return;
    }

    // Resolve conflicts manually
    if (key.name === "c" && resolution.conflicts.length > 0) {
      setModal({ kind: "conflicts" });
      return;
    }

    // Apply & Diff (s)
    if (key.name === "s") {
      setModal({ kind: "apply_diff" });
      return;
    }

    // Reconfigure server (Shift+R)
    if (key.shift && key.name === "r" && !isDemo) {
      onRescan();
      return;
    }

    // Refresh inventory (r)
    if (key.name === "r" && !key.shift) {
      void handleRefresh();
      return;
    }

    // Toggle default policy mode (m)
    if (key.name === "m") {
      updateStateAndCheckConflicts((prev) => ({
        ...prev,
        defaultPolicy: prev.defaultPolicy === "passthrough" ? "deny" : "passthrough",
      }));
      showToast(
        state.defaultPolicy === "passthrough"
          ? "Modo base cambiado a: Default Deny (estricto)"
          : "Modo base cambiado a: Sin restricciones adicionales por defecto",
        "info"
      );
      return;
    }

    // Toggle grouped vs flat table view (g)
    if (key.name === "g") {
      setGroupedByOrigin((prev) => {
        const next = !prev;
        showToast(
          next
            ? "Vista agrupada por origen activada (Enter despliega destinos)."
            : "Vista plana activada (todas las filas sin agrupar).",
          "info"
        );
        return next;
      });
      return;
    }

    // Expand / collapse all origin groups in current tab (z)
    if (key.name === "z" && groupedByOrigin) {
      const groupKeys = Array.from(
        new Set(filteredRows.map((r) => r.sourceKey ?? r.sourceLabel))
      );
      setExpandedGroupsByTab((prev) => {
        const current = prev[activeTab];
        const allExpanded =
          groupKeys.length > 0 && groupKeys.every((k) => current.has(k));
        return {
          ...prev,
          [activeTab]: allExpanded ? new Set<string>() : new Set(groupKeys),
        };
      });
      return;
    }

    // Enter: toggle origin dropdown if on group header, or inspect in Conexiones Directas
    if (key.name === "return") {
      const selectedItem = getSelectedDisplayItem();
      if (selectedItem?.kind === "group_header") {
        toggleGroupExpanded(selectedItem.sourceKey);
        return;
      }
      if (activeTab === "direct" && selectedItem) {
        const conn = resolution.connections.find(
          (c) => c.pairKey === selectedItem.row.id
        );
        if (conn) {
          setModal({ kind: "inspect_direct", conn });
        }
        return;
      }
      return;
    }

    // Block all editing shortcuts on Conexiones Directas (read-only tab!)
    const isDeleteShortcut = key.ctrl && key.name === "x";
    if (
      activeTab === "direct" &&
      (key.name === "u" ||
        key.name === "p" ||
        key.name === "l" ||
        key.name === "f" ||
        key.name === "space" ||
        isDeleteShortcut)
    ) {
      showToast(
        "Conexiones Directas es de solo lectura (muestra el estado final). Edita en Dispositivos, Perfiles o Usuarios.",
        "warn"
      );
      return;
    }

    // (Espacio) Guided 3-step connect menu: Origen -> Destino -> Dir/Proto/Ports checklist
    if (key.name === "space") {
      const scope: RuleScope =
        activeTab === "devices"
          ? "device"
          : activeTab === "profiles"
            ? "profile"
            : "user";
      setModal({ kind: "quick_connect", scope });
      return;
    }

    // (a) Show all items panel (excluded on Conexiones Directas)
    if (key.name === "a") {
      if (activeTab === "direct") {
        return;
      }
      const scope: RuleScope =
        activeTab === "devices"
          ? "device"
          : activeTab === "profiles"
            ? "profile"
            : "user";
      setModal({ kind: "items_panel", scope });
      return;
    }

    // (u) Edit Direction & Protocol modal
    if (key.name === "u") {
      const selectedItem = getSelectedDisplayItem();
      if (selectedItem?.kind === "group_header") {
        expandGroupAndFocusFirstChild(selectedItem.sourceKey, selectedIndex);
        showToast("Destinos desplegados — elige un destino y pulsa [u] para editar.", "info");
        return;
      }
      const rule = getSelectedRule();
      if (!rule) {
        showToast("Selecciona una regla primero o pulsa [l] para crear un ligamiento.", "warn");
        return;
      }
      setModal({
        kind: "edit_conn",
        rule,
        srcLabel: labelFor(rule.scope, rule.sourceId),
        dstLabel: labelFor(rule.scope, rule.targetId),
      });
      return;
    }

    // (p) Edit Ports modal
    if (key.name === "p") {
      const selectedItem = getSelectedDisplayItem();
      if (selectedItem?.kind === "group_header") {
        expandGroupAndFocusFirstChild(selectedItem.sourceKey, selectedIndex);
        showToast("Destinos desplegados — elige un destino y pulsa [p] para puertos.", "info");
        return;
      }
      const rule = getSelectedRule();
      if (!rule) {
        showToast("Selecciona una regla primero para ver/editar sus puertos.", "warn");
        return;
      }
      setModal({
        kind: "ports",
        rule,
        ruleLabel: `${labelFor(rule.scope, rule.sourceId)} ${directionArrow(rule.direction)} ${labelFor(rule.scope, rule.targetId)}`,
      });
      return;
    }

    // (l) Link entities of current tab scope
    if (key.name === "l") {
      const scope: RuleScope =
        activeTab === "devices"
          ? "device"
          : activeTab === "profiles"
            ? "profile"
            : "user";
      setModal({ kind: "link", scope });
      return;
    }

    // (f) Create Profile modal
    if (key.name === "f") {
      setModal({ kind: "profile" });
      return;
    }

    // (^X / Ctrl+X) Safe Delete modal with list + confirmation
    if (isDeleteShortcut) {
      const rule = getSelectedRule();
      setModal({
        kind: "delete",
        preselectedId: rule ? `rule:${rule.id}` : undefined,
      });
    }
  });

  const compiled = useMemo(
    () =>
      compileToHeadscalePolicy(devices, users, state, {
        existingPolicyRaw,
        localDeviceId,
        serverDeviceId,
        sshPort: server.port ?? 22,
      }),
    [devices, users, state, existingPolicyRaw, localDeviceId, serverDeviceId, server.port]
  );

  const emptyHint =
    activeTab === "devices"
      ? "No hay ligamientos de dispositivos aún. Pulsa [l] para ligar dos dispositivos (peso absoluto)."
      : activeTab === "profiles"
        ? state.profiles.length === 0
          ? "No hay perfiles creados aún. Pulsa [f] para crear tu primer perfil y añadir dispositivos."
          : "No hay ligamientos entre perfiles aún. Pulsa [l] para ligar perfiles."
        : activeTab === "users"
          ? "No hay ligamientos entre usuarios aún. Pulsa [l] para ligar usuarios de Headscale."
          : "No hay suficientes dispositivos para mostrar conexiones directas.";

  const tableViewportHeight = Math.max(
    6,
    termHeight - (activeTab === "profiles" ? 13 : 10)
  );

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={THEME.bg}
    >
      {/* Top Bar */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingX={1}
        backgroundColor={THEME.surfaceAlt}
        border={["bottom"]}
        borderColor={THEME.border}
      >
        <text fg={THEME.accent}>
          <b>tacl</b>
          <span fg={THEME.muted}>{" · "}</span>
          <span fg={THEME.text}>{server.hostAlias}</span>
          <span fg={THEME.muted}>
            {` (${server.deployMode === "container" ? `contenedor: ${server.containerDir}` : "nativo"})`}
          </span>
        </text>
        <text fg={THEME.subtext}>
          {protectedSsh ? (
            <>
              <span fg={THEME.green}>
                {`🛡 SSH:${protectedSsh.sshPort} (${labelFor("device", protectedSsh.localDeviceId)}→${labelFor("device", protectedSsh.serverDeviceId)})`}
              </span>
              {"  "}
            </>
          ) : null}
          <span fg={state.defaultPolicy === "deny" ? THEME.yellow : THEME.teal}>
            {state.defaultPolicy === "deny"
              ? "Base: Default-Deny [m]"
              : "Base: Sin restricción extra [m]"}
          </span>
          {"  "}
          <span fg={dirty ? THEME.yellow : THEME.green}>
            {dirty ? "● Cambios sin aplicar" : "● Sincronizado"}
          </span>
        </text>
      </box>

      {/* Tabs */}
      <TabBar
        activeTab={activeTab}
        counts={{
          devices: deviceRules.length,
          profiles: profileRules.length,
          users: userRules.length,
          direct: resolution.connections.length,
        }}
        conflictCount={resolution.conflicts.length}
      />

      {/* Profile summary strip on Perfiles tab */}
      {activeTab === "profiles" ? (
        <box
          paddingX={2}
          paddingY={0}
          backgroundColor={THEME.surface}
          border={["bottom"]}
          borderColor={THEME.border}
          flexDirection="row"
          gap={2}
        >
          <text fg={THEME.subtext}>
            <b>Perfiles ({state.profiles.length}):</b>{" "}
            {state.profiles.length === 0 ? (
              <span fg={THEME.muted}>ninguno — pulsa [f] para crear</span>
            ) : (
              state.profiles
                .map((p) => `${p.name} (${p.deviceIds.length})`)
                .join(" · ")
            )}
          </text>
        </box>
      ) : null}

      {/* Live filter input bar */}
      {filtering ? (
        <box
          paddingX={2}
          backgroundColor={THEME.surfaceAlt}
          border={["bottom"]}
          borderColor={THEME.yellow}
        >
          <text fg={THEME.yellow}>{`Buscar: ${filterQuery}█  (Enter confirmar · Esc limpiar)`}</text>
        </box>
      ) : null}

      {/* Main Table */}
      <RulesTable
        tab={activeTab}
        items={displayItems}
        selectedIndex={selectedIndex}
        viewportHeight={tableViewportHeight}
        filterQuery={filtering ? "" : filterQuery}
        emptyHint={emptyHint}
      />

      {/* Bottom Status Bar */}
      <StatusBar
        activeTab={activeTab}
        hasUnsavedChanges={dirty}
        conflictCount={resolution.conflicts.length}
        groupedByOrigin={groupedByOrigin}
        toast={toast}
      />

      {/* MODALS */}
      {modal?.kind === "edit_conn" ? (
        <EditConnectionModal
          sourceLabel={modal.srcLabel}
          targetLabel={modal.dstLabel}
          initialDirection={modal.rule.direction}
          initialProtocol={modal.rule.protocol}
          onCancel={() => setModal(null)}
          onSave={(direction: Direction, protocol: Protocol) => {
            const rule = modal.rule;
            const guard = checkProtectedDeviceRule(
              rule.scope,
              rule.sourceId,
              rule.targetId,
              direction,
              protocol,
              rule.ports
            );
            setModal(null);
            if (!guard.allowed) {
              showToast(guard.message!, "error");
              return;
            }
            updateStateAndCheckConflicts((prev) => ({
              ...prev,
              rules: prev.rules.map((r) =>
                r.id === rule.id ? { ...r, direction, protocol } : r
              ),
            }));
            showToast(
              `Conexión actualizada: ${directionLabel(direction)} · ${protocolLabel(protocol)}`,
              "success"
            );
          }}
        />
      ) : null}

      {modal?.kind === "ports" ? (
        <PortsModal
          ruleLabel={modal.ruleLabel}
          initialPorts={modal.rule.ports}
          onCancel={() => setModal(null)}
          onSave={(ports) => {
            const rule = modal.rule;
            const normalized = normalizePorts(ports);
            const guard = checkProtectedDeviceRule(
              rule.scope,
              rule.sourceId,
              rule.targetId,
              rule.direction,
              rule.protocol,
              normalized
            );
            setModal(null);
            if (!guard.allowed) {
              showToast(guard.message!, "error");
              return;
            }
            updateStateAndCheckConflicts((prev) => ({
              ...prev,
              rules: prev.rules.map((r) =>
                r.id === rule.id ? { ...r, ports: normalized } : r
              ),
            }));
            showToast(`Puertos actualizados: ${portsLabel(normalized)}`, "success");
          }}
        />
      ) : null}

      {modal?.kind === "link" ? (
        <LinkModal
          scope={modal.scope}
          entities={linkEntitiesForActiveTab}
          onCancel={() => setModal(null)}
          onCreateLink={({ sourceId, targetId, direction, protocol }) => {
            const scope = modal.scope;
            const guard = checkProtectedDeviceRule(
              scope,
              sourceId,
              targetId,
              direction,
              protocol,
              ["*"]
            );
            setModal(null);
            if (!guard.allowed) {
              showToast(guard.message!, "error");
              return;
            }
            const existing = findExistingRule(state.rules, scope, sourceId, targetId);

            if (existing) {
              updateStateAndCheckConflicts((prev) => ({
                ...prev,
                rules: prev.rules.map((r) =>
                  r.id === existing.id
                    ? { ...r, sourceId, targetId, direction, protocol }
                    : r
                ),
              }));
              showToast("Regla existente actualizada para ese par.", "info");
            } else {
              const newRule: ConnectionRule = {
                id: makeId("rule"),
                scope,
                sourceId,
                targetId,
                direction,
                protocol,
                ports: ["*"],
              };
              updateStateAndCheckConflicts((prev) => ({
                ...prev,
                rules: [...prev.rules, newRule],
              }));
              showToast(
                `Ligamiento creado: ${labelFor(scope, sourceId)} ${directionArrow(direction)} ${labelFor(scope, targetId)}`,
                "success"
              );
            }
          }}
        />
      ) : null}

      {modal?.kind === "quick_connect" ? (
        <QuickConnectModal
          scope={modal.scope}
          entities={linkEntitiesForActiveTab}
          onCancel={() => setModal(null)}
          onComplete={({ sourceId, targetId, direction, protocol, ports }) => {
            const scope = modal.scope;
            const normalized = normalizePorts(ports);
            const guard = checkProtectedDeviceRule(
              scope,
              sourceId,
              targetId,
              direction,
              protocol,
              normalized
            );
            setModal(null);
            if (!guard.allowed) {
              showToast(guard.message!, "error");
              return;
            }
            const existing = findExistingRule(state.rules, scope, sourceId, targetId);

            if (existing) {
              updateStateAndCheckConflicts((prev) => ({
                ...prev,
                rules: prev.rules.map((r) =>
                  r.id === existing.id
                    ? { ...r, sourceId, targetId, direction, protocol, ports: normalized }
                    : r
                ),
              }));
              showToast(
                `Regla actualizada: ${labelFor(scope, sourceId)} ${directionArrow(direction)} ${labelFor(scope, targetId)} (${portsLabel(normalized)})`,
                "success"
              );
            } else {
              const newRule: ConnectionRule = {
                id: makeId("rule"),
                scope,
                sourceId,
                targetId,
                direction,
                protocol,
                ports: normalized,
              };
              updateStateAndCheckConflicts((prev) => ({
                ...prev,
                rules: [...prev.rules, newRule],
              }));
              showToast(
                `Regla creada: ${labelFor(scope, sourceId)} ${directionArrow(direction)} ${labelFor(scope, targetId)} (${portsLabel(normalized)})`,
                "success"
              );
            }
          }}
        />
      ) : null}

      {modal?.kind === "profile" ? (
        <ProfileModal
          devices={devices}
          users={users}
          existingProfiles={state.profiles}
          editingProfile={modal.editing}
          cancelLabel={modal.returnToItemsPanel ? "Volver" : "Cancelar"}
          onCancel={() => {
            if (modal.returnToItemsPanel) {
              setModal({
                kind: "items_panel",
                scope: "profile",
                initialCursor: modal.returnToItemsPanel.cursor,
              });
            } else {
              setModal(null);
            }
          }}
          onSave={({ id, name, deviceIds }) => {
            const returnTo = modal.returnToItemsPanel;
            if (returnTo) {
              setModal({
                kind: "items_panel",
                scope: "profile",
                initialCursor: returnTo.cursor,
              });
            } else {
              setModal(null);
            }
            updateStateAndCheckConflicts((prev) => {
              if (id) {
                return {
                  ...prev,
                  profiles: prev.profiles.map((p) =>
                    p.id === id ? { ...p, name, deviceIds } : p
                  ),
                };
              }
              return {
                ...prev,
                profiles: [
                  ...prev.profiles,
                  { id: makeId("prof"), name, deviceIds },
                ],
              };
            });
            showToast(
              `Perfil "${name}" guardado con ${deviceIds.length} dispositivo(s).`,
              "success"
            );
          }}
        />
      ) : null}

      {modal?.kind === "items_panel" ? (
        <ItemsPanelModal
          scope={modal.scope}
          devices={devices}
          profiles={state.profiles}
          users={users}
          initialCursor={modal.initialCursor}
          onEditProfile={(profile, cursorIndex) =>
            setModal({
              kind: "profile",
              editing: profile,
              returnToItemsPanel: { cursor: cursorIndex },
            })
          }
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.kind === "delete" ? (
        <DeleteModal
          items={deletableItems}
          preselectedId={modal.preselectedId}
          onCancel={() => setModal(null)}
          onConfirmDelete={(selected) => {
            setModal(null);
            const ruleIdsToDelete = new Set(
              selected.filter((i) => i.kind === "rule").map((i) => i.targetId)
            );
            const profileIdsToDelete = new Set(
              selected.filter((i) => i.kind === "profile").map((i) => i.targetId)
            );
            const clearConflicts = selected.some(
              (i) => i.kind === "conflict_resolutions"
            );

            updateStateAndCheckConflicts((prev) => ({
              ...prev,
              profiles: prev.profiles.filter((p) => !profileIdsToDelete.has(p.id)),
              rules: prev.rules.filter(
                (r) =>
                  !ruleIdsToDelete.has(r.id) &&
                  !(
                    r.scope === "profile" &&
                    (profileIdsToDelete.has(r.sourceId) ||
                      profileIdsToDelete.has(r.targetId))
                  )
              ),
              conflictResolutions: clearConflicts
                ? []
                : prev.conflictResolutions.filter(
                    (cr) => !ruleIdsToDelete.has(cr.winningRuleId)
                  ),
            }));

            showToast(`Eliminado(s) ${selected.length} elemento(s).`, "success");
          }}
        />
      ) : null}

      {modal?.kind === "conflicts" ? (
        <ConflictModal
          conflicts={resolution.conflicts}
          devices={devices}
          onClose={() => setModal(null)}
          onResolve={(pairKey, winningRuleId) => {
            setState((prev) => {
              const filtered = prev.conflictResolutions.filter(
                (cr) => cr.pairKey !== pairKey
              );
              const next: TaclState = {
                ...prev,
                conflictResolutions: [...filtered, { pairKey, winningRuleId }],
              };
              const remaining = resolveEffectiveConnections(devices, users, next).conflicts;
              if (remaining.length === 0) {
                setModal(null);
              }
              return next;
            });
            setDirty(true);
            showToast("Resolución de conflicto guardada.", "success");
          }}
        />
      ) : null}

      {modal?.kind === "apply_diff" ? (
        <ApplyDiffModal
          compiled={compiled}
          existingPolicyRaw={existingPolicyRaw}
          unresolvedConflictCount={resolution.conflicts.length}
          hostLabel={`${server.user ? `${server.user}@` : ""}${server.hostAlias}`}
          policyPathUnconfigured={
            !isDemo && server.policyMode === "file" && !policyPathConfigured
          }
          configPath={server.configPath}
          isDemo={isDemo}
          onProvideSudoPassword={(pwd) => {
            setSudoPassword(serverToTarget(server), pwd);
          }}
          onOpenConflicts={() => setModal({ kind: "conflicts" })}
          onClose={() => setModal(null)}
          onConfirmApply={async () => {
            if (isDemo) {
              setExistingPolicyRaw(compiled.hujson);
              setDirty(false);
              return {
                ok: true,
                message: "Simulación completada (modo --demo). HuJSON validado correctamente.",
              };
            }
            const cleanState = buildPersistableState(false);
            const res = await applyPolicyToHeadscale(server, compiled.hujson, cleanState);
            if (res.ok) {
              setExistingPolicyRaw(compiled.hujson);
              setDirty(false);
              if (res.configUpdated) {
                setPolicyPathConfigured(true);
              }
            }
            return {
              ok: res.ok,
              message: res.message,
              needsSudoPassword: res.needsSudoPassword,
              wrongPassword: res.wrongPassword,
            };
          }}
        />
      ) : null}

      {modal?.kind === "sudo_refresh" ? (
        <SudoPasswordModal
          hostLabel={`${server.user ? `${server.user}@` : ""}${server.hostAlias}`}
          reason={modal.reason}
          errorMessage={modal.error}
          onCancel={() => setModal(null)}
          onSubmit={(pwd) => {
            setSudoPassword(serverToTarget(server), pwd);
            setModal(null);
            void handleRefresh();
          }}
        />
      ) : null}

      {modal?.kind === "inspect_direct" ? (
        <box
          position="absolute"
          top={5}
          left={10}
          right={10}
          zIndex={25}
          border
          borderStyle="rounded"
          borderColor={THEME.borderActive}
          backgroundColor={THEME.modalBg}
          padding={2}
          flexDirection="column"
          gap={1}
        >
          <text fg={THEME.accent}>
            <b>Inspector de Conexión Final (Solo lectura)</b>
          </text>
          <text fg={THEME.text}>
            {`${modal.conn.deviceAName}  `}
            <span fg={directionColor(modal.conn.direction)}>
              <b>{directionArrow(modal.conn.direction)}</b>
            </span>
            {`  ${modal.conn.deviceBName}`}
          </text>
          <text fg={THEME.subtext}>
            {`Estado: ${directionLabel(modal.conn.direction)} · Protocolo: ${protocolLabel(modal.conn.protocol)} · Puertos: ${portsLabel(modal.conn.ports)}`}
          </text>
          <text fg={THEME.teal}>
            {`Decidido por: ${modal.conn.origin.label}`}
          </text>
          {modal.conn.isSshProtected && protectedSsh ? (
            <text fg={THEME.green}>
              {`🛡 Conexión protegida: TCP/${protectedSsh.sshPort} desde ${labelFor("device", protectedSsh.localDeviceId)} → ${labelFor("device", protectedSsh.serverDeviceId)} siempre se mantiene activo al compilar.`}
            </text>
          ) : null}
          <text fg={THEME.muted}>
            {modal.conn.direction === "deny"
              ? "Visibilidad NetMap: 100% invisibles entre sí (sin regla accept en ninguna dirección)."
              : "Visibilidad NetMap: visibles entre sí para tráfico permitido y respuestas."}
          </text>
          <text fg={THEME.subtext}>Pulsa [Enter] o [Esc] para cerrar.</text>
        </box>
      ) : null}
    </box>
  );
}
