import type { TabId } from "../../types/model.ts";
import { THEME } from "../theme.ts";

export interface TabBarProps {
  activeTab: TabId;
  counts: Record<TabId, number>;
  conflictCount: number;
}

const TABS: Array<{ id: TabId; num: string; label: string; badge?: string }> = [
  { id: "devices", num: "1", label: "Dispositivos" },
  { id: "profiles", num: "2", label: "Perfiles" },
  { id: "users", num: "3", label: "Usuarios" },
  { id: "direct", num: "4", label: "Conexiones Directas", badge: "Solo lectura" },
];

export function TabBar({ activeTab, counts, conflictCount }: TabBarProps) {
  return (
    <box
      flexDirection="row"
      gap={1}
      paddingX={1}
      paddingY={0}
      backgroundColor={THEME.surface}
      border={["bottom"]}
      borderColor={THEME.border}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const count = counts[tab.id];
        const showConflict = tab.id === "direct" && conflictCount > 0;
        return (
          <box
            key={tab.id}
            paddingX={1}
            backgroundColor={isActive ? THEME.selectedBg : THEME.surface}
            {...(isActive ? { border: ["bottom"], borderColor: THEME.borderActive } : {})}
          >
            <text fg={isActive ? THEME.accent : THEME.subtext}>
              {isActive ? <b>{`[${tab.num}] ${tab.label}`}</b> : `[${tab.num}] ${tab.label}`}
              <span fg={THEME.muted}>{` (${count})`}</span>
              {tab.badge ? (
                <span fg={isActive ? THEME.yellow : THEME.muted}>{` · ${tab.badge}`}</span>
              ) : null}
              {showConflict ? (
                <span fg={THEME.red}>{` ⚠ ${conflictCount}`}</span>
              ) : null}
            </text>
          </box>
        );
      })}
    </box>
  );
}
