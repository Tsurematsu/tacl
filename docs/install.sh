#!/usr/bin/env sh
set -eu

REPO="k3stool/tacl"
BIN_NAME="tacl"
REQUESTED_VERSION="${TACL_VERSION:-latest}"
FORCE_INSTALL="${TACL_FORCE:-0}"

# Colores (solo si stdout es una terminal)
if [ -t 1 ]; then
  C_RESET="\033[0m"
  C_BOLD="\033[1m"
  C_CYAN="\033[36m"
  C_GREEN="\033[32m"
  C_YELLOW="\033[33m"
  C_RED="\033[31m"
else
  C_RESET=""
  C_BOLD=""
  C_CYAN=""
  C_GREEN=""
  C_YELLOW=""
  C_RED=""
fi

info()  { printf "%b==>%b %s\n" "$C_CYAN$C_BOLD" "$C_RESET" "$1"; }
ok()    { printf "%b✓%b %s\n" "$C_GREEN$C_BOLD" "$C_RESET" "$1"; }
warn()  { printf "%b!%b %s\n" "$C_YELLOW$C_BOLD" "$C_RESET" "$1"; }
error() { printf "%bError:%b %s\n" "$C_RED$C_BOLD" "$C_RESET" "$1" >&2; exit 1; }

# 1. Detectar sistema operativo y arquitectura
OS="$(uname -s 2>/dev/null || echo unknown)"
ARCH="$(uname -m 2>/dev/null || echo unknown)"

case "$OS" in
  Linux) ;;
  MINGW*|MSYS*|CYGWIN*)
    error "En Windows descarga el ejecutable directamente desde: https://github.com/${REPO}/releases/latest/download/tacl-windows-x64.exe"
    ;;
  *)
    error "Sistema operativo no soportado para binario precompilado: ${OS}. Puedes ejecutar tacl desde código fuente con Bun (https://github.com/${REPO})."
    ;;
esac

case "$ARCH" in
  x86_64|amd64)
    ASSET="tacl-linux-x64"
    ;;
  *)
    error "Arquitectura no soportada para binario precompilado: ${ARCH} (se requiere x86_64). Puedes compilarlo con Bun desde https://github.com/${REPO}."
    ;;
esac

# Verificar herramienta HTTP disponible
if command -v curl >/dev/null 2>&1; then
  HTTP_TOOL="curl"
elif command -v wget >/dev/null 2>&1; then
  HTTP_TOOL="wget"
else
  error "Se requiere 'curl' o 'wget' para descargar ${BIN_NAME}."
fi

# 2. Resolver la última versión real desde GitHub Releases
resolve_latest_tag() {
  TAG=""
  if [ "$HTTP_TOOL" = "curl" ]; then
    # Primero intentar redirección directa (no consume cuota de la API de GitHub)
    EFFECTIVE_URL="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest" 2>/dev/null || true)"
    case "$EFFECTIVE_URL" in
      */releases/tag/*)
        TAG="${EFFECTIVE_URL##*/releases/tag/}"
        ;;
    esac
    # Respaldo con API de GitHub
    if [ -z "$TAG" ]; then
      TAG="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
        | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 || true)"
    fi
  else
    TAG="$(wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
      | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 || true)"
  fi
  printf "%s" "$TAG"
}

if [ "$REQUESTED_VERSION" = "latest" ]; then
  info "Consultando la última versión de ${BIN_NAME} en GitHub..."
  TARGET_TAG="$(resolve_latest_tag)"
  if [ -n "$TARGET_TAG" ]; then
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TARGET_TAG}/${ASSET}"
  else
    TARGET_TAG="latest"
    DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
  fi
else
  case "$REQUESTED_VERSION" in
    v*) TARGET_TAG="$REQUESTED_VERSION" ;;
    *)  TARGET_TAG="v${REQUESTED_VERSION}" ;;
  esac
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TARGET_TAG}/${ASSET}"
fi

# 3. Detectar instalación previa y elegir directorio de instalación
EXISTING_BIN="$(command -v "$BIN_NAME" 2>/dev/null || true)"

if [ -n "${TACL_INSTALL_DIR:-}" ]; then
  INSTALL_DIR="$TACL_INSTALL_DIR"
elif [ -n "$EXISTING_BIN" ] && [ -w "$(dirname "$EXISTING_BIN")" ]; then
  # Actualizar en la misma ruta donde ya está instalado tacl para evitar duplicados en PATH
  INSTALL_DIR="$(dirname "$EXISTING_BIN")"
elif [ -w "/usr/local/bin" ]; then
  INSTALL_DIR="/usr/local/bin"
else
  INSTALL_DIR="${HOME}/.local/bin"
fi

mkdir -p "$INSTALL_DIR" || error "No se pudo crear el directorio de instalación: ${INSTALL_DIR}"

if [ ! -w "$INSTALL_DIR" ]; then
  error "Sin permisos de escritura en ${INSTALL_DIR}. Ejecuta con sudo o define TACL_INSTALL_DIR=\"\$HOME/.local/bin\"."
fi

TARGET="${INSTALL_DIR}/${BIN_NAME}"

# 4. Comprobar versión ya instalada (soporte de actualización inteligente)
IS_UPDATE=0
INSTALLED_VERSION=""
if [ -x "$TARGET" ]; then
  IS_UPDATE=1
  VER_RAW="$("$TARGET" --version 2>/dev/null | head -n 1 || true)"
  case "$VER_RAW" in
    *"v"[0-9]*)
      INSTALLED_VERSION="$(printf "%s" "$VER_RAW" | sed -n 's/.*\(v[0-9][0-9A-Za-z._-]*\).*/\1/p' | head -n 1)"
      ;;
  esac
fi

if [ "$IS_UPDATE" = "1" ] && [ -n "$INSTALLED_VERSION" ] && [ "$TARGET_TAG" != "latest" ]; then
  if [ "$INSTALLED_VERSION" = "$TARGET_TAG" ] && [ "$FORCE_INSTALL" != "1" ]; then
    ok "${BIN_NAME} ya está actualizado en la última versión (${INSTALLED_VERSION}) en ${TARGET}."
    printf "    Usa %bTACL_FORCE=1%b si deseas reinstalar de todos modos.\n" "$C_BOLD" "$C_RESET"
    exit 0
  fi
fi

# 5. Descargar binario a archivo temporal (en el mismo directorio si es posible para reemplazo atómico)
TMP_FILE="$(mktemp "${INSTALL_DIR}/.${BIN_NAME}.tmp.XXXXXX" 2>/dev/null || mktemp "${TMPDIR:-/tmp}/tacl-install.XXXXXX")"
cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT INT TERM

if [ "$IS_UPDATE" = "1" ]; then
  if [ -n "$INSTALLED_VERSION" ]; then
    info "Actualizando ${BIN_NAME} (${INSTALLED_VERSION} -> ${TARGET_TAG}) en ${TARGET}..."
  else
    info "Actualizando ${BIN_NAME} (versión anterior -> ${TARGET_TAG}) en ${TARGET}..."
  fi
else
  info "Descargando ${BIN_NAME} (${TARGET_TAG}) para Linux x86_64..."
fi

if [ "$HTTP_TOOL" = "curl" ]; then
  curl -fL --progress-bar "$DOWNLOAD_URL" -o "$TMP_FILE" || error "Fallo al descargar desde ${DOWNLOAD_URL}"
else
  wget -q --show-progress "$DOWNLOAD_URL" -O "$TMP_FILE" || error "Fallo al descargar desde ${DOWNLOAD_URL}"
fi

if [ ! -s "$TMP_FILE" ]; then
  error "El archivo descargado está vacío."
fi

# 6. Instalar / reemplazar el binario de forma atómica
chmod 755 "$TMP_FILE"
mv -f "$TMP_FILE" "$TARGET"

if [ "$IS_UPDATE" = "1" ]; then
  ok "${BIN_NAME} actualizado correctamente a ${TARGET_TAG} en ${TARGET}"
else
  ok "${BIN_NAME} instalado correctamente (${TARGET_TAG}) en ${TARGET}"
fi

# 7. Verificar PATH y posibles binarios duplicados
in_path() {
  case ":${PATH:-}:" in
    *":$1:"*) return 0 ;;
    *)        return 1 ;;
  esac
}

if ! in_path "$INSTALL_DIR"; then
  warn "${INSTALL_DIR} no está en tu PATH actual."
  EXPORT_LINE="export PATH=\"${INSTALL_DIR}:\$PATH\""
  UPDATED_RC=""

  for rc in "${HOME}/.bashrc" "${HOME}/.zshrc" "${HOME}/.profile"; do
    if [ -f "$rc" ]; then
      if ! grep -F "$INSTALL_DIR" "$rc" >/dev/null 2>&1; then
        printf "\n# Añadido por el instalador de tacl\n%s\n" "$EXPORT_LINE" >> "$rc"
        UPDATED_RC="$rc"
      fi
    fi
  done

  if [ -n "$UPDATED_RC" ]; then
    ok "Se añadió ${INSTALL_DIR} al PATH en tu perfil de shell."
    printf "    Ejecuta ahora: %bexport PATH=\"%s:\$PATH\"%b (o abre una nueva terminal)\n" "$C_BOLD" "$INSTALL_DIR" "$C_RESET"
  else
    printf "    Añade esta línea a tu perfil de shell:\n"
    printf "    %b%s%b\n" "$C_BOLD" "$EXPORT_LINE" "$C_RESET"
  fi
else
  ACTIVE_BIN="$(command -v "$BIN_NAME" 2>/dev/null || true)"
  if [ -n "$ACTIVE_BIN" ] && [ "$ACTIVE_BIN" != "$TARGET" ]; then
    warn "Tu PATH resuelve '${BIN_NAME}' a ${ACTIVE_BIN} antes que ${TARGET}. Elimina la copia antigua si notas una versión desactualizada."
  fi
fi

# 8. Verificación rápida
NEW_VER="$("$TARGET" --version 2>/dev/null | head -n 1 || true)"
if [ -n "$NEW_VER" ]; then
  ok "Verificación superada: ${NEW_VER} listo para usarse."
elif "$TARGET" --help >/dev/null 2>&1; then
  ok "Verificación superada: '${BIN_NAME}' está listo para usarse."
else
  warn "El binario se instaló en ${TARGET}, pero falló la verificación rápida."
fi

printf "\n%bInicio rápido:%b\n" "$C_BOLD" "$C_RESET"
printf "  %btacl%b           Iniciar asistente o conectar al servidor guardado\n" "$C_CYAN" "$C_RESET"
printf "  %btacl --demo%b    Explorar la interfaz en modo demostración sin tocar Headscale\n" "$C_CYAN" "$C_RESET"
printf "  %btacl --rescan%b  Reconfigurar servidor o cambiar entre Nativo y Contenedor\n" "$C_CYAN" "$C_RESET"
printf "  %btacl --version%b Mostrar versión instalada\n" "$C_CYAN" "$C_RESET"
printf "  %btacl --help%b    Mostrar opciones y atajos de teclado\n\n" "$C_CYAN" "$C_RESET"
