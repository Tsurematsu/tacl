import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { THEME } from "../theme.ts";

export interface SudoPasswordModalProps {
  hostLabel: string;
  reason: string;
  errorMessage?: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function SudoPasswordModal({
  hostLabel,
  reason,
  errorMessage,
  onSubmit,
  onCancel,
}: SudoPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel();
      return;
    }
    if (key.name === "return") {
      if (!password) {
        setLocalError("Ingresa la contraseña sudo o pulsa [Esc] para cancelar.");
        return;
      }
      onSubmit(password);
      return;
    }
    if (key.name === "backspace") {
      setPassword((p) => p.slice(0, -1));
      setLocalError(null);
      return;
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      setPassword((p) => p + key.sequence);
      setLocalError(null);
    }
  });

  const masked = "•".repeat(password.length);

  return (
    <box
      position="absolute"
      top={5}
      left={10}
      right={10}
      zIndex={40}
      border
      borderStyle="rounded"
      borderColor={THEME.borderWarn}
      backgroundColor={THEME.modalBg}
      padding={2}
      flexDirection="column"
      gap={1}
    >
      <text fg={THEME.yellow}>
        <b>{`🔐 Autenticación sudo requerida — ${hostLabel}`}</b>
      </text>

      <text fg={THEME.text}>{reason}</text>

      <box
        flexDirection="column"
        flexShrink={0}
        height={4}
        border
        borderColor={THEME.borderActive}
        backgroundColor={THEME.bg}
        paddingX={1}
      >
        <text fg={THEME.accent}>
          <b>Contraseña sudo:</b>
        </text>
        <text fg={THEME.text}>{`${masked}█`}</text>
      </box>

      {errorMessage || localError ? (
        <text fg={THEME.red}>{`⚠ ${localError ?? errorMessage}`}</text>
      ) : null}

      <text fg={THEME.muted}>
        Solo se mantiene en memoria durante esta sesión (nunca se guarda en disco).
      </text>

      <text fg={THEME.subtext}>
        <span fg={THEME.green}>[Enter]</span> Continuar y reintentar acción{"  "}
        <span fg={THEME.muted}>[Esc]</span> Cancelar
      </text>
    </box>
  );
}
