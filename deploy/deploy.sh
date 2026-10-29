#!/usr/bin/env bash
# Runs the deploy tool (docs/deployment.md → The Deploy Tool): the binary for this machine's architecture, built from
# tools/deploy/ and committed in deploy/bin/. A script, so cron lines and habits stay `deploy/deploy.sh <command>`.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case $(uname -m) in
  x86_64 | amd64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) arch=$(uname -m) ;;
esac
bin="$dir/bin/linux-$arch/deploy"

if [[ ! -x $bin ]]; then
  if [[ -d $dir/bin ]]; then
    echo "✗ There's no deploy tool for linux-$arch in deploy/bin/. Build it where Go is installed, commit it, then pull:" >&2
    echo "    pnpm deploy:build --arch $arch" >&2
  else
    echo "✗ The deploy tool comes with the repository. Clone it, then run it from there:" >&2
    echo "    git clone <repository> app && app/deploy/deploy.sh" >&2
  fi
  exit 1
fi

# ===== The tmux Window =====
# Closing the SSH connection ends whatever runs on its terminal, a deploy halfway included. So the menu runs in a tmux
# window that outlives the connection. Quitting the menu closes the window: each action already waits for Enter, so its
# output has been read. When the tool fails instead, quitting right after a failed action included, a shell stays,
# with the error on screen, until `exit`. Running
# this script again reattaches to it. A command (`deploy/deploy.sh status`) runs here as before, so
# cron and scripts get its exit code and a second look while a deploy runs in the window is still possible; so does
# the menu without a terminal, and inside tmux already (the window's own).

# offer_tmux asks to install tmux, every time the menu opens without it, and installs it on a yes. A no, an unknown
# package manager or a failed install leaves it uninstalled, and the menu runs without it.
offer_tmux() {
  local install=() shown=""
  if command -v apt-get >/dev/null; then
    # A server that never ran `apt-get update` has no package lists to find tmux in.
    install=(sh -c "apt-get update -qq && apt-get install -y tmux")
    shown="apt-get install tmux"
  elif command -v dnf >/dev/null; then
    install=(dnf install -y tmux)
  elif command -v yum >/dev/null; then
    install=(yum install -y tmux)
  elif command -v apk >/dev/null; then
    install=(apk add tmux)
  else
    echo "tmux isn't installed, so closing this connection stops the menu, a deploy halfway included. Install tmux" \
      "to keep it running." >&2
    return
  fi
  shown=${shown:-${install[*]}}
  if (( EUID != 0 )); then
    install=(sudo "${install[@]}")
    shown="sudo $shown"
  fi

  echo "tmux isn't installed. Without it, closing this connection stops the menu, a deploy halfway included."
  echo "  1) Install tmux               ($shown)"
  echo "  2) Continue without tmux"
  local choice=""
  read -rp "Choose [1]: " choice || true
  if [[ ${choice:-1} != 1 ]]; then
    return
  fi
  if ! "${install[@]}" || ! command -v tmux >/dev/null; then
    echo "Installing tmux failed (see above), so the menu runs without it." >&2
  fi
}

if (( $# == 0 )) && [[ -z ${TMUX:-} && -t 0 && -t 1 ]]; then
  if ! command -v tmux >/dev/null; then
    offer_tmux
  fi
  if command -v tmux >/dev/null; then
    # One window per checkout. tmux doesn't allow "." or ":" in a name.
    root_name=$(basename "$(dirname "$dir")")
    session="deploy-${root_name//[.:]/_}"
    # The tool's own tmux server, set up by deploy/tmux.conf (scrollback, the mouse wheel, the status line). The file
    # is read when the server starts, before its first window, which is the only time tmux applies history-limit.
    deploy_tmux=(tmux -L deploy -f "$dir/tmux.conf")
    if "${deploy_tmux[@]}" has-session -t "=$session" 2>/dev/null; then
      exec "${deploy_tmux[@]}" attach-session -t "=$session"
    fi
    # A window opened before the tool had its own server is on the default one.
    if tmux has-session -t "=$session" 2>/dev/null; then
      exec tmux attach-session -t "=$session"
    fi
    # A tmux server that's already running gives a new window its own environment, not this one's.
    pass=()
    for name in NO_COLOR NO_GUM NO_TUI DEPLOY_ROOT SUDO_USER USER; do
      if [[ -n ${!name:-} ]]; then pass+=(-e "$name=${!name}"); fi
    done
    printf -v command '%q' "$dir/deploy.sh"
    stayed="The deploy tool stopped after a failure, so this window stays open: scroll back with the mouse wheel, \
the whole output is in deploy/logs/. Type exit to close the window."
    printf -v stayed '%q' "$stayed"
    exec "${deploy_tmux[@]}" new-session -s "$session" -c "$(dirname "$dir")" ${pass[@]+"${pass[@]}"} \
      "bash $command || { echo; echo $stayed; exec \"\${SHELL:-bash}\"; }"
  fi
fi
exec "$bin" "$@"
