# `tacl` — Guía Completa de Opciones, Procesos e Interfaz (TUI)

**`tacl`** es una herramienta CLI interactiva (**TUI**) construida en **TypeScript + Bun + OpenTUI (`@opentui/react`)** para administrar visualmente las reglas de acceso (**ACLs**) de **Headscale**, compilando un modelo jerárquico de alto nivel a políticas **HuJSON** válidas.

---

## 1. Requisitos e Instalación

### Requisitos
- **Bun** (`>= 1.3`, instalado en `~/.bun/bin/bun`)
- **OpenSSH** (`ssh`) con llaves configuradas para acceder al servidor donde corre Headscale
- **Tailscale CLI** (`tailscale`, opcional pero recomendado para descubrir peers y detectar el equipo local)

### Puesta en marcha
```bash
# Cargar Bun en el PATH (si recién fue instalado)
source ~/.bashrc

# Instalar dependencias
bun install
```

---

## 2. Comandos y Opciones CLI

| Comando | Descripción |
| :--- | :--- |
| `bun run start` | Inicia `tacl`. Si ya hay un servidor guardado y accesible, conecta directo; si no, abre el asistente inicial. |
| `bun run demo` | Inicia en **modo demostración** (`--demo`) con dispositivos, perfiles, usuarios y reglas simuladas. **No se conecta ni modifica ningún servidor.** |
| `bun run start -- --rescan` | Fuerza el asistente de autodescubrimiento SSH para elegir otro servidor o cambiar entre modo Nativo y Contenedor. |
| `bun run src/index.tsx --help` | Muestra la ayuda rápida con flags y atajos principales. |
| `bun run build` | Compila binarios autocontenidos para **Linux x64** (`dist/tacl-linux-x64`) y **Windows x64** (`dist/tacl-windows-x64.exe`). |
| `bun run build:linux` | Compila solo el binario autocontenido para **Linux x64** (`dist/tacl-linux-x64`). |
| `bun run build:windows` | Compila solo el binario autocontenido para **Windows x64** (`dist/tacl-windows-x64.exe`). |
| `bun test` | Ejecuta toda la suite de pruebas (motor de reglas, compilador HuJSON, parser SSH e integración TUI). |
| `bun run typecheck` | Verifica el tipado estricto con `tsc --noEmit`. |

### Archivos que gestiona `tacl`
| Archivo | Ubicación | Propósito |
| :--- | :--- | :--- |
| **Configuración local** | `~/.config/tacl/config.json` | Guarda el servidor seleccionado, modo (`native`/`container`), ejecutable/instalador, rutas y permisos de conexión. |
| **Estado local (prevalece)** | `~/.config/tacl/state/<host>-tacl.yaml` | Guarda automáticamente y al salir (`q`/`Ctrl+C`) tus perfiles, reglas (incluso sin aplicar), pestaña activa y estado pendiente. **Al abrir de nuevo, la copia local prevalece sobre la remota.** |
| **Estado remoto (servidor)** | `<carpeta-headscale>/tacl.yaml` | Copia sincronizada al salir y al aplicar en el servidor Headscale (usada como respaldo si abres desde otra máquina sin copia local). |
| **Respaldo local extra** | `~/.config/tacl/backups/<host>-tacl.yaml` | Copia de respaldo local adicional. |
| **Backup del ACL anterior** | `<ruta-acl>.bak-<timestamp>` | Copia de seguridad automática de tu política HuJSON anterior en el servidor antes de sobrescribirla. |

---

## 3. Procesos Internos Paso a Paso

### Paso 1: Selección de Servidor (Automático o Manual) (`SetupWizard`)
Al arrancar por primera vez (o con `--rescan`), `tacl` te pregunta primero cómo deseas conectar:

- **Opción A — Detección Automática (Recomendado):**
  1. **Recolección de candidatos:** reúne posibles máquinas desde `localhost`, entradas concretas de `~/.ssh/config` (respetando `Host`, `HostName`, `User`, `Port`, `IdentityFile`) y peers de `tailscale status --json` (con pista de `ControlURL`).
  2. **Validación estricta por llave SSH (en paralelo):** sondea con `ssh -o BatchMode=yes -o ConnectTimeout=3`. Nunca pide contraseña y solo muestra máquinas realmente accesibles por llave, priorizando las que tienen `★ Headscale detectado` (y desde esa lista también puedes pulsar `m` para pasar a ingreso manual).
- **Opción B — Selección Manual (Servidor y Usuario SSH):**
  1. Permite escribir manualmente el **Servidor** (o desplegar con **`Espacio` / `→`** la **lista desplegable de servidores disponibles** de `~/.ssh/config`, Tailscale y `localhost` con filtrado en vivo y autorrelleno de usuario/puerto/llave), el **Usuario SSH**, el **Puerto SSH** (opcional, defecto `22`) y la **Llave privada SSH** (opcional).
  2. Valida la conexión SSH en el momento y te avisa si hubo algún error para corregirlo sin salir.

3. **Selección de modo de instalación en la máquina elegida:**
   - **Instalación Nativa (binario / systemd):** busca internamente el ejecutable de `headscale` (en `PATH`, rutas estándar `/usr/bin`, `/usr/local/bin`, `/opt`, `systemd ExecStart` y búsqueda acotada), detecta la versión, el **instalador / gestor de paquetes** (`apt/dpkg`, `dnf`/`yum`/`rpm`, `pacman`, `apk`, `snap`, `brew`, `go` o binario/paquete `.deb`/`.rpm` local), la unidad `systemd`, `config.yaml`, la ruta del ACL y los **permisos reales de acceso al socket** (probando en orden: directo, `sudo -n` y `sudo -n -u headscale`), y **guarda toda esa información** en `~/.config/tacl/config.json`.
   - **Contenedor (Docker / Podman):** inspecciona contenedores con imagen/nombre `headscale` para sugerir sus volúmenes montados y abre el **Explorador de Carpetas Remoto** para que elijas la carpeta exacta del contenedor y sus políticas.
4. **Detección de identidad Tailscale remota:** consulta en el servidor su IP Tailscale (`tailscale ip -4`) y hostname real para poder proteger automáticamente el enlace SSH incluso si te conectas por IP pública.
5. **Inicialización amable (cuando aún no existe `tacl.yaml`):**
   - **Opción 1 — Mantener como viene por defecto (Recomendado):** deja las tablas vacías y no añade restricciones adicionales a Headscale hasta que ligues reglas.
   - **Opción 2 — Aislar automáticamente por Usuarios de Headscale:** genera reglas `Usuario ↔ Usuario` para que cada usuario vea sus propios dispositivos, bloqueando el cruce entre usuarios distintos (`Default-Deny`).
   - **Opción 3 — Modo estricto desde cero (`Default-Deny`):** empieza con tablas vacías bloqueando todo lo que no ligues explícitamente.

---

### Paso 2: Jerarquía de Precedencia y Conflictos
Cuando `tacl` calcula la conectividad efectiva entre cualquier par de dispositivos `(A, B)`, evalúa estrictamente en este orden (de mayor a menor peso):

1. **`Dispositivo` (Peso Absoluto):** una regla directa en la pestaña **Dispositivos** entre `A` y `B` siempre gana sobre cualquier perfil, usuario o política base.
2. **`Perfil` (Propio de `tacl`, no de Headscale):** agrupaciones creadas y mantenidas dentro de `tacl` (tecla `f`).
   - Un dispositivo puede pertenecer a **múltiples perfiles a la vez**.
   - **Detección interactiva de conflictos:** si un par `(A, B)` cae bajo dos o más reglas de perfil con efectos distintos (por ejemplo, un perfil permite y otro bloquea, o usan protocolos/puertos diferentes), `tacl` abre automáticamente el **Modal de Conflictos** para preguntarte **qué regla prevalece** y guarda tu decisión.
3. **`Usuario` (Usuarios reales de Headscale):** reglas entre usuarios de Headscale (incluyendo reglas intra-usuario `Usuario ↔ Usuario`).
4. **`Default` (Política base, alternable con `m`):**
   - `Sin restricción extra` (`passthrough`): las parejas sin regla explícita conservan acceso; si no existe ninguna regla creada todavía, la política original de Headscale se preserva intacta.
   - `Default-Deny` (`deny`): cualquier pareja sin regla explícita queda bloqueada e invisible entre sí.

---

### Paso 3: Protección Automática de la Conexión SSH (`🛡`)
Para evitar que puedas quedarte sin acceso SSH desde tu equipo local hacia el servidor donde configuras Headscale, la protección opera en **3 capas**:

1. **Identificación exacta del par:** cruza tu dispositivo local (`tailscale status --json`) con el servidor destino (por IP Tailscale, IP SSH o hostname remoto).
2. **Guardrails en la interfaz:**
   - La barra superior muestra **`🛡 SSH:<puerto> (tu-equipo→servidor)`** y las filas involucradas llevan el escudo **`🛡`**.
   - Si intentas bloquear el par protegido o retirar `TCP/<puerto SSH>` desde `u`, `p`, `l` o `Espacio`, `tacl` rechaza el bloqueo con un aviso claro.
3. **Inyección garantizada en el compilador:**
   - Incluso si el bloqueo proviene de `Default-Deny`, un Perfil o un Usuario, el compilador **siempre garantiza** una regla `accept` de `TCP/<puerto SSH>` desde tu dispositivo local hacia el servidor destino y lo indica explícitamente en el diff antes de aplicar.

---

### Paso 4: Compilación a HuJSON y Aplicación Segura (`s`)
Como Headscale solo soporta reglas `accept` (no existe `deny` nativo):
1. `tacl` toma la matriz final resuelta de **Conexiones Directas**.
2. Convierte cada dirección permitida en flujos `accept`:
   - `↔ Bidireccional`: genera flujos `A → B` y `B → A`.
   - `→` / `←` Unidireccional: genera solo el sentido indicado.
   - `✕ Bloqueado`: **no genera ninguna regla `accept`**, haciendo que ambos nodos sean **100% invisibles entre sí** en el NetMap (`tailscale status`).
   - Protocolo `TCP` / `UDP`: emite `"proto": "tcp"` o `"proto": "udp"`.
   - Protocolo `Ambos`: si el puerto es `*`, omite `proto` (permite TCP, UDP e ICMP/ping); si hay puertos específicos, emite reglas limpias para `tcp` y `udp`.
3. Compacta y agrupa reglas equivalentes para mantener el HuJSON legible.
4. **Preserva intactas** secciones externas de tu política original (`autoApprovers`, `ssh`, `tagOwners`, `groups` externos, etc.).
5. Muestra el **Diff línea por línea**, crea un **backup** automático en el servidor, guarda `tacl.yaml` (con fallback automático a `sudo` o a `~/.config/tacl/tacl.yaml` remoto si `/etc/headscale/` no es escribible) y aplica/recarga Headscale:
   - Modo `file`: escribe el archivo ACL (escalando automáticamente a `sudo` y solicitando contraseña solo si el servidor la exige) y recarga mediante `SIGHUP` (`systemctl reload headscale` o `docker/podman kill -s HUP`).
   - Modo `database`: ejecuta `headscale policy set -f ...`.

---

## 4. Explicación Completa de la Interfaz (UI)

```text
┌─ tacl · oracle (contenedor: /opt/headscale)  🛡 SSH:22 (portatil→oracle)  Base: Default-Deny [m]  ● Sincronizado ─┐
│ [1] Dispositivos (2)   [2] Perfiles (1)   [3] Usuarios (1)   [4] Conexiones Directas (15) · Solo lectura         │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│   Origen                 Dir     Destino                Proto     Puertos                                        │
│ ──────────────────────────────────────────────────────────────────────────────────────────────────────────────── │
│ ▸ tv-sala                 ✕      portatil               Ambos     *                                              │
│   portatil                ↔      nas-casa               Ambos     *                                              │
│                                                                                                                  │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [←/→] Tabs  [Enter] Desplegar  [g] Desagrupar  [Espacio] Conectar  [a] Todos  [l] Ligar  [u] Dir/Proto  [p] ... │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Barra Superior
- **Izquierda:** nombre del servidor conectado y modo (`nativo` o `contenedor: <ruta>`).
- **Derecha:**
  - `🛡 SSH:<puerto> (origen→destino)`: confirma que tu enlace SSH de administración está protegido.
  - `Base: Default-Deny [m]` o `Base: Sin restricción extra [m]`: modo por defecto para parejas sin regla.
  - `● Sincronizado` (verde) o `● Cambios sin aplicar` (amarillo).

### Las 4 Pestañas Horizontales
Navegables con **`←` / `→`**, **`Tab` / `Shift+Tab`** o teclas **`1`–`4`**:

| Pestaña | Prioridad | Qué muestra | Edición |
| :--- | :---: | :--- | :--- |
| **`[1] Dispositivos`** | **1 (Absoluta)** | Reglas directas `Dispositivo ↔ Dispositivo`. | Completa |
| **`[2] Perfiles`** | **2** | Barra resumen con perfiles creados + tabla de reglas `Perfil ↔ Perfil` (soporta `Perfil ↔ mismo Perfil` para control interno). | Completa |
| **`[3] Usuarios`** | **3** | Reglas `Usuario ↔ Usuario` de Headscale (soporta `Usuario ↔ mismo Usuario`). | Completa |
| **`[4] Conexiones Directas`** | **Final** | Matriz resuelta con el **estado efectivo final** de todos los pares de dispositivos + columna **`Regla activa`** (`Dispositivo`, `Perfil`, `Usuario`, `🛡 Protección SSH`, `Default` o `⚠ Conflicto`). | **Solo lectura** (ediciones bloqueadas) |

### Agrupación por Origen y Lista Desplegable de Destinos
Por defecto, las 4 pestañas **agrupan automáticamente las reglas que comparten el mismo `Origen`**:
- Si un origen tiene **1 solo destino**, se muestra en una sola línea limpia para editarlo directamente.
- Si un origen tiene **2 o más destinos**, aparece como una fila desplegable **`▸ origen (N)   ▸   N destinos (...)`**:
  - Pulsa **`Enter`** sobre la fila de grupo para **desplegar o colapsar** la lista de destinos (`├─`, `└─`) y navegar con `↑`/`↓` a cada destino individual.
  - Pulsa **`z`** para desplegar/colapsar todos los grupos de la pestaña actual de una vez.
  - Pulsa **`g`** para alternar entre la vista **agrupada por origen** (por defecto) y la vista **plana**.

### Columnas y Símbolos de la Tabla
- **`Origen` / `Destino`**: entidades de la regla (con escudo `🛡` si es el par SSH protegido).
- **`Dir` (Dirección)**:
  - **`↔`** *(verde)*: Bidireccional — ambos se ven y pueden iniciar conexiones.
  - **`→`** *(cian)*: Unidireccional — solo Origen inicia conexiones hacia Destino.
  - **`←`** *(cian)*: Unidireccional inverso — solo Destino inicia conexiones hacia Origen.
  - **`✕`** *(rojo)*: Bloqueado (`DENY`) — bloquea el acceso y oculta los dispositivos entre sí.
- **`Proto` (Protocolo)**:
  - **`TCP`** *(azul)* · **`UDP`** *(amarillo)* · **`Ambos`** *(lila)*.
- **`Puertos`**: `*` (todos) o lista de puertos/rangos (`22, 443, 8000-8080`).
- **`Regla activa`** *(solo en `Conexiones Directas`)*: indica exactamente qué nivel decidió esa conexión.

---

## 5. Todos los Atajos y Modales de la UI

### Navegación General
| Atajo | Acción |
| :---: | :--- |
| **`←` / `→`** · **`Tab`** · **`1`-`4`** | Cambiar entre las 4 pestañas horizontales. |
| **`↑` / `↓`** · **`k` / `j`** | Moverse por las filas de la tabla. |
| **`Enter`** | Desplegar/colapsar los destinos de un origen agrupado (y sobre un destino en `Conexiones Directas`, abrir el Inspector). |
| **`z`** | Desplegar o colapsar **todos** los grupos de origen de la pestaña actual. |
| **`g`** | Alternar entre vista **agrupada por origen** (por defecto) y vista **plana**. |
| **`/`** | Activar filtro en vivo por nombre de dispositivo, perfil, usuario o regla (`Enter` fija el filtro, `Esc` lo limpia). |
| **`m`** | Alternar política base entre `Default-Deny` y `Sin restricción extra`. |
| **`r`** | Refrescar dispositivos y usuarios desde Headscale. |
| **`Shift + R`** | Volver al asistente inicial para cambiar de servidor o modo (solo modo real). |
| **`c`** | Abrir el resolvedor de conflictos de perfiles (cuando existan conflictos pendientes). |
| **`s`** | Abrir la vista **Diff HuJSON y Aplicar** a Headscale. |
| **`q`** / **`Ctrl+C`** | Guarda las selecciones, perfiles, reglas (incluso sin aplicar) y pestaña activa tanto en local como en la máquina remota (prevaleciendo la copia local al volver a abrir) y sale de `tacl`. |

---

### Modales Interactivos (Pestañas 1, 2 y 3)

#### 1. **`Espacio`** — Asistente Guiado de Conexión (3 pasos)
*Disponible en `Dispositivos`, `Perfiles` y `Usuarios` (bloqueado en `Conexiones Directas`).*
- **Paso 1 (`Origen`):** muestra todos los ítems de la pestaña actual. Eliges con `↑`/`↓` y pulsas `Enter`.
- **Paso 2 (`Destino`):** cambia el título a `Destino` mostrando el origen seleccionado arriba. Eliges con `↑`/`↓` y pulsas `Enter` (`Esc` vuelve a `Origen`).
- **Paso 3 (`Configurar Regla`):**
  1. **Dirección** (`←`/`→`): `↔ Bidireccional` · `→ Izq a Der` · `← Der a Izq` · `✕ Bloqueado`.
  2. **Protocolo** (`←`/`→`): `TCP` · `UDP` · `Ambos`.
  3. **Puertos y rangos conocidos (checklist):** marca/desmarca con **`Espacio`** entre `*`, `22 (SSH)`, `53 (DNS)`, `80 (HTTP)`, `443 (HTTPS)`, `3389 (RDP)`, `5432 (PostgreSQL)`, `3306 (MySQL)`, `6379 (Redis)`, `8000-8080` y `3000-3100`.
     - Pulsa **`a`** para **añadir un puerto o rango personalizado** (ej. `9000` o `5000-5100`), validado y marcado automáticamente.
  - **`↑`/`↓` o `Tab`** para moverse entre secciones · **`Enter`** guarda la regla · **`Esc`** retrocede al paso anterior.

#### 2. **`a`** — Panel de Todos los Ítems
*Disponible en `Dispositivos`, `Perfiles` y `Usuarios` (**excluido** en `Conexiones Directas`).*
- En **`Dispositivos`**: lista todos los dispositivos con estado `●`/`○`, IP Tailscale, usuario y perfiles asignados.
- En **`Perfiles`**: lista todos los perfiles con cantidad y nombres de sus dispositivos miembros.
  - Pulsa **`e`** o **`Enter`** sobre un perfil para abrir su editor; al pulsar **`Esc`** dentro del editor, **vuelves automáticamente al panel de perfiles** en la misma posición.
- En **`Usuarios`**: lista todos los usuarios de Headscale y sus dispositivos.
- Pulsa **`a`** o **`Esc`** para cerrar el panel.

#### 3. **`l`** — Ligar Entidades del Mismo Nivel
*Disponible en `Dispositivos`, `Perfiles` y `Usuarios`.*
- Permite crear un enlace directo en vista de dos columnas (Origen y Destino) restringido estrictamente al mismo tipo: `Dispositivo ↔ Dispositivo`, `Perfil ↔ Perfil` o `Usuario ↔ Usuario`, eligiendo dirección y protocolo inicial.

#### 4. **`u`** — Editar Dirección y Protocolo
*Disponible sobre una regla seleccionada en pestañas 1–3.*
- **Desplazador 1 (`←`/`→`):** Dirección (`↔`, `→`, `←`, `✕`) con vista previa en vivo.
- **Desplazador 2 (`←`/`→`):** Protocolo (`TCP`, `UDP`, `Ambos`).
- `↑`/`↓` o `Tab` cambia de fila · `Enter` guarda · `Esc` cancela.

#### 5. **`p`** — Gestionar Puertos de la Regla
*Disponible sobre una regla seleccionada en pestañas 1–3.*
- Muestra la lista de puertos permitidos en la regla seleccionada.
- Atajos internos:
  - **`a`**: añadir puerto (`22`, `443`, `*`) o rango (`8000-8080`).
  - **`e`**: modificar el puerto seleccionado.
  - **`x`**: eliminar el puerto seleccionado (si queda vacía vuelve a `*`).
  - **`Enter`**: guardar lista · **`Esc`**: cancelar.

#### 6. **`f`** — Crear / Editar Perfil
*Disponible en pestañas 1–3.*
- Campo de **Nombre del perfil** + **Filtro por usuario (`←`/`→`)** (`Todos` o cualquier usuario de Headscale, manteniendo marcados los dispositivos elegidos entre filtros) + lista de **dispositivos con checkboxes** (`Espacio` para marcar/desmarcar; muestra también en qué otros perfiles ya participa cada dispositivo).
- **`a`**: selecciona o deselecciona **todos los dispositivos del filtro aplicado** (sin afectar dispositivos seleccionados de otros usuarios).
- **`o`**: **oculta o muestra los dispositivos que ya pertenecen a otro perfil** (ideal para asignar rápidamente solo los dispositivos que aún no tienen perfil).
- `Tab` alterna entre nombre y lista · `←`/`→` filtra dispositivos por usuario · `o` ocultar/mostrar ya asignados · `a` todos/ninguno del filtro · `Enter` guarda · `Esc` cancela (o vuelve al panel de perfiles si entraste desde `a`).

#### 7. **`^X` (`Ctrl+X`)** — Eliminación Segura (2 pasos)
*Disponible en pestañas 1–3 (bloqueado en `Conexiones Directas`).*
- **Paso 1 (Selección):** lista todas las reglas/ligamientos de la pestaña actual (y en `Perfiles` también permite eliminar perfiles completos; si hay resoluciones de conflicto guardadas, permite limpiarlas). Puedes elegir uno o marcar varios con **`Espacio`**.
- **Paso 2 (Confirmación):** pregunta *"¿Estás seguro?"*, muestra el listado exacto a borrar e indica impactos en cascada (por ejemplo, reglas ligadas a un perfil eliminado). Confirmas con `Enter` / `y` / `s` o vuelves con `Esc` / `n`.

#### 8. Modal de Conflictos Multi-Perfil *(automático o tecla `c`)*
- Aparece cuando un par de dispositivos pertenece a múltiples perfiles con reglas en contradicción.
- Muestra cada regla competidora y su efecto exacto para que elijas con `↑`/`↓` + `Enter` cuál prevalece.

#### 9. **`Enter`** en `Conexiones Directas` — Inspector de Estado Final
- Al ser una pestaña de **solo lectura**, todas las teclas de edición (`Espacio`, `u`, `p`, `l`, `f`, `^X`) están bloqueadas y `a` está excluido.
- Pulsar **`Enter`** sobre cualquier fila abre el **Inspector**, que explica el estado final, visibilidad en NetMap, qué nivel decidió la regla y si la protección SSH (`🛡`) está activa.

#### 10. **`s`** — Vista Diff HuJSON y Aplicar
- Compila la política final, muestra estadísticas (`Hosts`, `ACLs`, `Permitidos`, `Bloqueados`), avisos de protección SSH y el **diff línea por línea** (`+` verde / `-` rojo) con scroll `↑`/`↓`.
- Si hay conflictos sin resolver, te redirige con `c` / `Enter` a resolverlos antes de aplicar.
- Pulsar **`Enter`** guarda `tacl.yaml`, genera backup del ACL previo y aplica/recarga Headscale (en `--demo` solo simula la aplicación).

#### 11. Explorador de Carpetas Remoto *(modo Contenedor en el asistente)*
- Lista automáticamente carpetas sugeridas a partir de los volúmenes de contenedores `headscale` (salto rápido con teclas `1`–`9`).
- **`↑`/`↓`** navegar · **`Enter`** entrar en una carpeta (`..` subir) · **`g`** escribir ruta manual · **`s` / `Espacio`** seleccionar carpeta actual · **`Esc`** volver.

#### 12. Modal de Contraseña `sudo` (`🔐`) *(automático cuando una acción requiere elevación)*
- Se abre automáticamente solo si `sudo -n` exige contraseña al leer nodos/usuarios, escribir `/etc/headscale/acl.hujson`, recargar `headscale` o refrescar (`r`).
- Entrada enmascarada (`••••••`), guardada únicamente en memoria RAM durante la sesión (nunca en disco).
- **`Enter`**: guarda en memoria y reintenta automáticamente la operación pendiente (si la contraseña fuera incorrecta, la descarta y permite volver a ingresarla) · **`Esc`**: cancelar.

---

## 6. Guardado, Sincronización y Solución de Problemas

### Cómo funciona el guardado Local vs Remoto
- Mientras trabajas, `tacl` guarda automáticamente una copia local en `~/.config/tacl/state/<host>-tacl.yaml` (incluyendo perfiles, reglas pendientes sin aplicar, política base y pestaña activa).
- Al salir con **`q`** o **`Ctrl+C`**, sincroniza ese estado tanto en la máquina **local** como en el servidor **remoto** (`<carpeta-headscale>/tacl.yaml`).
- Al volver a abrir `tacl`, **siempre prevalece el estado local** sobre el remoto (si abres desde un equipo nuevo sin copia local, carga automáticamente la copia del servidor).

### Permisos del socket de Headscale y Contraseña `sudo` bajo demanda
Si el servidor nativo requiere privilegios elevados para acceder al socket Unix de Headscale (`/var/run/headscale/headscale.sock`), escribir `/etc/headscale/acl.hujson` o recargar el servicio:
- `tacl` prueba primero acceso directo y luego `sudo -n` (sin contraseña) y `sudo -n -u headscale`.
- Si `sudo` exige contraseña en el servidor, `tacl` abre automáticamente un **modal seguro de contraseña `sudo` (`🔐`)**:
  - La contraseña se escribe oculta (`••••••`), **solo se conserva en memoria RAM durante la sesión actual (nunca en disco)** y reintenta automáticamente la acción solicitada (listar nodos, aplicar ACL, recargar Headscale o refrescar).
  - La escritura de archivos con `sudo` prepara primero un archivo temporal en `/tmp` para no mezclar nunca la contraseña con el contenido de la política.
- Opcionalmente, si prefieres evitar introducir contraseña para consultar el socket, puedes añadir tu usuario al grupo `headscale` una sola vez en el servidor:
  ```bash
  sudo usermod -aG headscale $USER
  ```
  y luego reconectar con `bun run start`.

