import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { THEME } from "../theme.ts";

export interface DeletableItem {
  id: string;
  kind: "rule" | "profile" | "conflict_resolutions";
  targetId: string;
  label: string;
  impactDetail?: string;
}

export interface DeleteModalProps {
  items: DeletableItem[];
  preselectedId?: string;
  onConfirmDelete: (selectedItems: DeletableItem[]) => void;
  onCancel: () => void;
}

export function DeleteModal({
  items,
  preselectedId,
  onConfirmDelete,
  onCancel,
}: DeleteModalProps) {
  const initialCursor = preselectedId
    ? Math.max(0, items.findIndex((i) => i.id === preselectedId))
    : 0;

  const [step, setStep] = useState<"select" | "confirm">("select");
  const [cursor, setCursor] = useState(initialCursor);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [confirmChoice, setConfirmChoice] = useState<0 | 1>(0); // 0 = Cancelar, 1 = Sí eliminar

  const getEffectiveSelection = (): DeletableItem[] => {
    if (checkedIds.size > 0) {
      return items.filter((i) => checkedIds.has(i.id));
    }
    const highlighted = items[cursor];
    return highlighted ? [highlighted] : [];
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (step === "confirm") {
        setStep("select");
      } else {
        onCancel();
      }
      return;
    }

    if (items.length === 0) return;

    if (step === "select") {
      if (key.name === "up" || key.name === "k") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (key.name === "down" || key.name === "j") {
        setCursor((c) => Math.min(items.length - 1, c + 1));
      } else if (key.name === "space") {
        const item = items[cursor];
        if (!item) return;
        setCheckedIds((prev) => {
          const next = new Set(prev);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
      } else if (key.name === "return") {
        if (getEffectiveSelection().length > 0) {
          setConfirmChoice(0);
          setStep("confirm");
        }
      }
      return;
    }

    // Confirm step
    if (key.name === "left" || key.name === "right" || key.name === "tab") {
      setConfirmChoice((c) => (c === 0 ? 1 : 0));
    } else if (key.name === "n") {
      setStep("select");
    } else if (key.name === "s" || key.name === "y") {
      onConfirmDelete(getEffectiveSelection());
    } else if (key.name === "return") {
      if (confirmChoice === 1) {
        onConfirmDelete(getEffectiveSelection());
      } else {
        setStep("select");
      }
    }
  });

  const selectedToDelete = getEffectiveSelection();
  const start = Math.max(0, cursor - 4);
  const visibleItems = items.slice(start, start + 10);

  return (
    <box
      position="absolute"
      top={3}
      left={7}
      right={7}
      zIndex={25}
      border
      borderStyle="rounded"
      borderColor={THEME.borderDanger}
      backgroundColor={THEME.modalBg}
      padding={2}
      flexDirection="column"
      gap={1}
    >
      <text fg={THEME.red}>
        <b>
          {step === "select"
            ? "Eliminar Reglas / Ligamientos (^X) — Selecciona qué deseas quitar"
            : "Confirmar Eliminación (^X) — ¿Estás seguro?"}
        </b>
      </text>

      {items.length === 0 ? (
        <box padding={1} flexDirection="column" gap={1}>
          <text fg={THEME.muted}>No hay reglas, ligamientos ni perfiles para eliminar en esta vista.</text>
          <text fg={THEME.subtext}>Pulsa [Esc] para volver.</text>
        </box>
      ) : step === "select" ? (
        <>
          <text fg={THEME.subtext}>
            Elige uno o marca varios con [Espacio], luego pulsa [Enter] para confirmar:
          </text>

          <box
            flexDirection="column"
            border
            borderColor={THEME.border}
            backgroundColor={THEME.bg}
            padding={1}
            minHeight={7}
          >
            {visibleItems.map((item, i) => {
              const idx = start + i;
              const isCur = idx === cursor;
              const isChecked = checkedIds.has(item.id);
              const badge =
                item.kind === "profile"
                  ? "[Perfil]"
                  : item.kind === "conflict_resolutions"
                    ? "[Conflictos]"
                    : "[Regla]";
              return (
                <box
                  key={item.id}
                  paddingX={1}
                  backgroundColor={isCur ? THEME.selectedBg : THEME.bg}
                >
                  <text fg={isChecked ? THEME.red : isCur ? THEME.yellow : THEME.text}>
                    {isCur ? "▸ " : "  "}
                    {isChecked ? "[✓] " : "[ ] "}
                    <span fg={THEME.muted}>{`${badge} `}</span>
                    {item.label}
                  </text>
                </box>
              );
            })}
          </box>

          <text fg={THEME.subtext}>
            <span fg={THEME.accent}>[↑/↓]</span> Navegar{"  "}
            <span fg={THEME.yellow}>[Espacio]</span> Marcar varios{"  "}
            <span fg={THEME.red}>[Enter]</span> Continuar a confirmación{"  "}
            <span fg={THEME.muted}>[Esc]</span> Cancelar
          </text>
        </>
      ) : (
        <>
          <text fg={THEME.yellow}>
            <b>{`Se eliminarán ${selectedToDelete.length} elemento(s):`}</b>
          </text>

          <box
            flexDirection="column"
            border
            borderColor={THEME.borderWarn}
            backgroundColor={THEME.bg}
            padding={1}
          >
            {selectedToDelete.map((item) => (
              <box key={item.id} flexDirection="column">
                <text fg={THEME.red}>{`  ✕ ${item.label}`}</text>
                {item.impactDetail ? (
                  <text fg={THEME.muted}>{`      ↳ ${item.impactDetail}`}</text>
                ) : null}
              </box>
            ))}
          </box>

          <box flexDirection="row" gap={3} paddingTop={1}>
            <box
              paddingX={2}
              border
              borderColor={confirmChoice === 0 ? THEME.borderActive : THEME.border}
              backgroundColor={confirmChoice === 0 ? THEME.selectedBg : THEME.bg}
            >
              <text fg={confirmChoice === 0 ? THEME.text : THEME.muted}>
                {confirmChoice === 0 ? <b>[ Cancelar ]</b> : "  Cancelar  "}
              </text>
            </box>
            <box
              paddingX={2}
              border
              borderColor={confirmChoice === 1 ? THEME.borderDanger : THEME.border}
              backgroundColor={confirmChoice === 1 ? THEME.selectedBg : THEME.bg}
            >
              <text fg={confirmChoice === 1 ? THEME.red : THEME.muted}>
                {confirmChoice === 1 ? <b>[ Sí, eliminar ]</b> : "  Sí, eliminar  "}
              </text>
            </box>
          </box>

          <text fg={THEME.subtext}>
            <span fg={THEME.accent}>[←/→]</span> Elegir{"  "}
            <span fg={THEME.green}>[Enter]</span> Confirmar{"  "}
            <span fg={THEME.red}>[y/s]</span> Eliminar directo{"  "}
            <span fg={THEME.muted}>[Esc/n]</span> Volver
          </text>
        </>
      )}
    </box>
  );
}
