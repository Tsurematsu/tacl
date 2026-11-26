import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { Direction, Protocol } from "../../types/model.ts";
import { directionColor, directionLabel, protocolColor, THEME } from "../theme.ts";

export interface EditConnectionModalProps {
  sourceLabel: string;
  targetLabel: string;
  initialDirection: Direction;
  initialProtocol: Protocol;
  onSave: (direction: Direction, protocol: Protocol) => void;
  onCancel: () => void;
}

const DIRECTIONS: Direction[] = ["both", "a_to_b", "b_to_a", "deny"];
const PROTOCOLS: Protocol[] = ["tcp", "udp", "both"];

function protoShort(p: Protocol): string {
  if (p === "tcp") return "TCP";
  if (p === "udp") return "UDP";
  return "Ambos (TCP+UDP)";
}

export function EditConnectionModal({
  sourceLabel,
  targetLabel,
  initialDirection,
  initialProtocol,
  onSave,
  onCancel,
}: EditConnectionModalProps) {
  const [focusRow, setFocusRow] = useState<0 | 1>(0);
  const [dirIdx, setDirIdx] = useState(
    Math.max(0, DIRECTIONS.indexOf(initialDirection))
  );
  const [protoIdx, setProtoIdx] = useState(
    Math.max(0, PROTOCOLS.indexOf(initialProtocol))
  );

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel();
      return;
    }
    if (key.name === "return") {
      onSave(DIRECTIONS[dirIdx]!, PROTOCOLS[protoIdx]!);
      return;
    }
    if (key.name === "up" || key.name === "down" || key.name === "tab") {
      setFocusRow((r) => (r === 0 ? 1 : 0));
      return;
    }
    if (key.name === "left" || key.name === "h") {
      if (focusRow === 0) {
        setDirIdx((i) => (i - 1 + DIRECTIONS.length) % DIRECTIONS.length);
      } else {
        setProtoIdx((i) => (i - 1 + PROTOCOLS.length) % PROTOCOLS.length);
      }
      return;
    }
    if (key.name === "right" || key.name === "l") {
      if (focusRow === 0) {
        setDirIdx((i) => (i + 1) % DIRECTIONS.length);
      } else {
        setProtoIdx((i) => (i + 1) % PROTOCOLS.length);
      }
    }
  });

  const currentDir = DIRECTIONS[dirIdx]!;
  const currentProto = PROTOCOLS[protoIdx]!;

  return (
    <box
      position="absolute"
      top={3}
      left={6}
      right={6}
      zIndex={20}
      border
      borderStyle="rounded"
      borderColor={THEME.borderActive}
      backgroundColor={THEME.modalBg}
      padding={2}
      flexDirection="column"
      gap={1}
    >
      <text fg={THEME.accent}>
        <b>{`Editar Conexión (u): ${sourceLabel}  ↔  ${targetLabel}`}</b>
      </text>

      {/* Row 1: Direction Slider */}
      <box
        flexDirection="column"
        padding={1}
        border
        borderColor={focusRow === 0 ? THEME.borderActive : THEME.border}
        backgroundColor={focusRow === 0 ? THEME.surfaceAlt : THEME.bg}
        gap={1}
      >
        <text fg={focusRow === 0 ? THEME.accent : THEME.subtext}>
          <b>{`${focusRow === 0 ? "▸ " : "  "}1. Dirección de conexión (usa ← / → para deslizar):`}</b>
        </text>

        <box flexDirection="row" gap={1} paddingLeft={2}>
          <text fg={THEME.muted}>◀</text>
          {DIRECTIONS.map((d, idx) => {
            const active = idx === dirIdx;
            return (
              <box
                key={d}
                paddingX={1}
                backgroundColor={active ? THEME.selectedBg : THEME.bg}
              >
                <text fg={active ? directionColor(d) : THEME.muted}>
                  {active ? <b>{`[${directionLabel(d)}]`}</b> : directionLabel(d)}
                </text>
              </box>
            );
          })}
          <text fg={THEME.muted}>▶</text>
        </box>

        <text fg={THEME.subtext}>
          {currentDir === "both"
            ? `  Vista previa: ${sourceLabel} ↔ ${targetLabel} (ambos pueden iniciar conexión)`
            : currentDir === "a_to_b"
              ? `  Vista previa: ${sourceLabel} → ${targetLabel} (solo ${sourceLabel} inicia conexión)`
              : currentDir === "b_to_a"
                ? `  Vista previa: ${sourceLabel} ← ${targetLabel} (solo ${targetLabel} inicia conexión)`
                : `  Vista previa: ${sourceLabel} ✕ ${targetLabel} (bloqueados e invisibles entre sí)`}
        </text>
      </box>

      {/* Row 2: Protocol Slider */}
      <box
        flexDirection="column"
        padding={1}
        border
        borderColor={focusRow === 1 ? THEME.borderActive : THEME.border}
        backgroundColor={focusRow === 1 ? THEME.surfaceAlt : THEME.bg}
        gap={1}
      >
        <text fg={focusRow === 1 ? THEME.accent : THEME.subtext}>
          <b>{`${focusRow === 1 ? "▸ " : "  "}2. Protocolo permitido (usa ← / → para deslizar):`}</b>
        </text>

        <box flexDirection="row" gap={1} paddingLeft={2}>
          <text fg={THEME.muted}>◀</text>
          {PROTOCOLS.map((p, idx) => {
            const active = idx === protoIdx;
            return (
              <box
                key={p}
                paddingX={1}
                backgroundColor={active ? THEME.selectedBg : THEME.bg}
              >
                <text fg={active ? protocolColor(p) : THEME.muted}>
                  {active ? <b>{`[${protoShort(p)}]`}</b> : protoShort(p)}
                </text>
              </box>
            );
          })}
          <text fg={THEME.muted}>▶</text>
        </box>
      </box>

      <text fg={THEME.subtext}>
        <span fg={THEME.accent}>[↑/↓ / Tab]</span> Cambiar opción{"  "}
        <span fg={THEME.accent}>[←/→]</span> Deslizar valor{"  "}
        <span fg={THEME.green}>[Enter]</span> Guardar{"  "}
        <span fg={THEME.muted}>[Esc]</span> Cancelar
      </text>
    </box>
  );
}
