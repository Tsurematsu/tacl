# Hoja de Ruta y Mejoras Futuras — `tacl`

Ideas y mejoras planificadas para futuras versiones de **`tacl`**, organizadas por impacto y área.

---

## 1. Prioridad Alta (Seguridad y Administración Diaria)

- [ ] **Rollback visual de políticas desde la TUI**
  - Listar los respaldos automáticos `acl.hujson.bak-*` del servidor (con fecha y tamaño).
  - Previsualizar el diff entre la política actual y cualquier backup anterior.
  - Restaurar y recargar Headscale en un solo paso.

- [ ] **Soporte para múltiples servidores / entornos Headscale**
  - Guardar una lista de servidores configurados en `~/.config/tacl/config.json` (ej. `oracle-prod`, `homelab`, `staging`).
  - Selector rápido desde la TUI (ej. `Ctrl+S` o `Shift+R`) para cambiar de instancia sin re-escanear desde cero.

- [ ] **Validación previa con `headscale` (Dry-Run)**
  - Antes de sobrescribir el ACL en modo `file`, validar la sintaxis HuJSON generada y comprobar si Headscale reporta errores en los logs (`journalctl -u headscale -n 20` o `docker logs --tail 20`) justo después de recargar, ofreciendo rollback automático si detecta fallo.

- [ ] **Edición rápida de alias/etiquetas y vista de estado de dispositivos**
  - En el panel `a` (Todos los dispositivos), mostrar última conexión (`last_seen`), versión de cliente, tags de Headscale y si anuncian rutas/exit nodes.

---

## 2. Prioridad Media (Red Avanzada de Headscale)

- [ ] **Gestión visual de Exit Nodes y Subnet Routers (`autoApprovers`)**
  - Pestaña o modal dedicado para aprobar/revocar rutas anunciadas (`192.168.1.0/24`, etc.) y asignar permisos de uso de Exit Nodes (`autogroup:internet`) por dispositivo, perfil o usuario.

- [ ] **Gestión de Tailscale SSH (`ssh`)**
  - Editor visual para reglas del bloque `ssh` de Headscale (quién puede entrar por Tailscale SSH a qué dispositivos y con qué usuarios Linux).

- [ ] **Soporte para Tags de Headscale (`tagOwners` / `tag:*`)**
  - Permitir visualizar tags asignados a nodos y opcionalmente compilar reglas basadas en tags además de IPs en `hosts`.

- [ ] **Simulador / Inspector interactivo (`¿A puede conectar a B en puerto X?`)**
  - Modal rápido de diagnóstico donde eliges Dispositivo A, Dispositivo B, Protocolo y Puerto, y `tacl` explica paso a paso:
    1. Si son visibles en NetMap (`tailscale status`).
    2. Qué nivel ganó (`Dispositivo`, `Perfil`, `Usuario`, `🛡 Protección SSH` o `Default`).
    3. Qué línea exacta del HuJSON compilado lo permite o bloquea.

---

## 3. Prioridad Media-Baja (Experiencia TUI y Productividad)

- [ ] **Importación inteligente desde un ACL existente**
  - Al conectarse a un Headscale que ya tenía un `acl.hujson` complejo hecho a mano, ofrecer importar sus reglas existentes hacia el modelo de `tacl` (en lugar de empezar solo con passthrough/vacío).

- [ ] **Deshacer / Rehacer (`Ctrl+Z` / `Ctrl+Y`)**
  - Historial en memoria de cambios sobre reglas y perfiles durante la sesión antes de aplicar.

- [ ] **Sincronización y resolución de diferencias Local vs Remoto**
  - Si al abrir `tacl` detecta que el `tacl.yaml` remoto es más reciente que el local (por ejemplo, editaste desde otro portátil), mostrar un aviso amable permitiendo elegir: *mantener local (por defecto)*, *traer remoto* o *ver diff*.

- [ ] **Exportar / Importar plantillas de perfiles y reglas**
  - Exportar la configuración de `tacl.yaml` o compartir plantillas predefinidas (ej. *"Red hogar + IoT aislado"*, *"Oficina + Servidores"*).

- [ ] **Atajo de ayuda contextual (`?`)**
  - Modal compacto dentro de la TUI que resume todos los atajos disponibles en la pestaña actual.

---

## 4. Distribución y Empaquetado

- [ ] **Compilación adicional para Linux ARM64 y macOS**
  - Extender `scripts/build.ts` para generar `tacl-linux-arm64` (ideal para ejecutar directo en VMs ARM de Oracle Cloud o Raspberry Pi) y `tacl-darwin-arm64` / `tacl-darwin-x64`.

- [ ] **CI/CD con GitHub Actions (Releases automáticos)**
  - Pipeline que ejecute `bun run typecheck`, `bun test` y publique automáticamente los binarios de Linux y Windows en cada tag `v*.*.*` con checksums SHA256.

- [ ] **Modo no interactivo / CLI pura (para scripts)**
  - Subcomandos como `tacl compile`, `tacl diff`, `tacl apply --yes` y `tacl check <origen> <destino> <puerto>` para automatización o pipelines.
