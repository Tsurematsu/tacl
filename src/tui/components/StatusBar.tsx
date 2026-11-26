import type { TabId } from "../../types/model.ts";
import { THEME } from "../theme.ts";

export interface StatusBarProps {
  activeTab: TabId;
  hasUnsavedChanges: boolean;
  conflictCount: number;
  groupedByOrigin: boolean;
  toast?: { message: string; kind: "info" | "success" | "warn" | "error" };
}

export function StatusBar({
  activeTab,
  hasUnsavedChanges,
  conflictCount,
  groupedByOrigin,
  toast,
}: StatusBarProps) {
  const isReadOnly = activeTab === "direct";

  const toastColor =
    toast?.kind === "error"
      ? THEME.red
      : toast?.kind === "warn"
        ? THEME.yellow
        : toast?.kind === "success"
          ? THEME.green
          : THEME.cyan;

  return (
    <box
      flexDirection="column"
      backgroundColor={THEME.surface}
      border={["top"]}
      borderColor={THEME.border}
      paddingX={1}
    >
      {toast ? (
        <box paddingBottom={0}>
          <text fg={toastColor}>
            <b>{toast.message}</b>
          </text>
        </box>
      ) : null}

      <box flexDirection="row" justifyContent="space-between">
        {isReadOnly ? (
          <text fg={THEME.subtext}>
            <span fg={THEME.accent}>[←/→]</span> Tabs{"  "}
            <span fg={THEME.accent}>[↑/↓]</span> Navegar{"  "}
            <span fg={THEME.cyan}>[Enter]</span> Desplegar/Inspeccionar{"  "}
            <span fg={THEME.accent}>[z]</span> Todo{"  "}
            <span fg={THEME.yellow}>[g]</span> {groupedByOrigin ? "Desagrupar" : "Agrupar"}{"  "}
            <span fg={THEME.accent}>[/]</span> Filtrar{"  "}
            {conflictCount > 0 ? (
              <>
                <span fg={THEME.red}>[c]</span> Conflictos ({conflictCount}){"  "}
              </>
            ) : null}
            <span fg={THEME.green}>[s]</span> Aplicar{"  "}
            <span fg={THEME.muted}>(Solo lectura)</span>
          </text>
        ) : (
          <text fg={THEME.subtext}>
            <span fg={THEME.accent}>[←/→]</span> Tabs{"  "}
            <span fg={THEME.cyan}>[Enter]</span> Desplegar{"  "}
            <span fg={THEME.yellow}>[g]</span> {groupedByOrigin ? "Desagrupar" : "Agrupar"}{"  "}
            <span fg={THEME.green}>[Espacio]</span> Conectar{"  "}
            <span fg={THEME.cyan}>[a]</span> Todos{"  "}
            <span fg={THEME.accent}>[l]</span> Ligar{"  "}
            <span fg={THEME.accent}>[u]</span> Dir/Proto{"  "}
            <span fg={THEME.accent}>[p]</span> Puertos{"  "}
            <span fg={THEME.accent}>[f]</span> Perfil{"  "}
            <span fg={THEME.red}>[^X]</span> Borrar{"  "}
            <span fg={hasUnsavedChanges ? THEME.yellow : THEME.green}>[s]</span>{" "}
            {hasUnsavedChanges ? "Aplicar*" : "Aplicar"}{"  "}
            <span fg={THEME.muted}>[q] Salir</span>
          </text>
        )}
      </box>
    </box>
  );
}
