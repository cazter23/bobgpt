#!/usr/bin/env bash
# Adds BobGPT to your Linux desktop: an entry with its icon in the app menu, and (unless you say "no-autostart") a
# service that starts the server when you log in, without opening a browser. Everything goes in your home folder, so it
# suits immutable systems such as Bazzite. Run it again after moving this folder. "./install-linux.sh remove" undoes it.

cd "$(dirname "$(readlink -f "$0")")" || exit 1
HERE="$PWD"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

if [ "$1" = "remove" ]; then
  systemctl --user disable --now bobgpt.service 2>/dev/null
  rm -f "$APPS/bobgpt.desktop" "$UNITS/bobgpt.service"
  systemctl --user daemon-reload 2>/dev/null
  echo "Removed BobGPT's app menu entry and start-at-login service."
  exit 0
fi

chmod +x start-bobgpt.sh stop-bobgpt.sh

mkdir -p "$APPS"
cat >"$APPS/bobgpt.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=BobGPT
Comment=Chat with models running in LM Studio
Exec="$HERE/start-bobgpt.sh"
Icon=$HERE/public/icon-512.png
Terminal=false
Categories=Utility;
Actions=stop;

[Desktop Action stop]
Name=Stop BobGPT's server
Exec="$HERE/stop-bobgpt.sh"
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" 2>/dev/null
echo "Added BobGPT to the app menu."

if [ "$1" = "no-autostart" ]; then
  exit 0
fi

mkdir -p "$UNITS"
cat >"$UNITS/bobgpt.service" <<EOF
[Unit]
Description=BobGPT server (http://localhost:5173)

[Service]
ExecStart="$HERE/start-bobgpt.sh" serve

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now bobgpt.service &&
  echo "BobGPT's server now starts when you log in (and is running now)."
