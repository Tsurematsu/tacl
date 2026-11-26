import { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { SshTarget } from "../../ssh/executor.ts";
import {
  type ContainerHint,
  listRemoteDirectory,
  type RemoteDirEntry,
} from "../../ssh/headscale.ts";
import { THEME } from "../theme.ts";

export interface RemoteBrowserProps {
  target: SshTarget;
  hints: ContainerHint[];
  initialPath?: string;
  onSelectDir: (dirPath: string, matchedHint?: ContainerHint) => void;
  onCancel: () => void;
}

export function RemoteBrowser({
  target,
  hints,
  initialPath,
  onSelectDir,
  onCancel,
}: RemoteBrowserProps) {
  const suggestedDirs = Array.from(
    new Set(hints.flatMap((h) => h.suggestedDirs))
  );

  const [currentPath, setCurrentPath] = useState(
    initialPath || suggestedDirs[0] || "~"
  );
  const [entries, setEntries] = useState<RemoteDirEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(currentPath);

  const loadDir = async (dir: string) => {
    setLoading(true);
    setError(null);
    const res = await listRemoteDirectory(target, dir);
    setCurrentPath(res.currentPath);
    setPathInput(res.currentPath);
    setEntries(res.entries);
    setCursor(0);
    setError(res.error ?? null);
    setLoading(false);
  };

  useEffect(() => {
    void loadDir(currentPath);
  }, []);

  useKeyboard((key) => {
    if (editingPath) {
      if (key.name === "escape") {
        setEditingPath(false);
        setPathInput(currentPath);
      } else if (key.name === "return") {
        setEditingPath(false);
        void loadDir(pathInput.trim() || "/");
      } else if (key.name === "backspace") {
        setPathInput((v) => v.slice(0, -1));
      } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setPathInput((v) => v + key.sequence);
      }
      return;
    }

    if (key.name === "escape") {
      onCancel();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(Math.max(0, entries.length - 1), c + 1));
      return;
    }
    if (key.name === "return") {
      const item = entries[cursor];
      if (item?.isDir) {
        void loadDir(item.path);
      }
      return;
    }
    if (key.name === "g") {
      setPathInput(currentPath);
      setEditingPath(true);
      return;
    }
    if (key.name === "s" || key.name === "space") {
      const matched = hints.find((h) =>
        h.suggestedDirs.some((d) => currentPath.startsWith(d) || d.startsWith(currentPath))
      ) ?? hints[0];
      onSelectDir(currentPath, matched);
      return;
    }
    // Quick jump to suggested dir with number keys 1-9
    if (/^[1-9]$/.test(key.name)) {
      const idx = Number(key.name) - 1;
      const targetDir = suggestedDirs[idx];
      if (targetDir) {
        void loadDir(targetDir);
      }
    }
  });

  const visibleEntries = entries.slice(
    Math.max(0, cursor - 6),
    Math.max(0, cursor - 6) + 14
  );
  const baseIdx = Math.max(0, cursor - 6);

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={THEME.borderActive}
      backgroundColor={THEME.surface}
      padding={1}
      gap={1}
      flexGrow={1}
    >
      <text fg={THEME.accent}>
        <b>{`Explorador remoto en ${target.hostAlias} — Selecciona la carpeta del contenedor Headscale`}</b>
      </text>

      {suggestedDirs.length > 0 ? (
        <box flexDirection="column" paddingX={1} backgroundColor={THEME.surfaceAlt}>
          <text fg={THEME.green}>
            <b>Carpetas detectadas en contenedores Headscale (pulsa 1-{Math.min(9, suggestedDirs.length)} para saltar):</b>
          </text>
          {suggestedDirs.slice(0, 5).map((dir, i) => (
            <text key={dir} fg={THEME.subtext}>
              {`  [${i + 1}] ${dir}`}
            </text>
          ))}
        </box>
      ) : null}

      <box flexDirection="row" gap={1}>
        <text fg={THEME.subtext}>Ruta actual:</text>
        {editingPath ? (
          <text fg={THEME.yellow}>
            <b>{pathInput + "█"}</b>
          </text>
        ) : (
          <text fg={THEME.cyan}>
            <b>{currentPath}</b>
          </text>
        )}
      </box>

      {error ? <text fg={THEME.red}>{`Error: ${error}`}</text> : null}

      <box
        flexDirection="column"
        border
        borderColor={THEME.border}
        padding={1}
        flexGrow={1}
        backgroundColor={THEME.bg}
      >
        {loading ? (
          <text fg={THEME.muted}>Cargando directorio...</text>
        ) : entries.length === 0 ? (
          <text fg={THEME.muted}>(Carpeta vacía o sin archivos de configuración)</text>
        ) : (
          visibleEntries.map((entry, idx) => {
            const actual = baseIdx + idx;
            const selected = actual === cursor;
            return (
              <box
                key={entry.path}
                backgroundColor={selected ? THEME.selectedBg : THEME.bg}
                paddingX={1}
              >
                <text fg={entry.isDir ? THEME.accent : THEME.subtext}>
                  {selected ? "▸ " : "  "}
                  {entry.isDir ? `📁 ${entry.name}/` : `📄 ${entry.name}`}
                </text>
              </box>
            );
          })
        )}
      </box>

      <text fg={THEME.subtext}>
        <span fg={THEME.accent}>[↑/↓]</span> Mover{"  "}
        <span fg={THEME.accent}>[Enter]</span> Abrir carpeta{"  "}
        <span fg={THEME.green}>[s / Espacio]</span> Seleccionar esta carpeta{"  "}
        <span fg={THEME.yellow}>[g]</span> Escribir ruta{"  "}
        <span fg={THEME.muted}>[Esc]</span> Volver
      </text>
    </box>
  );
}
