import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { normalizePorts, validatePortSpec } from "../../engine/resolver.ts";
import { THEME } from "../theme.ts";

export interface PortsModalProps {
  ruleLabel: string;
  initialPorts: string[];
  onSave: (ports: string[]) => void;
  onCancel: () => void;
}

type InputMode = "list" | "add" | "edit";

export function PortsModal({
  ruleLabel,
  initialPorts,
  onSave,
  onCancel,
}: PortsModalProps) {
  const [ports, setPorts] = useState<string[]>(normalizePorts(initialPorts));
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<InputMode>("list");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const commitDraft = () => {
    const cleaned = draft.trim();
    const check = validatePortSpec(cleaned);
    if (!check.valid) {
      setError(check.error ?? "Puerto inválido");
      return;
    }

    if (mode === "add") {
      if (cleaned === "*") {
        setPorts(["*"]);
        setCursor(0);
      } else {
        const next = normalizePorts(
          ports.filter((p) => p !== "*").concat(cleaned)
        );
        setPorts(next);
        setCursor(Math.max(0, next.indexOf(cleaned)));
      }
    } else if (mode === "edit") {
      if (cleaned === "*") {
        setPorts(["*"]);
        setCursor(0);
      } else {
        const copy = [...ports];
        copy[cursor] = cleaned;
        const next = normalizePorts(copy.filter((p) => p !== "*"));
        setPorts(next);
        setCursor(Math.min(cursor, next.length - 1));
      }
    }

    setError(null);
    setDraft("");
    setMode("list");
  };

  useKeyboard((key) => {
    if (mode !== "list") {
      if (key.name === "escape") {
        setMode("list");
        setDraft("");
        setError(null);
        return;
      }
      if (key.name === "return") {
        commitDraft();
        return;
      }
      if (key.name === "backspace") {
        setDraft((d) => d.slice(0, -1));
        setError(null);
        return;
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        if (/[0-9\-*]/.test(key.sequence)) {
          setDraft((d) => d + key.sequence);
          setError(null);
        }
      }
      return;
    }

    if (key.name === "escape") {
      onCancel();
      return;
    }
    if (key.name === "return") {
      onSave(normalizePorts(ports));
      return;
    }
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(Math.max(0, ports.length - 1), c + 1));
      return;
    }
    if (key.name === "a") {
      setDraft("");
      setError(null);
      setMode("add");
      return;
    }
    if (key.name === "e") {
      const current = ports[cursor];
      if (current !== undefined) {
        setDraft(current);
        setError(null);
        setMode("edit");
      }
      return;
    }
    if (key.name === "x") {
      const remaining = ports.filter((_, idx) => idx !== cursor);
      const next = remaining.length === 0 ? ["*"] : remaining;
      setPorts(next);
      setCursor((c) => Math.min(c, next.length - 1));
      setError(null);
    }
  });

  return (
    <box
      position="absolute"
      top={3}
      left={10}
      right={10}
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
        <b>{`Puertos Permitidos (p) — ${ruleLabel}`}</b>
      </text>

      <text fg={THEME.subtext}>
        Define puertos individuales (ej. 22, 443), rangos (8000-8080) o * para todos.
      </text>

      {/* Ports list */}
      <box
        flexDirection="column"
        border
        borderColor={THEME.border}
        backgroundColor={THEME.bg}
        padding={1}
        minHeight={7}
      >
        {ports.map((port, idx) => {
          const active = idx === cursor;
          const desc =
            port === "*"
              ? "Todos los puertos"
              : port === "22"
                ? "SSH"
                : port === "80"
                  ? "HTTP"
                  : port === "443"
                    ? "HTTPS"
                    : port === "53"
                      ? "DNS"
                      : "";
          return (
            <box
              key={`${port}-${idx}`}
              paddingX={1}
              backgroundColor={active ? THEME.selectedBg : THEME.bg}
            >
              <text fg={active ? THEME.green : THEME.text}>
                {active ? "▸ " : "  "}
                <b>{port}</b>
                {desc ? <span fg={THEME.muted}>{`  (${desc})`}</span> : null}
              </text>
            </box>
          );
        })}
      </box>

      {/* Inline Add / Edit box */}
      {mode !== "list" ? (
        <box
          flexDirection="column"
          border
          borderColor={THEME.yellow}
          backgroundColor={THEME.surfaceAlt}
          padding={1}
        >
          <text fg={THEME.yellow}>
            <b>
              {mode === "add"
                ? "Añadir puerto o rango (Enter para confirmar, Esc para cancelar):"
                : "Modificar puerto seleccionado (Enter para confirmar, Esc para cancelar):"}
            </b>
          </text>
          <text fg={THEME.text}>{`> ${draft}█`}</text>
          {error ? <text fg={THEME.red}>{`⚠ ${error}`}</text> : null}
        </box>
      ) : null}

      <text fg={THEME.subtext}>
        <span fg={THEME.green}>[a]</span> Añadir{"  "}
        <span fg={THEME.yellow}>[e]</span> Modificar{"  "}
        <span fg={THEME.red}>[x]</span> Eliminar{"  "}
        <span fg={THEME.accent}>[Enter]</span> Guardar lista{"  "}
        <span fg={THEME.muted}>[Esc]</span> Cancelar
      </text>
    </box>
  );
}
