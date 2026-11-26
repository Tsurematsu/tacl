import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { normalizePorts, validatePortSpec } from "../../engine/resolver.ts";
import type { Direction, Protocol, RuleScope } from "../../types/model.ts";
import { directionColor, directionLabel, protocolColor, THEME } from "../theme.ts";
import type { LinkEntityOption } from "./LinkModal.tsx";

export interface QuickConnectModalProps {
  scope: RuleScope;
  entities: LinkEntityOption[];
  onComplete: (params: {
    sourceId: string;
    targetId: string;
    direction: Direction;
    protocol: Protocol;
    ports: string[];
  }) => void;
  onCancel: () => void;
}

interface PortPreset {
  spec: string;
  label: string;
}

const DEFAULT_PORT_PRESETS: PortPreset[] = [
  { spec: "*", label: "Todos los puertos (*)" },
  { spec: "22", label: "22 — SSH" },
  { spec: "53", label: "53 — DNS" },
  { spec: "80", label: "80 — HTTP" },
  { spec: "443", label: "443 — HTTPS" },
  { spec: "3389", label: "3389 — RDP (Escritorio remoto)" },
  { spec: "5432", label: "5432 — PostgreSQL" },
  { spec: "3306", label: "3306 — MySQL / MariaDB" },
  { spec: "6379", label: "6379 — Redis" },
  { spec: "8000-8080", label: "8000-8080 — Rango Web / Dev" },
  { spec: "3000-3100", label: "3000-3100 — Rango Apps Dev" },
];

const DIRECTIONS: Direction[] = ["both", "a_to_b", "b_to_a", "deny"];
const PROTOCOLS: Protocol[] = ["tcp", "udp", "both"];

function protoShort(p: Protocol): string {
  if (p === "tcp") return "TCP";
  if (p === "udp") return "UDP";
  return "Ambos (TCP+UDP)";
}

export function QuickConnectModal({
  scope,
  entities,
  onComplete,
  onCancel,
}: QuickConnectModalProps) {
  const { height: termHeight } = useTerminalDimensions();
  // 0 = Origen, 1 = Destino, 2 = Dirección + Protocolo + Puertos
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [srcCursor, setSrcCursor] = useState(0);
  const [dstCursor, setDstCursor] = useState(entities.length > 1 ? 1 : 0);

  // Step 2 state
  const [focusSection, setFocusSection] = useState<0 | 1 | 2>(0); // 0=dir, 1=proto, 2=ports
  const [dirIdx, setDirIdx] = useState(0); // both
  const [protoIdx, setProtoIdx] = useState(2); // both
  const [portPresets, setPortPresets] = useState<PortPreset[]>(DEFAULT_PORT_PRESETS);
  const [checkedPorts, setCheckedPorts] = useState<Set<string>>(new Set(["*"]));
  const [portCursor, setPortCursor] = useState(0);

  // Custom port/range input inside Step 2
  const [addingPort, setAddingPort] = useState(false);
  const [portDraft, setPortDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const scopeLabel =
    scope === "device"
      ? "Dispositivos"
      : scope === "profile"
        ? "Perfiles"
        : "Usuarios";

  const togglePortCheck = (spec: string) => {
    setCheckedPorts((prev) => {
      const next = new Set(prev);
      if (spec === "*") {
        return new Set(["*"]);
      }
      next.delete("*");
      if (next.has(spec)) {
        next.delete(spec);
      } else {
        next.add(spec);
      }
      if (next.size === 0) {
        next.add("*");
      }
      return next;
    });
  };

  const commitCustomPort = () => {
    const cleaned = portDraft.trim();
    const check = validatePortSpec(cleaned);
    if (!check.valid) {
      setError(check.error ?? "Puerto o rango inválido");
      return;
    }

    if (!portPresets.some((p) => p.spec === cleaned)) {
      const isRange = cleaned.includes("-");
      const label = isRange
        ? `${cleaned} — Rango personalizado`
        : `${cleaned} — Puerto personalizado`;
      setPortPresets((prev) => [...prev, { spec: cleaned, label }]);
      setPortCursor(portPresets.length);
    } else {
      const idx = portPresets.findIndex((p) => p.spec === cleaned);
      if (idx >= 0) setPortCursor(idx);
    }

    if (cleaned === "*") {
      setCheckedPorts(new Set(["*"]));
    } else {
      setCheckedPorts((prev) => {
        const next = new Set(prev);
        next.delete("*");
        next.add(cleaned);
        return next;
      });
    }

    setPortDraft("");
    setAddingPort(false);
    setError(null);
  };

  useKeyboard((key) => {
    // Sub-mode: typing a custom port or range in Step 2
    if (step === 2 && addingPort) {
      if (key.name === "escape") {
        setAddingPort(false);
        setPortDraft("");
        setError(null);
        return;
      }
      if (key.name === "return") {
        commitCustomPort();
        return;
      }
      if (key.name === "backspace") {
        setPortDraft((d) => d.slice(0, -1));
        setError(null);
        return;
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        if (/[0-9\-*]/.test(key.sequence)) {
          setPortDraft((d) => d + key.sequence);
          setError(null);
        }
      }
      return;
    }

    if (key.name === "escape") {
      setError(null);
      if (step === 0) {
        onCancel();
      } else {
        setStep((s) => (s - 1) as 0 | 1 | 2);
      }
      return;
    }

    if (entities.length === 0) return;

    // STEP 0: Select Origen
    if (step === 0) {
      if (key.name === "up" || key.name === "k") {
        setSrcCursor((c) => Math.max(0, c - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSrcCursor((c) => Math.min(entities.length - 1, c + 1));
      } else if (key.name === "return") {
        if (scope === "device" && entities.length < 2) {
          setError("Se necesitan al menos 2 dispositivos para crear una conexión.");
          return;
        }
        if (scope === "device" && dstCursor === srcCursor && entities.length > 1) {
          setDstCursor(srcCursor === 0 ? 1 : 0);
        }
        setError(null);
        setStep(1);
      }
      return;
    }

    // STEP 1: Select Destino
    if (step === 1) {
      if (key.name === "up" || key.name === "k") {
        setDstCursor((c) => Math.max(0, c - 1));
      } else if (key.name === "down" || key.name === "j") {
        setDstCursor((c) => Math.min(entities.length - 1, c + 1));
      } else if (key.name === "return") {
        const src = entities[srcCursor];
        const dst = entities[dstCursor];
        if (!src || !dst) return;
        if (scope === "device" && src.id === dst.id) {
          setError("El destino debe ser un dispositivo diferente al origen.");
          return;
        }
        setError(null);
        setFocusSection(0);
        setStep(2);
      }
      return;
    }

    // STEP 2: Direction + Protocol + Ports checklist
    if (key.name === "tab") {
      setFocusSection((s) => ((s + 1) % 3) as 0 | 1 | 2);
      return;
    }

    if (key.name === "a") {
      setFocusSection(2);
      setPortDraft("");
      setError(null);
      setAddingPort(true);
      return;
    }

    if (key.name === "return") {
      const src = entities[srcCursor];
      const dst = entities[dstCursor];
      if (!src || !dst) return;
      onComplete({
        sourceId: src.id,
        targetId: dst.id,
        direction: DIRECTIONS[dirIdx]!,
        protocol: PROTOCOLS[protoIdx]!,
        ports: normalizePorts(Array.from(checkedPorts)),
      });
      return;
    }

    if (focusSection === 0) {
      if (key.name === "left" || key.name === "h") {
        setDirIdx((i) => (i - 1 + DIRECTIONS.length) % DIRECTIONS.length);
      } else if (key.name === "right" || key.name === "l") {
        setDirIdx((i) => (i + 1) % DIRECTIONS.length);
      } else if (key.name === "down" || key.name === "j") {
        setFocusSection(1);
      }
      return;
    }

    if (focusSection === 1) {
      if (key.name === "left" || key.name === "h") {
        setProtoIdx((i) => (i - 1 + PROTOCOLS.length) % PROTOCOLS.length);
      } else if (key.name === "right" || key.name === "l") {
        setProtoIdx((i) => (i + 1) % PROTOCOLS.length);
      } else if (key.name === "up" || key.name === "k") {
        setFocusSection(0);
      } else if (key.name === "down" || key.name === "j") {
        setFocusSection(2);
      }
      return;
    }

    // focusSection === 2 (Ports checklist)
    if (key.name === "up" || key.name === "k") {
      if (portCursor === 0) {
        setFocusSection(1);
      } else {
        setPortCursor((c) => Math.max(0, c - 1));
      }
    } else if (key.name === "down" || key.name === "j") {
      setPortCursor((c) => Math.min(portPresets.length - 1, c + 1));
    } else if (key.name === "space") {
      const item = portPresets[portCursor];
      if (item) {
        togglePortCheck(item.spec);
      }
    }
  });

  const srcEntity = entities[srcCursor];
  const dstEntity = entities[dstCursor];

  // Render list helper for Step 0 (Origen) and Step 1 (Destino)
  const renderEntityStep = (
    titleLabel: "Origen" | "Destino",
    activeCursor: number
  ) => {
    const pageSize = 12;
    const start = Math.max(
      0,
      Math.min(activeCursor - 5, Math.max(0, entities.length - pageSize))
    );
    const slice = entities.slice(start, start + pageSize);

    return (
      <>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={THEME.accent}>
            <b>{`${titleLabel} — ${scopeLabel} (Paso ${step + 1}/3)`}</b>
          </text>
          <text fg={THEME.muted}>
            {step === 0 ? "[Esc] Cerrar" : "[Esc] Volver a Origen"}
          </text>
        </box>

        {step === 1 && srcEntity ? (
          <box paddingX={1} backgroundColor={THEME.surfaceAlt}>
            <text fg={THEME.teal}>
              <b>{`Origen seleccionado: ${srcEntity.label}`}</b>
            </text>
          </box>
        ) : null}

        {entities.length === 0 ? (
          <box padding={2}>
            <text fg={THEME.yellow}>
              {scope === "profile"
                ? "No hay perfiles creados todavía. Pulsa [Esc] y usa [f] para crear un perfil."
                : "No hay elementos disponibles en esta pestaña."}
            </text>
          </box>
        ) : (
          <box
            flexDirection="column"
            border
            borderColor={THEME.borderActive}
            backgroundColor={THEME.bg}
            padding={1}
            flexGrow={1}
          >
            {slice.map((item, i) => {
              const idx = start + i;
              const isSel = idx === activeCursor;
              const isSameAsSrc =
                step === 1 && scope === "device" && srcEntity?.id === item.id;
              return (
                <box
                  key={item.id}
                  paddingX={1}
                  backgroundColor={isSel ? THEME.selectedBg : THEME.bg}
                >
                  <text
                    fg={
                      isSameAsSrc
                        ? THEME.muted
                        : isSel
                          ? THEME.accent
                          : THEME.text
                    }
                  >
                    {isSel ? "▸ " : "  "}
                    <b>{item.label}</b>
                    {item.detail ? (
                      <span fg={THEME.muted}>{`  (${item.detail})`}</span>
                    ) : null}
                    {isSameAsSrc ? (
                      <span fg={THEME.yellow}>{"  [Origen]"}</span>
                    ) : null}
                  </text>
                </box>
              );
            })}
          </box>
        )}

        {error ? <text fg={THEME.red}>{`⚠ ${error}`}</text> : null}

        <text fg={THEME.subtext}>
          <span fg={THEME.accent}>[↑/↓]</span> Elegir{"  "}
          <span fg={THEME.green}>[Enter]</span>{" "}
          {step === 0 ? "Confirmar Origen → Destino" : "Confirmar Destino → Configurar"}{"  "}
          <span fg={THEME.muted}>[Esc]</span> {step === 0 ? "Cancelar" : "Volver a Origen"}
        </text>
      </>
    );
  };

  // Step 2 viewport for ports checklist (adapts to terminal height)
  const portPageSize = Math.max(6, termHeight - (addingPort ? 25 : 22));
  const portStart = Math.max(
    0,
    Math.min(
      portCursor - Math.floor(portPageSize / 2),
      Math.max(0, portPresets.length - portPageSize)
    )
  );
  const visiblePorts = portPresets.slice(portStart, portStart + portPageSize);
  const currentDir = DIRECTIONS[dirIdx]!;
  const currentProto = PROTOCOLS[protoIdx]!;

  return (
    <box
      position="absolute"
      top={1}
      left={4}
      right={4}
      bottom={1}
      zIndex={24}
      border
      borderStyle="rounded"
      borderColor={THEME.borderActive}
      backgroundColor={THEME.modalBg}
      padding={1}
      flexDirection="column"
      gap={1}
    >
      {step === 0 ? renderEntityStep("Origen", srcCursor) : null}
      {step === 1 ? renderEntityStep("Destino", dstCursor) : null}

      {step === 2 ? (
        <>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={THEME.accent}>
              <b>{`Configurar Regla (Paso 3/3): ${srcEntity?.label ?? ""}  ↔  ${dstEntity?.label ?? ""}`}</b>
            </text>
            <text fg={THEME.muted}>[Esc] Volver a Destino</text>
          </box>

          {/* 1. Direction */}
          <box
            flexDirection="column"
            paddingX={1}
            border
            borderColor={focusSection === 0 ? THEME.borderActive : THEME.border}
            backgroundColor={focusSection === 0 ? THEME.surfaceAlt : THEME.bg}
          >
            <text fg={focusSection === 0 ? THEME.accent : THEME.subtext}>
              <b>{`${focusSection === 0 ? "▸ " : "  "}1. Dirección (← / →):`}</b>
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
          </box>

          {/* 2. Protocol */}
          <box
            flexDirection="column"
            paddingX={1}
            border
            borderColor={focusSection === 1 ? THEME.borderActive : THEME.border}
            backgroundColor={focusSection === 1 ? THEME.surfaceAlt : THEME.bg}
          >
            <text fg={focusSection === 1 ? THEME.accent : THEME.subtext}>
              <b>{`${focusSection === 1 ? "▸ " : "  "}2. Protocolo (← / →):`}</b>
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

          {/* 3. Ports & Ranges Checklist + Add Custom */}
          <box
            flexDirection="column"
            paddingX={1}
            border
            borderColor={focusSection === 2 ? THEME.borderActive : THEME.border}
            backgroundColor={THEME.bg}
            flexGrow={1}
          >
            <box flexDirection="row" justifyContent="space-between">
              <text fg={focusSection === 2 ? THEME.accent : THEME.subtext}>
                <b>{`${focusSection === 2 ? "▸ " : "  "}3. Puertos y rangos conocidos ([Espacio] marcar · [a] añadir puerto/rango):`}</b>
              </text>
              <text fg={THEME.teal}>
                {`Seleccionados: ${normalizePorts(Array.from(checkedPorts)).join(", ")}`}
              </text>
            </box>

            {visiblePorts.map((preset, i) => {
              const idx = portStart + i;
              const isCur = focusSection === 2 && !addingPort && idx === portCursor;
              const isChecked = checkedPorts.has(preset.spec);
              return (
                <box
                  key={preset.spec}
                  paddingX={1}
                  backgroundColor={isCur ? THEME.selectedBg : THEME.bg}
                >
                  <text fg={isChecked ? THEME.green : isCur ? THEME.text : THEME.subtext}>
                    {isCur ? "▸ " : "  "}
                    {isChecked ? "[✓] " : "[ ] "}
                    {preset.label}
                  </text>
                </box>
              );
            })}

            {addingPort ? (
              <box
                border
                borderColor={THEME.yellow}
                backgroundColor={THEME.surfaceAlt}
                paddingX={1}
                flexDirection="column"
              >
                <text fg={THEME.yellow}>
                  <b>Añadir puerto o rango (ej. 8080 o 5000-5100) — Enter confirmar, Esc cancelar:</b>
                </text>
                <text fg={THEME.text}>{`> ${portDraft}█`}</text>
              </box>
            ) : null}
          </box>

          {error ? <text fg={THEME.red}>{`⚠ ${error}`}</text> : null}

          <text fg={THEME.subtext}>
            <span fg={THEME.accent}>[↑/↓ / Tab]</span> Sección{"  "}
            <span fg={THEME.accent}>[←/→]</span> Dir/Proto{"  "}
            <span fg={THEME.yellow}>[Espacio]</span> Marcar puerto{"  "}
            <span fg={THEME.cyan}>[a]</span> Añadir puerto/rango{"  "}
            <span fg={THEME.green}>[Enter]</span> Guardar{"  "}
            <span fg={THEME.muted}>[Esc]</span> Volver
          </text>
        </>
      ) : null}
    </box>
  );
}
