import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { directionArrow, portsLabel, protocolLabel } from "../../engine/resolver.ts";
import type { Device, ProfileConflict } from "../../types/model.ts";
import { directionColor, THEME } from "../theme.ts";

export interface ConflictModalProps {
  conflicts: ProfileConflict[];
  devices: Device[];
  onResolve: (pairKey: string, winningRuleId: string) => void;
  onClose: () => void;
}

export function ConflictModal({
  conflicts,
  devices,
  onResolve,
  onClose,
}: ConflictModalProps) {
  const [cursor, setCursor] = useState(0);
  const current = conflicts[0];

  const devName = (id: string) => {
    const d = devices.find((x) => x.id === id);
    return d?.givenName || d?.name || id;
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (!current) return;
    const total = current.competingRules.length;
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(total - 1, c + 1));
    } else if (key.name === "return") {
      const chosen = current.competingRules[cursor];
      if (chosen) {
        setCursor(0);
        onResolve(current.pairKey, chosen.rule.id);
      }
    }
  });

  if (!current) return null;

  const nameA = devName(current.deviceAId);
  const nameB = devName(current.deviceBId);

  return (
    <box
      position="absolute"
      top={3}
      left={6}
      right={6}
      zIndex={30}
      border
      borderStyle="rounded"
      borderColor={THEME.borderWarn}
      backgroundColor={THEME.modalBg}
      padding={2}
      flexDirection="column"
      gap={1}
    >
      <text fg={THEME.yellow}>
        <b>{`⚠ Conflicto entre Perfiles (pendientes: ${conflicts.length})`}</b>
      </text>

      <text fg={THEME.text}>
        {`El par "${nameA}" ↔ "${nameB}" pertenece a múltiples perfiles con reglas distintas.`}
      </text>
      <text fg={THEME.subtext}>
        ¿Qué regla de perfil debe prevalecer para este par de dispositivos?
      </text>

      <box
        flexDirection="column"
        border
        borderColor={THEME.border}
        backgroundColor={THEME.bg}
        padding={1}
        gap={0}
      >
        {current.competingRules.map((entry, idx) => {
          const active = idx === cursor;
          const arrow = directionArrow(entry.effectiveDirection);
          return (
            <box
              key={entry.rule.id}
              paddingX={1}
              backgroundColor={active ? THEME.selectedBg : THEME.bg}
            >
              <text fg={active ? THEME.accent : THEME.text}>
                {active ? "▸ " : "  "}
                <b>{`${entry.sourceProfileName} ↔ ${entry.targetProfileName}`}</b>
                {"   →   "}
                <span fg={directionColor(entry.effectiveDirection)}>
                  <b>{`${nameA} ${arrow} ${nameB}`}</b>
                </span>
                <span fg={THEME.subtext}>
                  {`  (${protocolLabel(entry.rule.protocol)} · puertos: ${portsLabel(entry.rule.ports)})`}
                </span>
              </text>
            </box>
          );
        })}
      </box>

      <text fg={THEME.subtext}>
        <span fg={THEME.accent}>[↑/↓]</span> Elegir regla ganadora{"  "}
        <span fg={THEME.green}>[Enter]</span> Confirmar prevalencia{"  "}
        <span fg={THEME.muted}>[Esc]</span> Decidir después
      </text>
    </box>
  );
}
