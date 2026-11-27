#!/bin/sh
# Cross-compile a portable (installation-free) Windows x64 knit.exe on macOS/Linux
# using Nim + Zig (MinGW-w64 target).
#
# Outputs:
#   dist/knit.exe                     - single-file exe (embeds web/dist & WebView2Loader.dll)
#   dist/knit-win64-portable/         - ready-to-run green portable folder (with knit.portable)
#   dist/knit-win64-portable.zip      - zip archive for easy distribution
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARCH="${1:-amd64}"
case "$ARCH" in
  amd64)
    CPU="amd64"
    TARGET="x86_64-windows-gnu"
    LOADER_ARCH="x64"
    BUNDLE_NAME="knit-win64-portable"
    ;;
  arm64)
    CPU="arm64"
    TARGET="aarch64-windows-gnu"
    LOADER_ARCH="arm64"
    BUNDLE_NAME="knit-win-arm64-portable"
    ;;
  *)
    echo "usage: $0 [amd64|arm64]" >&2
    exit 2
    ;;
esac

command -v zig >/dev/null || { echo "error: zig not found" >&2; exit 1; }
command -v nim >/dev/null || { echo "error: nim not found" >&2; exit 1; }

echo "[1/4] Building frontend (web/dist)..."
(cd web && bun run build && npx tsc --noEmit)

CC_DIR="$(mktemp -d)"
CACHE_DIR="$(mktemp -d)"
trap 'rm -rf "$CC_DIR" "$CACHE_DIR"' EXIT HUP INT TERM

cat > "$CC_DIR/cc" <<EOF
#!/bin/sh
exec zig cc -target "$TARGET" "\$@"
EOF
chmod +x "$CC_DIR/cc"

OUT_DIR="$ROOT/dist/$BUNDLE_NAME"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "[2/4] Cross-compiling $BUNDLE_NAME/knit.exe ($TARGET, embedded web + WebView2Loader)..."
nim c \
  --os:windows \
  --cpu:"$CPU" \
  --cc:clang \
  --app:gui \
  -d:release \
  -d:knitNoLibgit2 \
  -d:knitEmbedWeb \
  -d:knitEmbedWebView2 \
  --passC:-Os \
  --passL:-Wl,--subsystem,windows \
  --passL:-s \
  --clang.exe:"$CC_DIR/cc" \
  --clang.linkerexe:"$CC_DIR/cc" \
  --nimcache:"$CACHE_DIR" \
  --hints:off \
  --path:../nimi/src \
  -o:"$OUT_DIR/knit.exe" \
  src/main.nim

echo "[3/4] Assembling portable package..."
if [ "$ARCH" = "arm64" ]; then
  cp "$OUT_DIR/knit.exe" "$ROOT/dist/knit-arm64.exe"
else
  cp "$OUT_DIR/knit.exe" "$ROOT/dist/knit.exe"
fi
cp "$ROOT/../nimi/src/nimi/platform/windows/webview2/sdk/$LOADER_ARCH/WebView2Loader.dll" "$OUT_DIR/WebView2Loader.dll"
touch "$OUT_DIR/knit.portable"

cat > "$OUT_DIR/README.txt" <<'EOF'
Knit — Windows 绿色免安装版

使用方式：
1. 双击 knit.exe 即可直接运行，无需安装。
2. 便携模式：本目录包含 knit.portable 标记文件，所有设置、仓库索引缓存与日志均保存在本目录的 data/ 文件夹中，不写入系统注册表或 %APPDATA%。
3. 单文件运行：即使单独把 knit.exe 复制到其他可写目录双击，也会自动释放内嵌的 WebView2Loader.dll 与前端资源，并将数据保存在 %APPDATA%\knit。

运行环境要求：
- Windows 10 / 11 (x64)
- 已安装 Git for Windows（确保 git 在 PATH 中）
- Microsoft Edge WebView2 Runtime（Windows 11 默认内置，Windows 10 大多数系统已随 Edge 内置）
EOF

echo "[4/4] Creating zip archive..."
rm -f "$ROOT/dist/$BUNDLE_NAME.zip"
(cd "$ROOT/dist" && zip -q -r "$BUNDLE_NAME.zip" "$BUNDLE_NAME")

echo ""
echo "Build complete:"
ls -lh "$ROOT/dist/knit.exe" "$OUT_DIR/WebView2Loader.dll" "$ROOT/dist/$BUNDLE_NAME.zip"
file "$OUT_DIR/knit.exe"
