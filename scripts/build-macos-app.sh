#!/bin/sh
# Build a self-contained macOS .app bundle (and .dmg) for Knit.
#
# Outputs:
#   dist/Knit.app                  - ready-to-launch macOS application bundle
#   dist/Knit-macos-<arch>.dmg     - drag-to-Applications disk image
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARCH="$(uname -m)"
APP_NAME="Knit"
APP_DIR="$ROOT/dist/${APP_NAME}.app"
CONTENTS="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RES_DIR="$CONTENTS/Resources"
FW_DIR="$CONTENTS/Frameworks"
BIN="$MACOS_DIR/knit"

command -v nim >/dev/null || { echo "error: nim not found" >&2; exit 1; }
command -v bun >/dev/null || { echo "error: bun not found" >&2; exit 1; }

echo "[1/6] Building frontend (web/dist)..."
(cd web && bun run build && npx tsc --noEmit)

echo "[2/6] Compiling native macOS binary ($ARCH, libgit2 + embedded web)..."
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RES_DIR/web" "$FW_DIR"

nim c \
  -d:release \
  -d:knitEmbedWeb \
  --opt:speed \
  --hints:off \
  --path:../nimi/src \
  -o:"$BIN" \
  src/main.nim

cp -R "$ROOT/web/dist" "$RES_DIR/web/dist"

echo "[3/6] Bundling non-system dylibs into Contents/Frameworks..."
python3 - "$BIN" "$FW_DIR" <<'PY'
import os, shutil, subprocess, sys

main_bin, fw_dir = sys.argv[1], sys.argv[2]

def otool_deps(path):
    out = subprocess.check_output(["otool", "-L", path], text=True)
    deps = []
    for line in out.splitlines()[1:]:
        dep = line.strip().split(" ", 1)[0]
        if not dep or dep.startswith(("/System/", "/usr/lib/", "@executable_path/", "@loader_path/", "@rpath/")):
            continue
        if os.path.exists(dep):
            deps.append(dep)
    return deps

queue = [main_bin]
seen = set()
copied = {}

while queue:
    target = queue.pop(0)
    if target in seen:
        continue
    seen.add(target)
    for dep in otool_deps(target):
        base = os.path.basename(dep)
        dest = os.path.join(fw_dir, base)
        if base not in copied:
            shutil.copyfile(dep, dest)
            os.chmod(dest, 0o755)
            subprocess.check_call(["install_name_tool", "-id", f"@executable_path/../Frameworks/{base}", dest])
            copied[base] = dest
            queue.append(dest)
        subprocess.check_call(["install_name_tool", "-change", dep, f"@executable_path/../Frameworks/{base}", target])

# Verify zero external /opt/homebrew or /usr/local references remain
for path in [main_bin] + list(copied.values()):
    leftover = otool_deps(path)
    if leftover:
        raise SystemExit(f"error: unresolved external dylibs in {path}: {leftover}")
PY

echo "[4/6] Generating macOS app icon (Knit.icns) and Info.plist..."
ICONSET="$(mktemp -d)/Knit.iconset"
mkdir -p "$ICONSET"
BASE_PNG="$ICONSET/base_1024.png"

python3 - "$BASE_PNG" <<'PY'
import math, struct, sys, zlib

W = H = 512  # crisp supersampled icon, scaled smoothly by sips
buf = bytearray(W * H * 4)

def blend(x, y, r, g, b, a):
    if x < 0 or x >= W or y < 0 or y >= H or a <= 0:
        return
    i = (y * W + x) * 4
    sa = min(1.0, max(0.0, a))
    da = buf[i + 3] / 255.0
    oa = sa + da * (1.0 - sa)
    if oa <= 0:
        return
    buf[i]     = int((r * sa + buf[i]     * da * (1.0 - sa)) / oa)
    buf[i + 1] = int((g * sa + buf[i + 1] * da * (1.0 - sa)) / oa)
    buf[i + 2] = int((b * sa + buf[i + 2] * da * (1.0 - sa)) / oa)
    buf[i + 3] = int(oa * 255)

def squircle_sdf(px, py, cx, cy, half, rad):
    qx = abs(px - cx) - (half - rad)
    qy = abs(py - cy) - (half - rad)
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - rad

def dist_seg(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    l2 = dx * dx + dy * dy
    if l2 == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / l2))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))

# 1. macOS squircle background (deep ink slate gradient)
pad = 44.0
half = W / 2.0 - pad
rad = 96.0
for y in range(H):
    t = y / float(H)
    br = int(20 + 12 * (1 - t))
    bg = int(24 + 16 * (1 - t))
    bb = int(34 + 22 * (1 - t))
    for x in range(W):
        d = squircle_sdf(x + 0.5, y + 0.5, W / 2.0, H / 2.0, half, rad)
        if d <= 1.5:
            a = max(0.0, min(1.0, 0.5 - d))
            # subtle top sheen & border highlight
            if abs(d + 2.0) < 2.2:
                blend(x, y, 96, 140, 210, a * 0.35)
            blend(x, y, br, bg, bb, a)

# 2. Stylized Git branch + knit weave mark
# Main trunk: (176, 136) -> (176, 376)
# Branch curve: (176, 326) -> cubic-like smooth bend to (332, 200)
curve_pts = []
for i in range(41):
    t = i / 40.0
    # Smooth S-curve from (176, 326) to (332, 196)
    u = 1 - t
    x = u**3 * 176 + 3 * u**2 * t * 176 + 3 * u * t**2 * 332 + t**3 * 332
    y = u**3 * 326 + 3 * u**2 * t * 246 + 3 * u * t**2 * 276 + t**3 * 196
    curve_pts.append((x, y))

for y in range(100, 412):
    for x in range(100, 412):
        # Trunk (blue-indigo)
        dt = dist_seg(x + 0.5, y + 0.5, 176, 148, 176, 364)
        if dt < 18.0:
            a = max(0.0, min(1.0, 16.5 - dt))
            blend(x, y, 78, 154, 248, a)
        # Branch curve (teal-emerald)
        dc = 999.0
        for i in range(len(curve_pts) - 1):
            x1, y1 = curve_pts[i]
            x2, y2 = curve_pts[i + 1]
            d = dist_seg(x + 0.5, y + 0.5, x1, y1, x2, y2)
            if d < dc:
                dc = d
        if dc < 18.0:
            a = max(0.0, min(1.0, 16.5 - dc))
            blend(x, y, 56, 211, 159, a)

# Commit nodes: top trunk, bottom trunk, branch tip
nodes = [
    (176, 148, (96, 168, 255)),
    (176, 364, (96, 168, 255)),
    (332, 196, (68, 224, 172)),
]
for nx, ny, col in nodes:
    for y in range(int(ny - 44), int(ny + 45)):
        for x in range(int(nx - 44), int(nx + 45)):
            d = math.hypot(x + 0.5 - nx, y + 0.5 - ny)
            if d < 36.0:
                a = max(0.0, min(1.0, 34.5 - d))
                blend(x, y, col[0], col[1], col[2], a)
            if d < 18.0:
                a = max(0.0, min(1.0, 16.5 - d))
                blend(x, y, 22, 27, 38, a)

# Encode PNG
def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

raw = bytearray()
for y in range(H):
    raw.append(0)
    raw.extend(buf[y * W * 4 : (y + 1) * W * 4])

png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    + chunk(b"IEND", b"")
)
with open(sys.argv[1], "wb") as f:
    f.write(png)
PY

for sz in 16 32 128 256 512; do
  sips -z "$sz" "$sz" "$BASE_PNG" --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
  sz2=$((sz * 2))
  sips -z "$sz2" "$sz2" "$BASE_PNG" --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
done
rm -f "$BASE_PNG"
iconutil -c icns "$ICONSET" -o "$RES_DIR/Knit.icns"
rm -rf "$(dirname "$ICONSET")"

cat > "$CONTENTS/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>Knit</string>
  <key>CFBundleExecutable</key>
  <string>knit</string>
  <key>CFBundleIconFile</key>
  <string>Knit</string>
  <key>CFBundleIdentifier</key>
  <string>dev.knit.app</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Knit</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.5.0</string>
  <key>CFBundleVersion</key>
  <string>5</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
EOF

echo "[5/6] Ad-hoc signing Knit.app and verifying smoke launch..."
for lib in "$FW_DIR"/*.dylib; do
  [ -f "$lib" ] && codesign --force --sign - "$lib"
done
codesign --force --deep --sign - "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"

# Smoke test the packaged .app directly (without KNIT_WEB override)
SMOKE_OUT="$(mktemp)"
KNIT_SMOKE_OUT="$SMOKE_OUT" "$BIN" --smoke
echo "Smoke result: $(cat "$SMOKE_OUT")"
rm -f "$SMOKE_OUT"

echo "[6/6] Creating DMG archive..."
DMG_PATH="$ROOT/dist/Knit-macos-${ARCH}.dmg"
STAGING="$(mktemp -d)"
cp -R "$APP_DIR" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
rm -f "$DMG_PATH"
hdiutil create -volname "Knit" -srcfolder "$STAGING" -ov -format UDZO "$DMG_PATH" >/dev/null
rm -rf "$STAGING"

echo ""
echo "Build complete:"
ls -ldh "$APP_DIR"
ls -lh "$DMG_PATH"
echo "Linked libraries:"
otool -L "$BIN"
