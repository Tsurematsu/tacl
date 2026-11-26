import type { Direction, Protocol } from "../types/model.ts";

export const THEME = {
  bg: "#11111b",
  surface: "#181825",
  surfaceAlt: "#1e1e2e",
  surfaceHover: "#2a2b3d",
  selectedBg: "#313244",
  modalBg: "#181825",
  border: "#45475a",
  borderActive: "#89b4fa",
  borderWarn: "#f9e2af",
  borderDanger: "#f38ba8",
  text: "#cdd6f4",
  subtext: "#a6adc8",
  muted: "#6c7086",
  accent: "#89b4fa",
  cyan: "#89dceb",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  peach: "#fab387",
  red: "#f38ba8",
  mauve: "#cba6f7",
  teal: "#94e2d5",
} as const;

export function directionColor(dir: Direction): string {
  switch (dir) {
    case "both":
      return THEME.green;
    case "a_to_b":
    case "b_to_a":
      return THEME.cyan;
    case "deny":
      return THEME.red;
  }
}

export function directionLabel(dir: Direction): string {
  switch (dir) {
    case "both":
      return "↔ Bidireccional";
    case "a_to_b":
      return "→ Izq a Der";
    case "b_to_a":
      return "← Der a Izq";
    case "deny":
      return "✕ Bloqueado";
  }
}

export function protocolColor(proto: Protocol): string {
  switch (proto) {
    case "tcp":
      return THEME.accent;
    case "udp":
      return THEME.yellow;
    case "both":
      return THEME.mauve;
  }
}

export function padCell(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length > width) {
    return width > 1 ? text.slice(0, width - 1) + "…" : text.slice(0, width);
  }
  return text + " ".repeat(width - text.length);
}
