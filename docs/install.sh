#!/usr/bin/env sh
set -eu

REPO="Tsurematsu/tacl"
BIN_NAME="tacl"
VERSION="${TACL_VERSION:-latest}"

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

# 2. Construir URL de descarga
if [ "$VERSION" = "latest" ]; then
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
else
  case "$VERSION" in
    v*) TAG="$VERSION" ;;
    *)  TAG="v${VERSION}" ;;
  esac
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
fi

# 3. Elegir directorio de instalación
if [ -n "${TACL_INSTALL_DIR:-}" ]; then
  INSTALL_DIR="$TACL_INSTALL_DIR"
elif [ -w "/usr/local/bin" ]; then
  INSTALL_DIR="/usr/local/bin"
else
  INSTALL_DIR="${HOME}/.local/bin"
fi

mkdir -p "$INSTALL_DIR" || error "No se pudo crear el directorio de instalación: ${INSTALL_DIR}"

if [ ! -w "$INSTALL_DIR" ]; then
  error "Sin permisos de escritura en ${INSTALL_DIR}. Ejecuta con sudo o define TACL_INSTALL_DIR=\"\$HOME/.local/bin\"."
fi

# 4. Descargar binario a archivo temporal
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/tacl-install.XXXXXX")"
cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT INT TERM

info "Descargando ${BIN_NAME} (${VERSION}) para Linux x86_64..."
if command -v curl >/dev/null 2>&1; then
  curl -fL --progress-bar "$DOWNLOAD_URL" -o "$TMP_FILE" || error "Fallo al descargar desde ${DOWNLOAD_URL}"
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress "$DOWNLOAD_URL" -O "$TMP_FILE" || error "Fallo al descargar desde ${DOWNLOAD_URL}"
else
  error "Se requiere 'curl' o 'wget' para descargar ${BIN_NAME}."
fi

if [ ! -s "$TMP_FILE" ]; then
  error "El archivo descargado está vacío."
fi

# 5. Instalar como comando ejecutable `tacl`
TARGET="${INSTALL_DIR}/${BIN_NAME}"
chmod 755 "$TMP_FILE"
mv -f "$TMP_FILE" "$TARGET"
ok "${BIN_NAME} instalado correctamente en ${TARGET}"

# 6. Verificar PATH y configurar perfil si hace falta
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
fi

# 7. Verificación rápida
if "$TARGET" --help >/dev/null 2>&1; then
  ok "Verificación superada: '${BIN_NAME}' está listo para usarse."
else
  warn "El binario se instaló en ${TARGET}, pero falló la verificación rápida '--help'."
fi

printf "\n%bInicio rápido:%b\n" "$C_BOLD" "$C_RESET"
printf "  %btacl%b           Iniciar asistente o conectar al servidor guardado\n" "$C_CYAN" "$C_RESET"
printf "  %btacl --demo%b    Explorar la interfaz en modo demostración sin tocar Headscale\n" "$C_CYAN" "$C_RESET"
printf "  %btacl --rescan%b  Reconfigurar servidor o cambiar entre Nativo y Contenedor\n" "$C_CYAN" "$C_RESET"
printf "  %btacl --help%b    Mostrar opciones y atajos de teclado\n\n" "$C_CYAN" "$C_RESET"
