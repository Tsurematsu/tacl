import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { Direction, Protocol, RuleScope } from "../../types/model.ts";
import { directionColor, directionLabel, protocolColor, THEME } from "../theme.ts";

export interface LinkEntityOption {
  id: string;
  label: string;
  detail?: string;
}

export interface LinkModalProps {
  scope: RuleScope;
  entities: LinkEntityOption[];
  onCreateLink: (params: {
    sourceId: string;
    targetId: string;
    direction: Direction;
    protocol: Protocol;
  }) => void;
  onCancel: () => void;
}

const DIRECTIONS: Direction[] = ["both", "a_to_b", "b_to_a", "deny"];
const PROTOCOLS: Protocol[] = ["both", "tcp", "udp"];

export function LinkModal({
  scope,
  entities,
  onCreateLink,
  onCancel,
}: LinkModalProps) {
  const [step, setStep] = useState<0 | 1 | 2>(0); // 0=source, 1=target, 2=dir/proto
  const [srcIdx, setSrcIdx] = useState(0);
  const [dstIdx, setDstIdx] = useState(entities.length > 1 ? 1 : 0);
  const [dirIdx, setDirIdx] = useState(0);
  const [protoIdx, setProtoIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const scopeTitle =
    scope === "device"
      ? "Dispositivos (Dispositivo ↔ Dispositivo)"
      : scope === "profile"
        ? "Perfiles (Perfil ↔ Perfil)"
        : "Usuarios (Usuario ↔ Usuario)";

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (step > 0) {
        setStep((s) => (s - 1) as 0 | 1 | 2);
        setError(null);
      } else {
        onCancel();
      }
      return;
    }

    if (entities.length === 0) return;

    if (step === 0) {
      if (key.name === "up" || key.name === "k") {
        setSrcIdx((i) => Math.max(0, i - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSrcIdx((i) => Math.min(entities.length - 1, i + 1));
      } else if (key.name === "return" || key.name === "tab") {
        // Default target to a different entity if device scope
        if (scope === "device" && dstIdx === srcIdx && entities.length > 1) {
          setDstIdx(srcIdx === 0 ? 1 : 0);
        }
        setStep(1);
        setError(null);
      }
      return;
    }

    if (step === 1) {
      if (key.name === "up" || key.name === "k") {
        setDstIdx((i) => Math.max(0, i - 1));
      } else if (key.name === "down" || key.name === "j") {
        setDstIdx((i) => Math.min(entities.length - 1, i + 1));
      } else if (key.name === "return" || key.name === "tab") {
        const src = entities[srcIdx];
        const dst = entities[dstIdx];
        if (!src || !dst) return;
        if (scope === "device" && src.id === dst.id) {
          setError("No puedes ligar un dispositivo consigo mismo.");
          return;
        }
        setError(null);
        setStep(2);
      }
      return;
    }

    if (step === 2) {
      if (key.name === "left" || key.name === "h") {
        setDirIdx((i) => (i - 1 + DIRECTIONS.length) % DIRECTIONS.length);
      } else if (key.name === "right" || key.name === "l") {
        setDirIdx((i) => (i + 1) % DIRECTIONS.length);
      } else if (key.name === "up" || key.name === "down" || key.name === "tab") {
        setProtoIdx((i) => (i + 1) % PROTOCOLS.length);
      } else if (key.name === "return") {
        const src = entities[srcIdx];
        const dst = entities[dstIdx];
        if (!src || !dst) return;
        onCreateLink({
          sourceId: src.id,
          targetId: dst.id,
          direction: DIRECTIONS[dirIdx]!,
          protocol: PROTOCOLS[protoIdx]!,
        });
      }
    }
  });

  const srcEntity = entities[srcIdx];
  const dstEntity = entities[dstIdx];
  const currentDir = DIRECTIONS[dirIdx]!;
  const currentProto = PROTOCOLS[protoIdx]!;

  const renderList = (activeIdx: number, focused: boolean) => {
    const start = Math.max(0, activeIdx - 4);
    const slice = entities.slice(start, start + 9);
    return (
      <box
        flexDirection="column"
        border
        borderColor={focused ? THEME.borderActive : THEME.border}
        backgroundColor={THEME.bg}
        padding={1}
        flexGrow={1}
      >
        {slice.map((item, i) => {
          const idx = start + i;
          const isSel = idx === activeIdx;
          return (
            <box
              key={item.id}
              paddingX={1}
              backgroundColor={isSel ? THEME.selectedBg : THEME.bg}
            >
              <text fg={isSel ? THEME.accent : THEME.text}>
                {isSel ? "▸ " : "  "}
                {item.label}
                {item.detail ? <span fg={THEME.muted}>{` (${item.detail})`}</span> : null}
              </text>
            </box>
          );
        })}
      </box>
    );
  };

  return (
    <box
      position="absolute"
      top={2}
      left={5}
      right={5}
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
        <b>{`Ligar (l) — ${scopeTitle}`}</b>
      </text>

      {entities.length === 0 || (scope === "device" && entities.length < 2) ? (
        <box padding={1} flexDirection="column" gap={1}>
          <text fg={THEME.yellow}>
            {scope === "profile"
              ? "Aún no hay perfiles creados. Pulsa [f] primero para crear un perfil."
              : "No hay suficientes elementos en esta categoría para crear un enlace."}
          </text>
          <text fg={THEME.muted}>Pulsa [Esc] para cerrar.</text>
        </box>
      ) : (
        <>
          <box flexDirection="row" gap={2}>
            <box flexDirection="column" flexGrow={1}>
              <text fg={step === 0 ? THEME.accent : THEME.subtext}>
                <b>{`1. Origen ${srcEntity ? `(${srcEntity.label})` : ""}`}</b>
              </text>
              {renderList(srcIdx, step === 0)}
            </box>

            <box flexDirection="column" flexGrow={1}>
              <text fg={step === 1 ? THEME.accent : THEME.subtext}>
                <b>{`2. Destino ${dstEntity ? `(${dstEntity.label})` : ""}`}</b>
              </text>
              {renderList(dstIdx, step === 1)}
            </box>
          </box>

          {scope !== "device" ? (
            <text fg={THEME.muted}>
              Tip: Puedes seleccionar el mismo perfil/usuario en ambos lados para controlar la visibilidad interna entre sus miembros.
            </text>
          ) : null}

          <box
            border
            borderColor={step === 2 ? THEME.borderActive : THEME.border}
            backgroundColor={step === 2 ? THEME.surfaceAlt : THEME.bg}
            padding={1}
            flexDirection="row"
            justifyContent="space-between"
          >
            <text fg={directionColor(currentDir)}>
              <b>{`Dirección [←/→]: ${directionLabel(currentDir)}`}</b>
            </text>
            <text fg={protocolColor(currentProto)}>
              <b>
                {`Protocolo [↑/↓]: ${
                  currentProto === "both" ? "Ambos" : currentProto.toUpperCase()
                }`}
              </b>
            </text>
          </box>

          {error ? <text fg={THEME.red}>{`⚠ ${error}`}</text> : null}

          <text fg={THEME.subtext}>
            {step < 2 ? (
              <>
                <span fg={THEME.accent}>[↑/↓]</span> Elegir{"  "}
                <span fg={THEME.green}>[Enter]</span> Siguiente paso{"  "}
                <span fg={THEME.muted}>[Esc]</span> {step === 0 ? "Cancelar" : "Paso anterior"}
              </>
            ) : (
              <>
                <span fg={THEME.accent}>[←/→]</span> Dirección{"  "}
                <span fg={THEME.accent}>[↑/↓]</span> Protocolo{"  "}
                <span fg={THEME.green}>[Enter]</span> Crear ligamiento{"  "}
                <span fg={THEME.muted}>[Esc]</span> Volver
              </>
            )}
          </text>
        </>
      )}
    </box>
  );
}
