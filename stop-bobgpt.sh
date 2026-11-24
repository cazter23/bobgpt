#!/usr/bin/env bash
# Stops BobGPT's background server (the one start-bobgpt.sh or the login service starts), for example to free its
# memory, or to run "npm run dev" on the same address. Only a Node program listening on BobGPT's port is stopped.

PORT="${BOBGPT_PORT:-5173}"

# Started at login: stop the service, so it doesn't look as if it's still running.
if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet bobgpt.service 2>/dev/null; then
  systemctl --user stop bobgpt.service
fi

# The Node programs listening on the port: find the port's listening sockets in /proc/net, then the processes holding them.
node_pids_on_port() {
  local inodes pid fd
  inodes=$(awk -v port=":$(printf '%04X' "$PORT")" '$2 ~ port"$" && $4 == "0A" { print "socket:[" $10 "]" }' \
    /proc/net/tcp /proc/net/tcp6 2>/dev/null)
  [ -n "$inodes" ] || return
  for pid in /proc/[0-9]*; do
    [ "$(cat "$pid/comm" 2>/dev/null)" = "node" ] || continue
    for fd in "$pid"/fd/*; do
      if grep -qxF "$(readlink "$fd" 2>/dev/null)" <<<"$inodes"; then
        echo "${pid#/proc/}"
        break
      fi
    done
  done
}

pids=$(node_pids_on_port)
if [ -n "$pids" ]; then
  kill $pids
  echo "BobGPT stopped."
elif (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "Something is using port $PORT, but it isn't a Node program, so it was left alone."
else
  echo "BobGPT was not running."
fi
