import { useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { computeSimpleDiff } from "../../engine/compiler.ts";
import type { CompileResult } from "../../types/headscale.ts";
import { THEME } from "../theme.ts";
import { SudoPasswordModal } from "./SudoPasswordModal.tsx";

export interface ApplyResult {
  ok: boolean;
  message: string;
  needsSudoPassword?: boolean;
  wrongPassword?: boolean;
}

export interface ApplyDiffModalProps {
  compiled: CompileResult;
  existingPolicyRaw: string;
  unresolvedConflictCount: number;
  hostLabel: string;
  policyPathUnconfigured?: boolean;
  configPath?: string;
  isDemo: boolean;
  onProvideSudoPassword: (password: string) => void;
  onConfirmApply: () => Promise<ApplyResult>;
  onOpenConflicts: () => void;
  onClose: () => void;
}

export function ApplyDiffModal({
  compiled,
  existingPolicyRaw,
  unresolvedConflictCount,
  hostLabel,
  policyPathUnconfigured,
  configPath,
  isDemo,
  onProvideSudoPassword,
  onConfirmApply,
  onOpenConflicts,
  onClose,
}: ApplyDiffModalProps) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [sudoPrompt, setSudoPrompt] = useState<{
    reason: string;
    error?: string;
  } | null>(null);

  const runApply = () => {
    setApplying(true);
    setResult(null);
    void onConfirmApply().then((res) => {
      setApplying(false);
      if (!res.ok && res.needsSudoPassword) {
        setSudoPrompt({
          reason: res.message,
          error: res.wrongPassword ? "Contraseña sudo incorrecta, intenta de nuevo." : undefined,
        });
      } else {
        setResult(res);
      }
    });
  };

  const diffLines = useMemo(
    () => computeSimpleDiff(existingPolicyRaw || "", compiled.hujson),
    [existingPolicyRaw, compiled.hujson]
  );

  const pageSize = 14;
  const maxScroll = Math.max(0, diffLines.length - pageSize);

  useKeyboard((key) => {
    if (applying || sudoPrompt) return;

    if (key.name === "escape" || (result && key.name === "return")) {
      onClose();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      setScrollOffset((o) => Math.max(0, o - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setScrollOffset((o) => Math.min(maxScroll, o + 1));
      return;
    }
    if (key.name === "c" && unresolvedConflictCount > 0) {
      onOpenConflicts();
      return;
    }
    if (key.name === "return" && !result) {
      if (unresolvedConflictCount > 0) {
        onOpenConflicts();
        return;
      }
      runApply();
    }
  });

  const visibleDiff = diffLines.slice(scrollOffset, scrollOffset + pageSize);

  return (
    <box
      position="absolute"
      top={1}
      left={3}
      right={3}
      bottom={1}
      zIndex={25}
      border
      borderStyle="rounded"
      borderColor={
        compiled.warnings.some((w) => w.severity === "critical")
          ? THEME.borderDanger
          : THEME.borderActive
      }
      backgroundColor={THEME.modalBg}
      padding={1}
      flexDirection="column"
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={THEME.accent}>
          <b>
            {isDemo
              ? "Vista Previa HuJSON Compilado (MODO DEMO — no toca ningún servidor)"
              : "Revisar Diff y Aplicar Política a Headscale (s)"}
          </b>
        </text>
        <text fg={THEME.muted}>
          {`Hosts: ${compiled.stats.hostCount} · ACLs: ${compiled.stats.aclRuleCount} · Permitidos: ${compiled.stats.allowedPairs} · Bloqueados: ${compiled.stats.blockedPairs}`}
        </text>
      </box>

      {unresolvedConflictCount > 0 ? (
        <box border borderColor={THEME.borderWarn} paddingX={1} backgroundColor={THEME.surfaceAlt}>
          <text fg={THEME.yellow}>
            <b>
              {`⚠ Hay ${unresolvedConflictCount} conflicto(s) de perfiles sin resolver. Pulsa [c] o [Enter] para decidir qué perfil prevalece antes de aplicar.`}
            </b>
          </text>
        </box>
      ) : null}

      {compiled.warnings.map((w, idx) => (
        <box
          key={idx}
          border
          borderColor={w.severity === "critical" ? THEME.borderDanger : THEME.borderWarn}
          paddingX={1}
          backgroundColor={THEME.surfaceAlt}
        >
          <text fg={w.severity === "critical" ? THEME.red : THEME.yellow}>
            <b>{w.message}</b>
          </text>
        </box>
      ))}

      {policyPathUnconfigured ? (
        <box border borderColor={THEME.borderWarn} paddingX={1} backgroundColor={THEME.surfaceAlt}>
          <text fg={THEME.yellow}>
            <b>
              {`⚠ policy.path está vacío en ${configPath || "config.yaml"}: al aplicar, tacl lo activará automáticamente (con backup) y reiniciará Headscale.`}
            </b>
          </text>
        </box>
      ) : null}

      {compiled.isPassthrough ? (
        <box paddingX={1} backgroundColor={THEME.surfaceAlt}>
          <text fg={THEME.teal}>
            Modo sin restricciones adicionales: no hay reglas creadas todavía, se preserva la política existente de Headscale.
          </text>
        </box>
      ) : null}

      {/* Diff viewport */}
      <box
        flexDirection="column"
        border
        borderColor={THEME.border}
        backgroundColor={THEME.bg}
        padding={1}
        flexGrow={1}
      >
        {visibleDiff.map((line, i) => {
          const color =
            line.kind === "add"
              ? THEME.green
              : line.kind === "remove"
                ? THEME.red
                : THEME.muted;
          const prefix = line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  ";
          return (
            <text key={scrollOffset + i} fg={color} truncate>
              {prefix + line.text}
            </text>
          );
        })}
      </box>

      {result ? (
        <box
          border
          borderColor={result.ok ? THEME.green : THEME.borderDanger}
          paddingX={1}
          backgroundColor={THEME.surfaceAlt}
        >
          <text fg={result.ok ? THEME.green : THEME.red}>
            <b>{result.ok ? `✓ ${result.message}` : `✕ ${result.message}`}</b>
          </text>
        </box>
      ) : null}

      <text fg={THEME.subtext}>
        {applying ? (
          <span fg={THEME.cyan}>Aplicando política y creando backup...</span>
        ) : result ? (
          <span fg={THEME.green}>Pulsa [Enter] o [Esc] para volver a la tabla.</span>
        ) : (
          <>
            <span fg={THEME.accent}>[↑/↓]</span> Scroll Diff{"  "}
            {unresolvedConflictCount > 0 ? (
              <span fg={THEME.yellow}>[c / Enter] Resolver conflictos  </span>
            ) : (
              <span fg={THEME.green}>
                {isDemo ? "[Enter] Simular guardado  " : "[Enter] Aplicar a Headscale (con backup)  "}
              </span>
            )}
            <span fg={THEME.muted}>[Esc] Cancelar</span>
          </>
        )}
      </text>
      {sudoPrompt ? (
        <SudoPasswordModal
          hostLabel={hostLabel}
          reason={sudoPrompt.reason}
          errorMessage={sudoPrompt.error}
          onCancel={() => {
            setSudoPrompt(null);
            setResult({
              ok: false,
              message: "Operación cancelada (se requiere contraseña sudo).",
            });
          }}
          onSubmit={(password) => {
            setSudoPrompt(null);
            onProvideSudoPassword(password);
            runApply();
          }}
        />
      ) : null}
    </box>
  );
}
