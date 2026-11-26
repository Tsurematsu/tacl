import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { Device, HeadscaleUser, Profile, RuleScope } from "../../types/model.ts";
import { padCell, THEME } from "../theme.ts";

export interface ItemsPanelModalProps {
  scope: RuleScope;
  devices: Device[];
  profiles: Profile[];
  users: HeadscaleUser[];
  initialCursor?: number;
  onEditProfile?: (profile: Profile, cursorIndex: number) => void;
  onClose: () => void;
}

export function ItemsPanelModal({
  scope,
  devices,
  profiles,
  users,
  initialCursor = 0,
  onEditProfile,
  onClose,
}: ItemsPanelModalProps) {
  const count =
    scope === "device"
      ? devices.length
      : scope === "profile"
        ? profiles.length
        : users.length;

  const [cursor, setCursor] = useState(
    Math.max(0, Math.min(initialCursor, Math.max(0, count - 1)))
  );

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "a") {
      onClose();
      return;
    }
    if (count === 0) return;

    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(count - 1, c + 1));
      return;
    }
    if (scope === "profile" && (key.name === "e" || key.name === "return")) {
      const selected = profiles[cursor];
      if (selected && onEditProfile) {
        onEditProfile(selected, cursor);
      }
    }
  });

  const title =
    scope === "device"
      ? `Todos los Dispositivos (${devices.length})`
      : scope === "profile"
        ? `Todos los Perfiles (${profiles.length})`
        : `Todos los Usuarios de Headscale (${users.length})`;

  const pageSize = 12;
  const start = Math.max(0, Math.min(cursor - 5, Math.max(0, count - pageSize)));

  const deviceName = (id: string) => {
    const d = devices.find((x) => x.id === id);
    return d?.givenName || d?.name || id;
  };

  return (
    <box
      position="absolute"
      top={2}
      left={4}
      right={4}
      bottom={2}
      zIndex={22}
      border
      borderStyle="rounded"
      borderColor={THEME.borderActive}
      backgroundColor={THEME.modalBg}
      padding={1}
      flexDirection="column"
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={THEME.accent}>
          <b>{`${title} (a)`}</b>
        </text>
        <text fg={THEME.muted}>[a / Esc] Cerrar</text>
      </box>

      {/* Content list */}
      <box
        flexDirection="column"
        border
        borderColor={THEME.border}
        backgroundColor={THEME.bg}
        padding={1}
        flexGrow={1}
      >
        {count === 0 ? (
          <text fg={THEME.muted}>
            {scope === "profile"
              ? "No hay perfiles creados aún. Cierra este panel y pulsa [f] para crear uno."
              : "No se encontraron elementos en esta categoría."}
          </text>
        ) : scope === "device" ? (
          <>
            <text fg={THEME.subtext}>
              <b>
                {"    "}
                {padCell("Dispositivo", 22)}
                {padCell("IP Tailscale", 17)}
                {padCell("Usuario", 16)}
                {"Perfiles"}
              </b>
            </text>
            {devices.slice(start, start + pageSize).map((dev, i) => {
              const idx = start + i;
              const isSel = idx === cursor;
              const devProfiles = profiles
                .filter((p) => p.deviceIds.includes(dev.id))
                .map((p) => p.name);
              const ip = dev.ipAddresses[0] ?? "-";
              return (
                <box
                  key={dev.id}
                  backgroundColor={isSel ? THEME.selectedBg : THEME.bg}
                  flexDirection="row"
                >
                  <text fg={isSel ? THEME.accent : THEME.muted}>
                    {isSel ? "▸ " : "  "}
                  </text>
                  <text fg={dev.online ? THEME.green : THEME.muted}>
                    {dev.online ? "● " : "○ "}
                  </text>
                  <text fg={THEME.text}>
                    {padCell(dev.givenName || dev.name, 22)}
                  </text>
                  <text fg={THEME.cyan}>{padCell(ip, 17)}</text>
                  <text fg={THEME.subtext}>{padCell(dev.userName, 16)}</text>
                  <text fg={devProfiles.length > 0 ? THEME.mauve : THEME.muted} truncate>
                    {devProfiles.length > 0 ? devProfiles.join(", ") : "—"}
                  </text>
                </box>
              );
            })}
          </>
        ) : scope === "profile" ? (
          <>
            <text fg={THEME.subtext}>
              <b>
                {"  "}
                {padCell("Perfil", 24)}
                {padCell("Cant.", 8)}
                {"Dispositivos miembros"}
              </b>
            </text>
            {profiles.slice(start, start + pageSize).map((prof, i) => {
              const idx = start + i;
              const isSel = idx === cursor;
              const members = prof.deviceIds.map(deviceName);
              return (
                <box
                  key={prof.id}
                  backgroundColor={isSel ? THEME.selectedBg : THEME.bg}
                  flexDirection="row"
                >
                  <text fg={isSel ? THEME.accent : THEME.muted}>
                    {isSel ? "▸ " : "  "}
                  </text>
                  <text fg={THEME.mauve}>
                    <b>{padCell(prof.name, 24)}</b>
                  </text>
                  <text fg={THEME.cyan}>{padCell(String(members.length), 8)}</text>
                  <text fg={members.length > 0 ? THEME.text : THEME.muted} truncate>
                    {members.length > 0 ? members.join(", ") : "(sin dispositivos)"}
                  </text>
                </box>
              );
            })}
          </>
        ) : (
          <>
            <text fg={THEME.subtext}>
              <b>
                {"  "}
                {padCell("Usuario", 24)}
                {padCell("Disp.", 8)}
                {"Dispositivos asignados"}
              </b>
            </text>
            {users.slice(start, start + pageSize).map((user, i) => {
              const idx = start + i;
              const isSel = idx === cursor;
              const userDevs = devices
                .filter((d) => d.userId === user.id)
                .map((d) => d.givenName || d.name);
              return (
                <box
                  key={user.id}
                  backgroundColor={isSel ? THEME.selectedBg : THEME.bg}
                  flexDirection="row"
                >
                  <text fg={isSel ? THEME.accent : THEME.muted}>
                    {isSel ? "▸ " : "  "}
                  </text>
                  <text fg={THEME.teal}>
                    <b>{padCell(user.name, 24)}</b>
                  </text>
                  <text fg={THEME.cyan}>{padCell(String(userDevs.length), 8)}</text>
                  <text fg={userDevs.length > 0 ? THEME.text : THEME.muted} truncate>
                    {userDevs.length > 0 ? userDevs.join(", ") : "(sin dispositivos)"}
                  </text>
                </box>
              );
            })}
          </>
        )}
      </box>

      <text fg={THEME.subtext}>
        <span fg={THEME.accent}>[↑/↓]</span> Navegar{"  "}
        {scope === "profile" && profiles.length > 0 ? (
          <>
            <span fg={THEME.yellow}>[e / Enter]</span> Editar perfil seleccionado{"  "}
          </>
        ) : null}
        <span fg={THEME.muted}>[a / Esc]</span> Cerrar panel
      </text>
    </box>
  );
}
