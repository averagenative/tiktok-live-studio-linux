#!/usr/bin/env bash
# Install the AppImage to ~/Applications and register a .desktop entry
# + icon so GNOME search (Super key) finds it.
set -euo pipefail
cd "$(dirname "$0")"

APP_ID=io.github.averagenative.livestudiolinux
APPIMAGE_SRC=$(ls dist/LIVE\ Studio\ for\ Linux-*.AppImage | sort -V | tail -1)
APPIMAGE_DEST="$HOME/Applications/live-studio-linux-x86_64.AppImage"
ICON_DEST="$HOME/.local/share/icons/hicolor/512x512/apps/$APP_ID.png"
DESKTOP_DEST="$HOME/.local/share/applications/$APP_ID.desktop"

mkdir -p "$HOME/Applications" "$(dirname "$ICON_DEST")" "$(dirname "$DESKTOP_DEST")"
# Replace rather than overwrite, so a running copy keeps its mounted image.
rm -f "$APPIMAGE_DEST"
cp "$APPIMAGE_SRC" "$APPIMAGE_DEST"
chmod +x "$APPIMAGE_DEST"
cp build/icon.png "$ICON_DEST"

cat > "$DESKTOP_DEST" <<DESKTOP
[Desktop Entry]
Type=Application
Name=LIVE Studio for Linux
Comment=Unofficial: go LIVE on TikTok through OBS
Exec=$APPIMAGE_DEST
Icon=$APP_ID
Terminal=false
Categories=AudioVideo;Video;
Keywords=tiktok;live;stream;obs;
StartupWMClass=live-studio-linux
DESKTOP

update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
gtk-update-icon-cache -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
echo "Installed: $DESKTOP_DEST -> $APPIMAGE_DEST"
