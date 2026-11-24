#!/usr/bin/env bash
# Starts BobGPT (the built version, which uses much less memory than "npm run dev") and opens it in your browser.
# The Linux counterpart of start-bobgpt.bat. It builds the app first if the code has changed, and starts the server in
# the background. Use stop-bobgpt.sh to stop it.
#
#   ./start-bobgpt.sh          start the server if it isn't running, then open BobGPT
#   ./start-bobgpt.sh startup  start the server without opening a browser
#   ./start-bobgpt.sh serve    build if needed, then run the server in this terminal (this is what start-at-login uses)

cd "$(dirname "$(readlink -f "$0")")" || exit 1

PORT="${BOBGPT_PORT:-5173}"
# Which browser to open BobGPT in. Chats are saved separately by each browser, so use the one you already use for it:
#   firefox  = a normal Firefox tab   chrome or chromium = an app-style window (no tabs or address bar)
#   default  = whatever your desktop uses for links
BROWSER_CHOICE="${BOBGPT_BROWSER:-firefox}"
LOG="${XDG_STATE_HOME:-$HOME/.local/state}/bobgpt/server.log"

# A launcher or a login service doesn't read your shell's settings, so Node installed with Homebrew (as on Bazzite) or
# nvm isn't on its PATH. Look in the usual places.
for dir in /home/linuxbrew/.linuxbrew/bin "$HOME/.linuxbrew/bin" "$HOME/.local/bin" "$HOME/.volta/bin"; do
  [ -d "$dir" ] && PATH="$PATH:$dir"
done
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  PATH="$PATH:$(ls -d "$HOME"/.nvm/versions/node/*/bin | sort -V | tail -n 1)"
fi
export PATH

fail() {
  echo "$1" >&2
  command -v notify-send >/dev/null 2>&1 && notify-send -i "$PWD/public/icon-192.png" "BobGPT" "$1"
  exit 1
}

command -v node >/dev/null 2>&1 || fail "BobGPT needs Node.js. Install it (on Bazzite: brew install node), then run: npm install"
[ -f node_modules/vite/bin/vite.js ] || fail "BobGPT isn't set up yet. Open a terminal in $PWD and run:  npm install"

listening() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

# Build when there is no build yet, or when the code is newer than it.
if [ ! -f dist/index.html ] ||
  [ -n "$(find src public index.html package.json vite.config.ts -type f -newer dist/index.html -print -quit)" ]; then
  echo "Building BobGPT..."
  node node_modules/vite/bin/vite.js build >/dev/null 2>&1 ||
    fail "The build failed, so BobGPT wasn't started. Run  npm run build  in $PWD to see why."
fi

if [ "$1" = "serve" ]; then
  exec node node_modules/vite/bin/vite.js preview --port "$PORT" --strictPort
fi

# Start the server, unless something is already answering on the port.
if ! listening; then
  mkdir -p "$(dirname "$LOG")"
  setsid node node_modules/vite/bin/vite.js preview --port "$PORT" --strictPort >"$LOG" 2>&1 </dev/null &
  for _ in $(seq 20); do
    listening && break
    sleep 0.5
  done
  listening || fail "BobGPT's server didn't start. See $LOG"
fi

# Open it (not when running at login).
[ "$1" = "startup" ] && exit 0
URL="http://localhost:$PORT"

has_flatpak() { command -v flatpak >/dev/null 2>&1 && flatpak info "$1" >/dev/null 2>&1; }
launch() { setsid "$@" >/dev/null 2>&1 </dev/null & exit 0; }

case "$BROWSER_CHOICE" in
  firefox)
    command -v firefox >/dev/null 2>&1 && launch firefox "$URL"
    has_flatpak org.mozilla.firefox && launch flatpak run org.mozilla.firefox "$URL"
    ;;
  chrome)
    command -v google-chrome >/dev/null 2>&1 && launch google-chrome --app="$URL"
    has_flatpak com.google.Chrome && launch flatpak run com.google.Chrome --app="$URL"
    ;;
  chromium)
    command -v chromium-browser >/dev/null 2>&1 && launch chromium-browser --app="$URL"
    command -v chromium >/dev/null 2>&1 && launch chromium --app="$URL"
    has_flatpak org.chromium.Chromium && launch flatpak run org.chromium.Chromium --app="$URL"
    ;;
esac
launch xdg-open "$URL"
