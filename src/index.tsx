#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./tui/App.tsx";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log(`tacl — TUI interactiva para administrar ACLs de Headscale

Uso:
  bun run src/index.tsx [opciones]

Opciones:
  --demo      Inicia en modo demostración con dispositivos y reglas simuladas (no toca Headscale)
  --rescan    Fuerza el asistente de autodescubrimiento SSH y reconfiguración del servidor
  -h, --help  Muestra esta ayuda

Atajos dentro de la TUI:
  ← / →, Tab, 1-4   Cambiar entre pestañas (Dispositivos, Perfiles, Usuarios, Conexiones Directas)
  Enter             Desplegar/colapsar destinos de un origen agrupado (o inspeccionar en Conexiones Directas)
  g / z             Deshacer/activar agrupación por origen (g) · Expandir/colapsar todos (z)
  Espacio           Asistente paso a paso: Origen → Destino → Dirección, Protocolo y checklist de puertos
  a                 Ver todos los elementos de la pestaña actual (excepto Conexiones Directas)
  l                 Ligar entidades del mismo nivel
  u                 Editar dirección (↔ / → / ← / ✕) y protocolo (TCP / UDP / Ambos)
  p                 Gestionar puertos (a añadir, e modificar, x eliminar)
  f                 Crear perfil y asignar dispositivos
  Ctrl+X (^X)       Eliminar reglas, ligamientos o perfiles (con lista y confirmación)
  /                 Filtrar tabla actual
  s                 Ver Diff HuJSON y aplicar política a Headscale
  q                 Salir`);
  process.exit(0);
}

const demoMode = args.has("--demo");
const forceRescan = args.has("--rescan");

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
});

createRoot(renderer).render(
  <App demoMode={demoMode} forceRescan={forceRescan} />
);
