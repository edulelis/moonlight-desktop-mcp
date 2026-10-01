#!/usr/bin/env bash
# Install or update Moonlight Desktop MCP on macOS or Linux.
# Review this script before piping it to a shell. Re-running it updates a clean
# checkout and preserves paired identities in the OS data directory.
set -euo pipefail

repository="${MOONLIGHT_MCP_REPOSITORY:-https://github.com/edulelis/moonlight-desktop-mcp.git}"
ref="${MOONLIGHT_MCP_REF:-main}"
configure_codex="${MOONLIGHT_MCP_CONFIGURE_CODEX:-1}"
node_version="${MOONLIGHT_MCP_NODE_VERSION:-v22.21.1}"

fail() {
  printf 'moonlight-desktop-mcp: %s\n' "$*" >&2
  exit 1
}

node_is_ready() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]
}

native_deps_are_ready() {
  command -v git >/dev/null 2>&1 && command -v cmake >/dev/null 2>&1 && command -v pkg-config >/dev/null 2>&1 && node_is_ready &&
    pkg-config --exists libavcodec libavutil libswscale openssl
}

install_macos_dependencies() {
  if ! xcode-select -p >/dev/null 2>&1; then
    xcode-select --install >/dev/null 2>&1 || true
    fail "macOS Command Line Tools are required. Their installer was requested; finish it, then run this command again."
  fi
  command -v brew >/dev/null 2>&1 || fail "Homebrew is required to install macOS build dependencies. Install Homebrew, then run this command again."
  if ! native_deps_are_ready; then
    brew install node cmake pkg-config ffmpeg openssl@3 git
  fi
  export PATH="$(brew --prefix node)/bin:$PATH"
  export PKG_CONFIG_PATH="$(brew --prefix ffmpeg)/lib/pkgconfig:$(brew --prefix openssl@3)/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
  export CMAKE_PREFIX_PATH="$(brew --prefix ffmpeg);$(brew --prefix openssl@3)${CMAKE_PREFIX_PATH:+;$CMAKE_PREFIX_PATH}"
}

install_linux_node() {
  node_is_ready && return
  command -v curl >/dev/null 2>&1 || fail "curl is required to install a user-local Node.js runtime."
  command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required to verify the user-local Node.js runtime."

  case "$(uname -m)" in
    x86_64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) fail "No Node.js binary mapping is available for Linux architecture $(uname -m). Install Node.js 20+ and run this command again." ;;
  esac

  node_data_root="${XDG_DATA_HOME:-$HOME/.local/share}/moonlight-desktop-mcp"
  node_name="node-${node_version}-linux-${node_arch}"
  node_directory="$node_data_root/$node_name"
  if [ ! -x "$node_directory/bin/node" ]; then
    temporary_directory="$(mktemp -d)"
    node_archive="$node_name.tar.xz"
    node_base_url="https://nodejs.org/dist/$node_version"
    curl --proto '=https' --tlsv1.2 -fsSL "$node_base_url/$node_archive" -o "$temporary_directory/$node_archive"
    curl --proto '=https' --tlsv1.2 -fsSL "$node_base_url/SHASUMS256.txt" -o "$temporary_directory/SHASUMS256.txt"
    expected_checksum="$(awk -v archive="$node_archive" '$2 == archive { print $1; exit }' "$temporary_directory/SHASUMS256.txt")"
    [ -n "$expected_checksum" ] || fail "Could not find a checksum for $node_archive."
    printf '%s  %s\n' "$expected_checksum" "$temporary_directory/$node_archive" | sha256sum -c - >/dev/null
    tar -xJf "$temporary_directory/$node_archive" -C "$temporary_directory"
    mkdir -p "$node_data_root"
    mv "$temporary_directory/$node_name" "$node_directory"
    rm -rf "$temporary_directory"
  fi
  export PATH="$node_directory/bin:$PATH"
  node_is_ready || fail "The user-local Node.js runtime is not usable."
}

install_linux_dependencies() {
  if ! (command -v git >/dev/null 2>&1 && command -v cmake >/dev/null 2>&1 && command -v pkg-config >/dev/null 2>&1 && pkg-config --exists libavcodec libavutil libswscale openssl); then
    command -v sudo >/dev/null 2>&1 || fail "Administrator access through sudo is required to install missing Linux build dependencies."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update
      sudo apt-get install -y nodejs npm git cmake pkg-config build-essential libssl-dev libavcodec-dev libavutil-dev libswscale-dev
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y nodejs npm git cmake pkgconf-pkg-config gcc gcc-c++ make openssl-devel ffmpeg-free-devel
    elif command -v pacman >/dev/null 2>&1; then
      sudo pacman -Sy --needed nodejs npm git cmake pkgconf base-devel openssl ffmpeg
    else
      fail "No supported Linux package manager was found. Install Git, CMake, pkg-config, OpenSSL development files, and FFmpeg development files, then run this command again."
    fi
  fi
  install_linux_node
}

case "$(uname -s)" in
  Darwin)
    install_root="${MOONLIGHT_MCP_INSTALL_DIR:-$HOME/Library/Application Support/Moonlight Desktop MCP/app}"
    data_root="${MOONLIGHT_MCP_DATA_DIR:-$HOME/Library/Application Support/Moonlight Desktop MCP}"
    install_macos_dependencies
    ;;
  Linux)
    install_root="${MOONLIGHT_MCP_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/moonlight-desktop-mcp/app}"
    data_root="${MOONLIGHT_MCP_DATA_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/moonlight-desktop-mcp}"
    install_linux_dependencies
    ;;
  *) fail "This installer supports macOS and Linux. Use install.ps1 from PowerShell on Windows." ;;
esac

native_deps_are_ready || fail "Required build dependencies are still unavailable. See docs/INSTALL.md."

if [ -d "$install_root/.git" ]; then
  [ -z "$(git -C "$install_root" status --porcelain)" ] ||
    fail "The existing checkout has local changes. Commit, stash, or choose MOONLIGHT_MCP_INSTALL_DIR before updating."
  git -C "$install_root" fetch --tags origin
  if [ "$ref" = "main" ]; then
    git -C "$install_root" checkout main
    git -C "$install_root" pull --ff-only origin main
  else
    git -C "$install_root" checkout --detach "$ref"
  fi
else
  [ ! -e "$install_root" ] || fail "The install location exists but is not a Git checkout. Choose MOONLIGHT_MCP_INSTALL_DIR or move it aside."
  mkdir -p "$(dirname "$install_root")"
  git clone "$repository" "$install_root"
  if [ "$ref" = "main" ]; then
    git -C "$install_root" checkout main
  else
    git -C "$install_root" checkout --detach "$ref"
  fi
fi

(
  cd "$install_root"
  npm ci
  npm run setup:native
  npm run build:native
  npm run doctor -- --strict
)

if [ "$configure_codex" = "1" ] && command -v codex >/dev/null 2>&1; then
  if ! codex mcp get moonlight-desktop >/dev/null 2>&1; then
    codex mcp add moonlight-desktop --env "MOONLIGHT_MCP_DATA_DIR=$data_root" -- "$(command -v node)" "$install_root/src/index.js"
  fi
fi

printf '\nMoonlight Desktop MCP is ready at %s\n' "$install_root"
printf 'Re-run this command to update a clean checkout. Set MOONLIGHT_MCP_REF to install a specific tag or commit.\n'
