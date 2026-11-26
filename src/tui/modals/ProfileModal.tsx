import { useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { Device, HeadscaleUser, Profile } from "../../types/model.ts";
import { THEME } from "../theme.ts";

export interface ProfileModalProps {
  devices: Device[];
  users?: HeadscaleUser[];
  existingProfiles: Profile[];
  editingProfile?: Profile;
  cancelLabel?: string;
  onSave: (profile: { id?: string; name: string; deviceIds: string[] }) => void;
  onCancel: () => void;
}

export function ProfileModal({
  devices,
  users,
  existingProfiles,
  editingProfile,
  cancelLabel = "Cancelar",
  onSave,
  onCancel,
}: ProfileModalProps) {
  const [focusSection, setFocusSection] = useState<"name" | "devices">("name");
  const [name, setName] = useState(editingProfile?.name ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(editingProfile?.deviceIds ?? [])
  );
  const [userFilterIdx, setUserFilterIdx] = useState(0); // 0 = Todos
  const [hideAssigned, setHideAssigned] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const assignedDeviceIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of existingProfiles) {
      if (p.id === editingProfile?.id) continue;
      for (const devId of p.deviceIds) {
        set.add(devId);
      }
    }
    return set;
  }, [existingProfiles, editingProfile?.id]);

  const userFilters = useMemo(() => {
    const map = new Map<string, string>();
    if (users) {
      for (const u of users) {
        map.set(u.id, u.name);
      }
    }
    for (const d of devices) {
      if (d.userId && !map.has(d.userId)) {
        map.set(d.userId, d.userName);
      }
    }
    const baseDevices = hideAssigned
      ? devices.filter((d) => !assignedDeviceIds.has(d.id))
      : devices;
    const list: Array<{ id: string; name: string; count: number }> = [
      { id: "__all__", name: "Todos", count: baseDevices.length },
    ];
    for (const [id, uName] of map.entries()) {
      const count = baseDevices.filter((d) => d.userId === id).length;
      list.push({ id, name: uName, count });
    }
    return list;
  }, [devices, users, hideAssigned, assignedDeviceIds]);

  const activeUserFilter = userFilters[userFilterIdx] ?? userFilters[0]!;

  const filteredDevices = useMemo(() => {
    const byUser =
      !activeUserFilter || activeUserFilter.id === "__all__"
        ? devices
        : devices.filter((d) => d.userId === activeUserFilter.id);
    if (!hideAssigned) return byUser;
    return byUser.filter((d) => !assignedDeviceIds.has(d.id));
  }, [devices, activeUserFilter, hideAssigned, assignedDeviceIds]);

  const hiddenCount = useMemo(() => {
    if (!hideAssigned) return 0;
    const byUser =
      !activeUserFilter || activeUserFilter.id === "__all__"
        ? devices
        : devices.filter((d) => d.userId === activeUserFilter.id);
    return byUser.length - filteredDevices.length;
  }, [devices, activeUserFilter, hideAssigned, filteredDevices.length]);

  const safeCursor = Math.min(cursor, Math.max(0, filteredDevices.length - 1));

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("El perfil debe tener un nombre.");
      setFocusSection("name");
      return;
    }
    const duplicate = existingProfiles.find(
      (p) =>
        p.name.toLowerCase() === trimmed.toLowerCase() &&
        p.id !== editingProfile?.id
    );
    if (duplicate) {
      setError(`Ya existe un perfil llamado "${duplicate.name}".`);
      setFocusSection("name");
      return;
    }
    onSave({
      id: editingProfile?.id,
      name: trimmed,
      deviceIds: Array.from(selectedIds),
    });
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel();
      return;
    }

    if (key.name === "tab") {
      setFocusSection((s) => (s === "name" ? "devices" : "name"));
      return;
    }

    if (focusSection === "name") {
      if (key.name === "return" || key.name === "down") {
        setFocusSection("devices");
        return;
      }
      if (key.name === "backspace") {
        setName((v) => v.slice(0, -1));
        setError(null);
        return;
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setName((v) => v + key.sequence);
        setError(null);
      }
      return;
    }

    // Focus in devices checklist: ← / → switches user filter
    if (key.name === "left" || key.name === "h") {
      setUserFilterIdx((i) => (i - 1 + userFilters.length) % userFilters.length);
      setCursor(0);
      return;
    }
    if (key.name === "right" || key.name === "l") {
      setUserFilterIdx((i) => (i + 1) % userFilters.length);
      setCursor(0);
      return;
    }

    if (key.name === "up" || key.name === "k") {
      if (safeCursor === 0) {
        setFocusSection("name");
      } else {
        setCursor((c) => Math.max(0, c - 1));
      }
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(Math.max(0, filteredDevices.length - 1), c + 1));
      return;
    }
    if (key.name === "space") {
      const dev = filteredDevices[safeCursor];
      if (!dev) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(dev.id)) next.delete(dev.id);
        else next.add(dev.id);
        return next;
      });
      return;
    }
    // (a) Select or deselect ALL devices matching the current user filter
    if (key.name === "a") {
      if (filteredDevices.length === 0) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const allVisibleSelected = filteredDevices.every((d) => next.has(d.id));
        if (allVisibleSelected) {
          for (const d of filteredDevices) {
            next.delete(d.id);
          }
        } else {
          for (const d of filteredDevices) {
            next.add(d.id);
          }
        }
        return next;
      });
      return;
    }
    // (o) Hide/show devices that already belong to another profile
    if (key.name === "o") {
      setHideAssigned((h) => !h);
      setCursor(0);
      return;
    }
    if (key.name === "return") {
      handleSave();
    }
  });

  const start = Math.max(0, safeCursor - 4);
  const visibleDevices = filteredDevices.slice(start, start + 9);

  return (
    <box
      position="absolute"
      top={2}
      left={6}
      right={6}
      zIndex={20}
      border
      borderStyle="rounded"
      borderColor={THEME.borderActive}
      backgroundColor={THEME.modalBg}
      padding={1}
      flexDirection="column"
      gap={1}
    >
      <text fg={THEME.accent}>
        <b>
          {editingProfile
            ? `Editar Perfil (f): ${editingProfile.name}`
            : "Crear Nuevo Perfil (f)"}
        </b>
      </text>

      {/* Name field */}
      <box
        flexDirection="column"
        flexShrink={0}
        height={4}
        border
        borderColor={focusSection === "name" ? THEME.borderActive : THEME.border}
        backgroundColor={focusSection === "name" ? THEME.surfaceAlt : THEME.bg}
        paddingX={1}
      >
        <text fg={focusSection === "name" ? THEME.accent : THEME.subtext}>
          <b>Nombre del perfil:</b>
        </text>
        <text fg={THEME.text} truncate>
          {name || (focusSection === "name" ? "" : "(sin nombre)")}
          {focusSection === "name" ? "█" : ""}
        </text>
      </box>

      {/* User filter bar + hide-assigned indicator */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
        gap={1}
        paddingX={1}
        backgroundColor={THEME.surfaceAlt}
        border
        borderColor={focusSection === "devices" ? THEME.cyan : THEME.border}
      >
        <box flexDirection="row" gap={1}>
          <text fg={THEME.cyan}>
            <b>Filtro usuario [←/→]:</b>
          </text>
          {userFilters.map((uf, idx) => {
            const active = idx === userFilterIdx;
            return (
              <text key={uf.id} fg={active ? THEME.green : THEME.muted}>
                {active ? <b>{`[${uf.name} (${uf.count})]`}</b> : `${uf.name} (${uf.count})`}
              </text>
            );
          })}
        </box>
        <text fg={hideAssigned ? THEME.yellow : THEME.muted}>
          {hideAssigned
            ? <b>{`[o] Sin perfil (${hiddenCount} ocultos)`}</b>
            : "[o] Ocultar ya en perfil"}
        </text>
      </box>

      {/* Devices checklist */}
      <box
        flexDirection="column"
        border
        borderColor={focusSection === "devices" ? THEME.borderActive : THEME.border}
        backgroundColor={THEME.bg}
        padding={1}
        minHeight={8}
      >
        <text fg={focusSection === "devices" ? THEME.accent : THEME.subtext}>
          <b>
            {`Dispositivos (${selectedIds.size} seleccionados en total · mostrando ${filteredDevices.length} de "${activeUserFilter.name}"):`}
          </b>
        </text>

        {filteredDevices.length === 0 ? (
          <text fg={THEME.muted}>
            {hideAssigned
              ? "  (Todos los dispositivos de este filtro ya pertenecen a un perfil · pulsa [o] para mostrarlos)"
              : "  (Este usuario no tiene dispositivos registrados)"}
          </text>
        ) : (
          visibleDevices.map((dev, i) => {
            const idx = start + i;
            const isCur = focusSection === "devices" && idx === safeCursor;
            const checked = selectedIds.has(dev.id);
            const otherProfiles = existingProfiles
              .filter((p) => p.id !== editingProfile?.id && p.deviceIds.includes(dev.id))
              .map((p) => p.name);

            return (
              <box
                key={dev.id}
                paddingX={1}
                backgroundColor={isCur ? THEME.selectedBg : THEME.bg}
              >
                <text fg={checked ? THEME.green : THEME.text}>
                  {isCur ? "▸ " : "  "}
                  {checked ? "[✓] " : "[ ] "}
                  <b>{dev.givenName || dev.name}</b>
                  <span fg={THEME.muted}>{` (${dev.userName})`}</span>
                  {otherProfiles.length > 0 ? (
                    <span fg={THEME.mauve}>{` · en: ${otherProfiles.join(", ")}`}</span>
                  ) : null}
                </text>
              </box>
            );
          })
        )}
      </box>

      {error ? <text fg={THEME.red}>{`⚠ ${error}`}</text> : null}

      <text fg={THEME.subtext}>
        <span fg={THEME.accent}>[Tab]</span> Nombre/Lista{"  "}
        <span fg={THEME.cyan}>[←/→]</span> Usuario{"  "}
        <span fg={THEME.peach}>[o]</span> {hideAssigned ? "Mostrar todos" : "Ocultar en perfil"}{"  "}
        <span fg={THEME.yellow}>[Espacio]</span> Marcar{"  "}
        <span fg={THEME.mauve}>[a]</span> Todos{"  "}
        <span fg={THEME.green}>[Enter]</span>{" "}
        {focusSection === "name" ? "Lista" : "Guardar"}{"  "}
        <span fg={THEME.muted}>[Esc]</span> {cancelLabel}
      </text>
    </box>
  );
}
