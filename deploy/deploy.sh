#!/usr/bin/env bash
# Sets up, updates, backs up and checks the production stack on its server (docs/deployment.md → The Deploy Script).
#
#   deploy/deploy.sh             a menu, with the stack's status under it
#   deploy/deploy.sh <command>   the same actions without the menu, for cron and scripts (`deploy/deploy.sh help`)
#
# Needs bash, git, Docker with Compose 2.23.1+, openssl and curl. Without a terminal (cron) it never asks: it uses the
# flags or the defaults, or stops with an error naming the flag to pass. On a terminal it draws its prompts with gum,
# which it downloads into deploy/.bin (Prompts below); NO_GUM=1 keeps the plain ones.
set -euo pipefail
shopt -s inherit_errexit

# ===== Paths =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="compose.prod.yaml"
ENV_FILE="$ROOT/.env"
EXAMPLE_FILE="$ROOT/.env.production.example"
# `<fingerprint> <epoch>` of the .env the running stack was last deployed with (Applied State below).
APPLIED_FILE="$ROOT/.env.applied"
CERT_DIR="$ROOT/certs"
SERVICES=(app caddy error-viewer db seaweedfs)
MIN_COMPOSE="2.23.1"
# App images kept for Roll back, newest first, tagged with their commit (Versions below).
KEEP_VERSIONS=3
# Reads and writes the image store's volume for media backups. Any image with `sh`, `find` and `tar` works.
HELPER_IMAGE="busybox:1.37"
# Tools the script downloads for itself (gitignored).
BIN_DIR="$SCRIPT_DIR/.bin"

if [[ -t 0 && -t 1 ]]; then INTERACTIVE=1; else INTERACTIVE=0; fi

# ===== Output =====
# Colors only on a terminal, and never with NO_COLOR (https://no-color.org). Every status also says it in words.
if [[ -t 1 && -z ${NO_COLOR:-} ]]; then
  RED=$'\e[31m' GREEN=$'\e[32m' YELLOW=$'\e[33m' DIM=$'\e[2m' BOLD=$'\e[1m' RESET=$'\e[0m'
else
  RED="" GREEN="" YELLOW="" DIM="" BOLD="" RESET=""
fi

info() { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
ok() { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() {
  printf '%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2
  exit 1
}

# ===== gum =====
# gum (https://github.com/charmbracelet/gum) draws the prompts on a terminal: arrow-key menus, answers that can be
# edited in place, spinners. It's one binary, pinned and checked against its release checksum, kept in deploy/.bin.
# Nothing depends on it: without a terminal, with NO_GUM=1, or when it can't be downloaded (GitHub unreachable), the
# prompts are plain `read`s.
GUM_VERSION="2.0.2"
declare -A GUM_SHA256=(
  [x86_64]=d842e06d93dbed90af48cb8dd10698db6f22e331fc40346bb37bbc753109edc2
  [arm64]=8ebf8b54ec1e8c81f2bb58b59ff9b70998186a4d11375f0cf357b80e0ccfa1d5
)
GUM=""

# Sets GUM, downloading gum the first time. A failed download is remembered, so a server that can't reach GitHub
# doesn't wait for it on every run.
find_gum() {
  local bin="$BIN_DIR/gum-$GUM_VERSION" arch url work
  [[ $INTERACTIVE == 1 && -z ${NO_GUM:-} ]] || return 0
  # gum lays itself out by the terminal's size, and crashes on one that reports none.
  [[ $(stty size 2>/dev/null) =~ ^[1-9][0-9]*\ [1-9][0-9]*$ ]] || return 0

  if [[ ! -x $bin && ! -f $bin.unavailable ]]; then
    case $(uname -m) in
      x86_64 | amd64) arch=x86_64 ;;
      aarch64 | arm64) arch=arm64 ;;
      *) return 0 ;;
    esac
    command -v sha256sum >/dev/null && mkdir -p "$BIN_DIR" 2>/dev/null || return 0
    url="https://github.com/charmbracelet/gum/releases/download/v$GUM_VERSION/gum_${GUM_VERSION}_Linux_$arch.tar.gz"
    printf '%sDownloading gum %s for the menus (once)…%s\n' "$DIM" "$GUM_VERSION" "$RESET" >&2
    work=$(mktemp -d)
    if curl -fsSL --connect-timeout 5 --max-time 60 -o "$work/gum.tar.gz" "$url" &&
      [[ $(sha256sum "$work/gum.tar.gz" | cut -d' ' -f1) == "${GUM_SHA256[$arch]}" ]] &&
      tar xzf "$work/gum.tar.gz" -C "$work" --strip-components 1 "gum_${GUM_VERSION}_Linux_$arch/gum" &&
      mv "$work/gum" "$bin"; then
      # Other versions' binaries and failure marks: a version bump downloads (or retries) its own.
      find "$BIN_DIR" -maxdepth 1 -name 'gum-*' ! -name "gum-$GUM_VERSION" -delete
    else
      touch "$bin.unavailable" 2>/dev/null || true
      warn "Couldn't download gum, so the prompts stay plain. To try again: rm $bin.unavailable"
    fi
    rm -rf "$work"
  fi
  if [[ -x $bin ]]; then GUM=$bin; fi
}

# Runs a gum prompt and prints its answer. gum reads the keys itself, so Ctrl-C never reaches the script as a signal:
# Esc and Ctrl-C give up by sending SIGINT to the process group, as Ctrl-C at a plain prompt would. That ends the
# action, or the script outside the menu, which ignores it and comes back.
gum_prompt() {
  local rc=0
  "$GUM" "$@" || rc=$?
  if ((rc != 0)); then
    kill -INT 0
    exit 130
  fi
}

# gum clears a prompt once it's answered; this leaves the question and its answer in the scrollback.
show_answer() { printf '%s%s%s  %s\n' "$DIM" "$1" "$RESET" "$2" >&2; }

# ===== Prompts =====
# Each prompt reads from the terminal and prints the answer, so it's used as `answer=$(ask …)`. Without a terminal it
# stops the script; `flag` tells the caller what to pass instead.

# ask <question> [default] [flag]: with gum, the default is filled in, ready to edit.
ask() {
  local question=$1 default=${2:-} flag=${3:-} answer
  [[ $INTERACTIVE == 1 ]] || die "No terminal to ask \"$question\"${flag:+: pass $flag}."
  if [[ -n $GUM ]]; then
    answer=$(gum_prompt input --header "$question" --header.foreground 99 --value "$default" --placeholder "" \
      --char-limit 0)
    show_answer "$question" "${answer:-(none)}"
  elif [[ -n $default ]]; then
    read -r -p "$question [$default]: " answer
  else
    read -r -p "$question: " answer
  fi
  printf '%s' "${answer:-$default}"
}

# confirm <question> <y|n>: the default is what Enter answers, and what runs without a terminal.
confirm() {
  local question=$1 default=$2 answer hint="[y/N]" rc=0
  [[ $default == y ]] && hint="[Y/n]"
  if [[ $INTERACTIVE != 1 ]]; then
    [[ $default == y ]]
    return
  fi
  if [[ -n $GUM ]]; then
    # 1 is No, and also Esc; only Ctrl-C (130) gives up.
    "$GUM" confirm "$question" "--default=$([[ $default == y ]] && echo true || echo false)" || rc=$?
    if ((rc == 130)); then
      kill -INT 0
      exit 130
    fi
    show_answer "$question" "$( ((rc == 0)) && echo yes || echo no)"
    return "$rc"
  fi
  read -r -p "$question $hint " answer
  answer=${answer:-$default}
  [[ $answer == [yY]* ]]
}

# choose <question> <option>…: prints the chosen option's number, from 1.
choose() {
  local question=$1 i answer options=()
  shift
  [[ $INTERACTIVE == 1 ]] || die "No terminal to ask \"$question\"."
  if [[ -n $GUM ]]; then
    # `label<TAB>number`: gum shows the label and prints the number.
    for i in $(seq 1 $#); do options+=("${!i}"$'\t'"$i"); done
    answer=$(gum_prompt choose --header "$question" --label-delimiter $'\t' --height 15 "${options[@]}")
    show_answer "$question" "${!answer}"
    printf '%s' "$answer"
    return
  fi
  info "$question" >&2
  for i in $(seq 1 $#); do printf '  %s) %s\n' "$i" "${!i}" >&2; done
  while true; do
    read -r -p "> " answer
    if [[ $answer =~ ^[0-9]+$ ]] && ((answer >= 1 && answer <= $#)); then
      printf '%s' "$answer"
      return
    fi
    warn "Pick a number from 1 to $#."
  done
}

# ask_secret <question>: like ask, but the answer isn't shown while it's typed.
ask_secret() {
  local question=$1 answer
  [[ $INTERACTIVE == 1 ]] || die "No terminal to ask \"$question\"."
  if [[ -n $GUM ]]; then
    answer=$(gum_prompt input --header "$question" --header.foreground 99 --password --placeholder "" --char-limit 0)
    show_answer "$question" "$([[ -n $answer ]] && echo "(hidden)" || echo "(none)")"
    printf '%s' "$answer"
    return
  fi
  read -r -s -p "$question: " answer
  printf '\n' >&2
  printf '%s' "$answer"
}

# spin <title> <command…>: runs the command with a spinner. The command runs in the background with its stderr held
# back until it ends, so its messages don't tear through the spinner; gum only watches for it to finish. Nothing but
# the command writes to stdout, which callers redirect into files (a dump).
spin() {
  local title=$1 pid err rc=0
  shift
  if [[ -z $GUM ]]; then
    printf '%s%s…%s\n' "$DIM" "$title" "$RESET" >&2
    "$@"
    return
  fi
  err=$(mktemp)
  # `<&0`: a background command's stdin is /dev/null otherwise, and a restore streams its dump in through it.
  "$@" <&0 2>"$err" &
  pid=$!
  "$GUM" spin --title "$title" -- sh -c 'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done' sh "$pid" \
    </dev/tty || rc=$?
  if ((rc == 130)); then
    rm -f "$err"
    # Background jobs ignore SIGINT, so the command needs its own signal.
    kill "$pid" 2>/dev/null || true
    kill -INT 0
    exit 130
  fi
  rc=0
  wait "$pid" || rc=$?
  cat "$err" >&2
  rm -f "$err"
  return "$rc"
}

DOMAIN_RE='^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'

# `example.com` is reserved for examples (RFC 2606), so the example file's values, and any name under it, mean unset.
is_placeholder_domain() { [[ $1 == example.com || $1 == *.example.com ]]; }

ask_domain() {
  local question=$1 default=${2:-} domain
  while true; do
    domain=$(ask "$question" "$default")
    domain=${domain,,}
    if ! [[ $domain =~ $DOMAIN_RE ]]; then
      warn "\"$domain\" isn't a domain name like app.example.com."
    elif is_placeholder_domain "$domain"; then
      warn "$domain is the example's placeholder. Use your own domain."
    else
      printf '%s' "$domain"
      return
    fi
  done
}

pause() { read -r -p $'\nPress Enter for the menu… ' _ || true; }

# ===== Settings =====
# `.env` is only ever read line by line, never sourced: it's data, not a script.
# env_get <key> [file]: the last line wins, as in Compose.
env_get() {
  local file=${2:-$ENV_FILE}
  [[ -f $file ]] || return 0
  sed -n "s/^$1=//p" "$file" | tail -n 1
}

# Replaces the variable's line, or appends one. Keeps the file's permissions.
env_set() {
  local key=$1 value=$2 tmp
  tmp=$(mktemp)
  if grep -q "^$key=" "$ENV_FILE"; then
    K=$key V=$value awk 'index($0, ENVIRON["K"] "=") == 1 { print ENVIRON["K"] "=" ENVIRON["V"]; next } { print }' \
      "$ENV_FILE" >"$tmp"
  else
    cat "$ENV_FILE" >"$tmp"
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  cat "$tmp" >"$ENV_FILE"
  rm -f "$tmp"
}

# Hex only: secrets go inside the database URL and the store's JSON config, where `/`, `+`, `@` or quotes would break.
secret() { openssl rand -hex "${1:-32}"; }

# BACKUP_DIR as an absolute path; a relative one is relative to the project folder.
backup_dir() {
  local dir
  dir=$(env_get BACKUP_DIR)
  dir=${dir:-./backups}
  [[ $dir == /* ]] || dir="$ROOT/${dir#./}"
  printf '%s' "${dir%/}"
}

# Newest backups first, as `<epoch> <path>` lines.
list_backups() {
  find "$1" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'media-*.tar.gz' \) -printf '%T@ %p\n' 2>/dev/null |
    sort -nr || true
}

# ===== Settings Registry =====
# Every variable .env can hold, as KEY|kind|scope. Set up, Update and Settings check .env against it before each
# deploy: they fill in what the kind can generate and ask for the rest, so a missing value never first shows up as a
# failed Compose run. A new variable in `.env.production.example` needs an entry here, and a required one that can't be
# generated (a domain, an API key, an external URL) needs a kind that asks for it (docs/deployment.md → Adding a
# Variable). A key in the example but not here is asked for, with a warning that this list misses it.
#
#   domain        asked for; `example.com` and names under it count as unset
#   required      asked for; anything but empty (a third-party API key)
#   url           asked for; an http(s) URL (an external service)
#   secret:<n>[:<min>]
#                 generated (`openssl rand -hex <n>`). A value set by hand may only use letters, digits and `-._~`,
#                 since secrets go inside the database URL and the store's JSON config, where `/`, `+`, `@` or quotes
#                 would break them; and needs <min> characters where the app or the viewer refuses fewer
#   password:<n>  generated like a secret; any value of at least <n> characters
#   enum:<a,b,…>  one of these; empty takes the example's value
#   int           a whole number above 0; empty takes the example's value
#   default       anything; empty takes the example's value
#   optional      anything, empty too
#   derived       SENTRY_DSN, from ERROR_VIEWER_PUBLIC_KEY and ERRORS_DOMAIN
#
# Scope: `stack` is read by Compose, so changing it needs an Apply; `script` only by this script, so it never does.
SETTINGS=(
  "DOMAIN|domain|stack"
  "ERRORS_DOMAIN|domain|stack"
  "TLS_MODE|enum:auto,files|stack"
  "BACKUP_DIR|default|script"
  "BACKUP_KEEP|int|script"
  "LOG_LEVEL|enum:fatal,error,warn,info,debug,trace,silent|stack"
  "ERROR_VIEWER_PUBLIC_KEY|secret:16|stack"
  "ERROR_VIEWER_ADMIN_PASSWORD|password:12|stack"
  "ERROR_VIEWER_SESSION_SECRET|secret:32:32|stack"
  "SENTRY_DSN|derived|stack"
  "GOPROXY|optional|stack"
  "POSTGRES_PASSWORD|secret:32|stack"
  "BETTER_AUTH_SECRET|secret:32:32|stack"
  "ALTCHA_HMAC_KEY|secret:32:32|stack"
  "S3_BUCKET_NAME|default|stack"
  "S3_ACCESS_KEY|secret:16|stack"
  "S3_SECRET_KEY|secret:32|stack"
  "S3_ADMIN_ACCESS_KEY|secret:16|stack"
  "S3_ADMIN_SECRET_KEY|secret:32|stack"
  # Overrides `compose.prod.yaml` reads but the example leaves out; Compose has a default for each.
  "LOG_SLOW_REQUEST_MS|int|stack"
  "LOG_SLOW_QUERY_MS|int|stack"
  "LOG_QUERY_PARAMS|optional|stack"
)

declare -A SETTING_KIND=() SETTING_SCOPE=()
for _setting in "${SETTINGS[@]}"; do
  IFS='|' read -r _key _kind _scope <<<"$_setting"
  SETTING_KIND[$_key]=$_kind
  SETTING_SCOPE[$_key]=$_scope
done
unset _setting _key _kind _scope

# The example's keys in their order, and its values (the defaults).
EXAMPLE_KEYS=()
declare -A EXAMPLE_VALUES=()
load_example() {
  local line
  EXAMPLE_KEYS=()
  EXAMPLE_VALUES=()
  [[ -f $EXAMPLE_FILE ]] || return 0
  while IFS= read -r line; do
    if [[ $line =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      [[ -v EXAMPLE_VALUES[${BASH_REMATCH[1]}] ]] || EXAMPLE_KEYS+=("${BASH_REMATCH[1]}")
      EXAMPLE_VALUES[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}
    fi
  done <"$EXAMPLE_FILE"
}

# Keys Compose reads, sorted: the registry's stack keys, plus example keys the registry misses.
stack_keys() {
  local key
  load_example
  {
    for key in "${!SETTING_SCOPE[@]}"; do
      if [[ ${SETTING_SCOPE[$key]} == stack ]]; then echo "$key"; fi
    done
    for key in "${EXAMPLE_KEYS[@]}"; do
      if [[ -z ${SETTING_KIND[$key]-} ]]; then echo "$key"; fi
    done
  } | sort -u
}

# Secrets are never printed. Besides the generated kinds, a name like an API key's counts too.
is_secret_key() {
  case ${SETTING_KIND[$1]-} in
    secret:* | password:*) return 0 ;;
    *) [[ $1 =~ (SECRET|PASSWORD|KEY|TOKEN)$ ]] ;;
  esac
}

# ===== Reading .env =====
# Turns .env into what Compose reads, line for line: LF line endings, no trailing whitespace, no `export `, no spaces
# around `=`, a final newline. Quotes are dropped when nothing inside needs them, and so is an inline ` # comment` after
# an unquoted value (Compose drops it too). Comments and order stay. A key set twice keeps its last line, as Compose
# and env_get do; `normalize_stream 0` keeps every line, for counting them.
normalize_stream() {
  awk -v q="'" -v dedupe="${1:-1}" '
    { sub(/\r$/, ""); sub(/[ \t]+$/, "") }
    match($0, /^[ \t]*(export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=/) {
      key = substr($0, 1, RLENGTH)
      value = substr($0, RLENGTH + 1)
      sub(/^[ \t]*(export[ \t]+)?/, "", key)
      sub(/[ \t]*=$/, "", key)
      sub(/^[ \t]+/, "", value)
      first = substr(value, 1, 1)
      if (first == "\"" || first == q) {
        rest = substr(value, 2)
        end = index(rest, first)
        if (end > 0) {
          inner = substr(rest, 1, end - 1)
          after = substr(rest, end + 1)
          if (after ~ /^([ \t]+#.*)?$/ && inner !~ /[ \t"$\\`#]/ && index(inner, q) == 0) value = inner
        }
      } else {
        sub(/[ \t]+#.*$/, "", value)
      }
      n++
      out[n] = key "=" value
      keyof[n] = key
      last[key] = n
      next
    }
    { out[++n] = $0 }
    END { for (i = 1; i <= n; i++) if (!dedupe || !(i in keyof) || last[keyof[i]] == i) print out[i] }'
}

# Keys set more than once, space-separated.
env_duplicates() {
  normalize_stream 0 <"$1" | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' | sort | uniq -d | paste -sd' ' -
}

# Reads a file's settings, as Compose would see them, into ENV_VALUES.
declare -A ENV_VALUES=()
load_env() {
  local line
  ENV_VALUES=()
  [[ -f $1 ]] || return 0
  while IFS= read -r line; do
    if [[ $line =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then ENV_VALUES[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}; fi
  done < <(normalize_stream <"$1")
}

# Whether the database volume exists, i.e. Postgres has already set its password: it reads POSTGRES_PASSWORD only when
# it first creates the database. When Docker can't tell, it counts as existing: asking is safe, while a newly generated
# password would lock the app out.
pgdata_exists() {
  if [[ -z ${PGDATA_EXISTS-} ]]; then
    local project
    project=$(sed -n 's/^name:[[:space:]]*\([A-Za-z0-9_.-]*\).*/\1/p' "$ROOT/$COMPOSE_FILE" | head -n 1)
    project=${project:-$(basename "$ROOT")}
    if ! timeout 10 docker info >/dev/null 2>&1; then
      PGDATA_EXISTS=1
    elif timeout 10 docker volume inspect "${project,,}_pgdata" >/dev/null 2>&1; then
      PGDATA_EXISTS=1
    else
      PGDATA_EXISTS=0
    fi
  fi
  [[ $PGDATA_EXISTS == 1 ]]
}

# https://<ERROR_VIEWER_PUBLIC_KEY>@<ERRORS_DOMAIN>/1 from ENV_VALUES, or nothing while either isn't set yet.
expected_dsn() {
  local key=${ENV_VALUES[ERROR_VIEWER_PUBLIC_KEY]-} domain=${ENV_VALUES[ERRORS_DOMAIN]-}
  if [[ $key =~ ^[A-Za-z0-9_]+$ && $domain =~ $DOMAIN_RE ]] && ! is_placeholder_domain "$domain"; then
    printf 'https://%s@%s/1' "$key" "$domain"
  fi
}

# ===== Checking .env =====
# A problem is a `KEY|fix|state|reason` line. fix: `gen` (filled in without asking), `ask` (needs an answer) or `warn`
# (only said). state: `missing`, `invalid` or `warn`, for the status line. Reasons never contain a secret's value.

# Compose expands `$` and treats quotes, `#` and spaces specially, so a stack value with them isn't what it looks like.
UNSAFE_RE='[[:space:]$"'\''`#\\]'

# validate_setting <key> <value> <in example: 0|1>. Cross-checks read the other values from ENV_VALUES.
validate_setting() {
  local key=$1 value=$2 in_example=$3 kind scope n default
  kind=${SETTING_KIND[$key]-}
  scope=${SETTING_SCOPE[$key]-stack}
  default=${EXAMPLE_VALUES[$key]-}

  if [[ -n $value && $scope == stack && $value =~ $UNSAFE_RE ]]; then
    echo "$key|ask|invalid|has a space, quote, \$, # or backslash, which Compose reads differently"
    return
  fi

  case $kind in
    domain)
      if [[ -z $value ]] || is_placeholder_domain "$value"; then
        echo "$key|ask|missing|not set"
      elif ! [[ $value =~ $DOMAIN_RE ]]; then
        echo "$key|ask|invalid|isn't a lowercase domain name like app.example.com"
      elif [[ $key == ERRORS_DOMAIN && $value == "${ENV_VALUES[DOMAIN]-}" ]]; then
        echo "$key|ask|invalid|is the same as DOMAIN: the error viewer needs its own"
      fi
      ;;
    secret:* | password:*)
      # secret:<n>:<min> → min; password:<n> → n.
      n=${kind#*:}
      if [[ $kind == secret:* && $n == *:* ]]; then
        n=${n#*:}
      elif [[ $kind == secret:* ]]; then
        n=0
      fi
      if [[ -z $value ]]; then
        if [[ $key == POSTGRES_PASSWORD ]] && pgdata_exists; then
          echo "$key|ask|missing|empty, and the database already exists: it needs the password it was created with"
        else
          echo "$key|gen|missing|empty (generated when applied)"
        fi
      elif [[ $kind == secret:* && ! $value =~ ^[A-Za-z0-9._~-]+$ ]]; then
        echo "$key|ask|invalid|has characters that break the database URL or the store's config (use openssl rand -hex 32)"
      elif [[ $key == ERROR_VIEWER_PUBLIC_KEY && ! $value =~ ^[A-Za-z0-9_]+$ ]]; then
        echo "$key|ask|invalid|may only use letters, digits and _ (the Sentry SDKs drop the DSN otherwise)"
      elif ((${#value} < n)); then
        echo "$key|ask|invalid|is shorter than $n characters"
      fi
      ;;
    enum:* | int | default)
      if [[ -z $value ]]; then
        # Without a default in the example, Compose's own applies.
        if [[ -n $default ]]; then echo "$key|gen|missing|empty (\"$default\", the example's, when applied)"; fi
      elif [[ $kind == enum:* && ",${kind#enum:}," != *",$value,"* ]]; then
        local values=${kind#enum:}
        echo "$key|ask|invalid|isn't one of ${values//,/, }"
      elif [[ $kind == int && ! $value =~ ^[1-9][0-9]*$ ]]; then
        echo "$key|ask|invalid|isn't a whole number above 0"
      elif [[ $key == S3_BUCKET_NAME && ! $value =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
        echo "$key|ask|invalid|isn't a bucket name (3 to 63 lowercase letters, digits, dots and dashes)"
      fi
      ;;
    required)
      if [[ -z $value ]]; then echo "$key|ask|missing|not set"; fi
      ;;
    url)
      if [[ -z $value ]]; then
        echo "$key|ask|missing|not set"
      elif ! [[ $value =~ ^https?://[^/]+ ]]; then
        echo "$key|ask|invalid|isn't an http:// or https:// URL"
      fi
      ;;
    optional) ;;
    derived)
      local expected
      expected=$(expected_dsn)
      if [[ -z $value ]]; then
        echo "$key|warn|warn|is empty, so error reporting is off"
      elif ! [[ $value =~ ^https?://[^/@]+@[^/]+/[0-9]+$ ]]; then
        echo "$key|ask|invalid|isn't a DSN like https://<key>@<errors domain>/1"
      elif [[ -n $expected && $value != "$expected" ]]; then
        echo "$key|warn|warn|doesn't point at this server's error viewer"
      fi
      ;;
    "")
      if ((in_example)); then
        echo "$key|warn|warn|is in .env.production.example but not in deploy/deploy.sh's settings registry"
        if [[ -z $value ]]; then echo "$key|ask|missing|not set"; fi
      elif [[ $key != COMPOSE_* ]]; then
        echo "$key|warn|warn|isn't a known setting (a typo?)"
      fi
      ;;
    *) echo "$key|warn|warn|has an unknown kind ($kind) in deploy/deploy.sh's settings registry" ;;
  esac
}

# env_problems <file>: every problem in the file, in the example's order, then the keys the example doesn't have.
env_problems() {
  local file=$1 key keys=() fix line
  load_example
  load_env "$file"

  for key in "${EXAMPLE_KEYS[@]}"; do
    if [[ -v ENV_VALUES[$key] ]]; then
      validate_setting "$key" "${ENV_VALUES[$key]}" 1
      continue
    fi
    # Not in .env yet (added to the example since): check_env appends it with the example's value.
    fix=ask
    line=$(validate_setting "$key" "${EXAMPLE_VALUES[$key]}" 1 | grep -v '|warn|' || true)
    if [[ -z $line || $line == "$key|gen|"* ]]; then fix=gen; fi
    echo "$key|$fix|missing|not in .env yet (new in .env.production.example)"
  done
  for key in $(printf '%s\n' "${!ENV_VALUES[@]}" | sort); do
    if [[ ! -v EXAMPLE_VALUES[$key] ]]; then keys+=("$key"); fi
  done
  for key in "${keys[@]}"; do validate_setting "$key" "${ENV_VALUES[$key]}" 0; done

  # Compose refuses the whole file over one line it can't parse.
  { normalize_stream 0 <"$file" | grep -nvE '^[[:space:]]*(#.*)?$|^[A-Za-z_][A-Za-z0-9_]*=' || true; } | cut -d: -f1 |
    while IFS= read -r line; do echo "line $line|ask|invalid|isn't KEY=value, so Compose can't read .env"; done
}

# Rewrites .env as normalize_stream does, after a confirm when that drops duplicates.
normalize_env() {
  local tidy dups
  tidy=$(mktemp "$ROOT/.env.tidy.XXXXXX")
  normalize_stream <"$ENV_FILE" >"$tidy"
  if cmp -s "$tidy" "$ENV_FILE"; then
    rm -f "$tidy"
    return 0
  fi
  dups=$(env_duplicates "$ENV_FILE")
  if [[ -n $dups ]]; then
    warn "Set more than once in .env: $dups. The last line counts, for Compose too."
    if [[ $INTERACTIVE == 1 ]] && ! confirm "Remove the earlier lines?" y; then
      rm -f "$tidy"
      die "Left .env as it was. Remove the lines you don't want, then run this again."
    fi
  fi
  cat "$tidy" >"$ENV_FILE"
  rm -f "$tidy"
  ok "Tidied .env (line endings, spacing, export, quotes${dups:+, duplicates})"
}

# Appends the example's keys that .env doesn't have, each with the comment block above it in the example.
append_new_keys() {
  [[ -f $EXAMPLE_FILE ]] || return 0
  local present added
  present=$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$ENV_FILE" | paste -sd' ' -)
  # `block` is the comment above the current run of keys; `prev` is set while the previous key was appended too, so a
  # run of new keys stays together under one comment, as in the example.
  added=$(awk -v present=" $present " '
    /^#/ {
      if (inkeys) { block = ""; inkeys = 0 }
      block = block $0 "\n"
      next
    }
    /^[A-Za-z_][A-Za-z0-9_]*=/ {
      key = substr($0, 1, index($0, "=") - 1)
      if (index(present, " " key " ") == 0) {
        if (prev) printf "%s", (inkeys ? "" : block)
        else printf "\n%s", block
        print
        prev = 1
      } else {
        prev = 0
      }
      inkeys = 1
      next
    }
    { block = ""; inkeys = 0; prev = 0 }' "$EXAMPLE_FILE")
  [[ -n $added ]] || return 0
  printf '%s\n' "$added" >>"$ENV_FILE"
  info "Added from .env.production.example: $(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' <<<"$added" | paste -sd, - | sed 's/,/, /g')"
}

# The value check_env fills in for a `gen` problem.
generated_value() {
  case ${SETTING_KIND[$1]-} in
    secret:* | password:*)
      local bytes=${SETTING_KIND[$1]#*:}
      secret "${bytes%%:*}"
      ;;
    *) printf '%s' "${EXAMPLE_VALUES[$1]-}" ;;
  esac
}

# Points SENTRY_DSN at this server's error viewer: always when the key was just generated, else after asking. Each
# mismatch is raised once per run (DSN_RAISED), not on every pass of check_env.
DSN_RAISED=""
sync_dsn() {
  local key_generated=$1 expected dsn
  load_env "$ENV_FILE"
  expected=$(expected_dsn)
  dsn=${ENV_VALUES[SENTRY_DSN]-}
  [[ -n $expected && $dsn != "$expected" && $expected != "$DSN_RAISED" ]] || return 0
  if ((key_generated)); then
    env_set SENTRY_DSN "$expected"
    ok "SENTRY_DSN points at this server's error viewer."
    return
  fi
  DSN_RAISED=$expected
  if [[ -z $dsn ]]; then
    warn "SENTRY_DSN is empty, so error reporting is off."
    return
  fi
  warn "SENTRY_DSN doesn't point at this server's error viewer (https://<ERROR_VIEWER_PUBLIC_KEY>@<ERRORS_DOMAIN>/1)."
  if [[ $INTERACTIVE == 1 ]] && confirm "Point it there?" y; then
    env_set SENTRY_DSN "$expected"
    ok "SENTRY_DSN updated."
  fi
}

# Asks for one setting, in the way its kind needs, until the answer passes validate_setting.
answer_setting() {
  local key=$1 kind value line options n default explained=0
  kind=${SETTING_KIND[$key]-}
  while true; do
    load_example
    load_env "$ENV_FILE"
    case $kind in
      domain)
        if [[ $key == ERRORS_DOMAIN ]]; then
          default=""
          if [[ ${ENV_VALUES[DOMAIN]-} =~ $DOMAIN_RE ]]; then default="errors.${ENV_VALUES[DOMAIN]}"; fi
          value=$(ask_domain "Error viewer domain (ERRORS_DOMAIN)" "$default")
        else
          value=$(ask_domain "Site domain ($key, e.g. app.example.com)")
        fi
        ;;
      enum:*)
        IFS=, read -r -a options <<<"${kind#enum:}"
        n=$(choose "$key:" "${options[@]}")
        value=${options[n - 1]}
        ;;
      secret:* | password:*)
        if [[ $key == POSTGRES_PASSWORD ]] && pgdata_exists; then
          if ((explained == 0)); then
            info "The database already exists, and Postgres only reads POSTGRES_PASSWORD when it creates it: a new"
            info "password would lock the app out. Enter the original one (from your copy of .env)."
            explained=1
          fi
          value=$(ask_secret "Original POSTGRES_PASSWORD")
        else
          value=$(ask_secret "$key (Enter to generate one)")
          [[ -n $value ]] || value=$(generated_value "$key")
        fi
        ;;
      derived)
        value=$(ask "$key" "$(expected_dsn)")
        ;;
      *)
        if is_secret_key "$key"; then
          value=$(ask_secret "$key")
        else
          value=$(ask "$key" "${EXAMPLE_VALUES[$key]-}")
        fi
        ;;
    esac
    line=$(validate_setting "$key" "$value" 1 | grep '|ask|' | head -n 1 || true)
    if [[ -z $line ]]; then
      env_set "$key" "$value"
      return
    fi
    warn "$key ${line##*|}."
  done
}

# join_comma <item>…: `a, b, c`, without duplicates.
join_comma() { printf '%s\n' "$@" | awk '!seen[$0]++' | paste -sd, - | sed 's/,/, /g'; }

# Prints problems as an indented list.
print_problems() {
  local key _fix _state reason
  while IFS='|' read -r key _fix _state reason; do
    if [[ -n $key ]]; then printf '    %-30s %s\n' "$key" "$reason" >&2; fi
  done <<<"$1"
}

# Brings .env in line with the registry before a deploy: tidies it, appends keys new in the example, fills in what
# can be generated and asks for the rest (here, or in the editor). Without a terminal it stops instead of asking and
# names each key; CHECK_FAILED_NOTE, when set, is added to that message.
CHECK_FAILED_NOTE=""
check_env() {
  [[ -w $ENV_FILE ]] || die "Can't write to .env. Fix its owner: sudo chown $(id -u) $ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || warn "Can't make .env private (chmod 600): its owner is another user."
  normalize_env
  append_new_keys

  local problems asks key fix _state _reason generated defaults key_generated=0 warned=0 answerable options n
  while true; do
    # ------ Fill In ------
    load_example
    problems=$(env_problems "$ENV_FILE")
    generated=() defaults=()
    while IFS='|' read -r key fix _state _reason; do
      [[ $fix == gen ]] || continue
      env_set "$key" "$(generated_value "$key")"
      if is_secret_key "$key"; then generated+=("$key"); else defaults+=("$key=${EXAMPLE_VALUES[$key]-}"); fi
      if [[ $key == ERROR_VIEWER_PUBLIC_KEY ]]; then key_generated=1; fi
    done <<<"$problems"
    if ((${#generated[@]})); then ok "Generated $(join_comma "${generated[@]}")"; fi
    if ((${#defaults[@]})); then ok "Set to the example's defaults: $(join_comma "${defaults[@]}")"; fi
    sync_dsn "$key_generated"

    # ------ Report ------
    problems=$(env_problems "$ENV_FILE")
    if ((warned == 0)); then
      warned=1
      while IFS='|' read -r key fix _state _reason; do
        if [[ $fix == warn && $key != SENTRY_DSN ]]; then warn "$key $_reason."; fi
      done <<<"$problems"
    fi
    asks=$(grep '^[^|]*|ask|' <<<"$problems" || true)
    if [[ -z $asks ]]; then
      ok ".env has every setting."
      return 0
    fi
    warn "These settings need a value:"
    print_problems "$asks"
    if [[ $INTERACTIVE != 1 ]]; then
      mapfile -t answerable < <(cut -d'|' -f1 <<<"$asks" | awk '!seen[$0]++')
      die "Can't deploy until .env is fixed: $(join_comma "${answerable[@]}"). Set the values in .env (or run deploy/deploy.sh env on a terminal), then deploy/deploy.sh apply.${CHECK_FAILED_NOTE:+
$CHECK_FAILED_NOTE}"
    fi

    # ------ Ask ------
    # Only keys can be answered here; a line Compose can't parse needs the editor.
    mapfile -t answerable < <(cut -d'|' -f1 <<<"$asks" | grep -E '^[A-Za-z_][A-Za-z0-9_]*$' | awk '!seen[$0]++' || true)
    options=()
    if ((${#answerable[@]})); then options+=("Answer here"); fi
    options+=("Open .env in your editor" "Stop")
    n=$(choose "How do you want to set them?" "${options[@]}")
    case ${options[n - 1]} in
      "Answer here")
        for key in "${answerable[@]}"; do answer_setting "$key"; done
        ;;
      "Open .env in your editor") edit_env ;;
      *) die "Stopped. .env still needs a value for the settings above.${CHECK_FAILED_NOTE:+ $CHECK_FAILED_NOTE}" ;;
    esac
  done
}

# ===== Editing .env =====
# The system's terminal editor, not $EDITOR: a graphical one (`code`) returns at once, before the file is saved, and
# nano or vi always block until they close.
pick_editor() {
  if command -v nano >/dev/null; then
    echo nano
  elif command -v vi >/dev/null; then
    echo vi
  else
    die "No terminal editor here (looked for nano and vi). Install one: sudo apt install nano"
  fi
}

# list_env_changes <old file> <new file>: the keys whose values differ, with secrets masked.
list_env_changes() {
  local -A old=()
  local key keys=() shown=0
  load_env "$1"
  for key in "${!ENV_VALUES[@]}"; do old[$key]=${ENV_VALUES[$key]}; done
  load_env "$2"
  mapfile -t keys < <(printf '%s\n' "${!old[@]}" "${!ENV_VALUES[@]}" | sort -u)
  for key in "${keys[@]}"; do
    [[ -n $key ]] || continue
    if [[ ! -v old[$key] ]]; then
      printf '    %-30s added\n' "$key"
    elif [[ ! -v ENV_VALUES[$key] ]]; then
      printf '    %-30s removed\n' "$key"
    elif [[ ${old[$key]} == "${ENV_VALUES[$key]}" ]]; then
      continue
    elif is_secret_key "$key"; then
      printf '    %-30s changed (hidden)\n' "$key"
    else
      printf '    %-30s %s → %s\n' "$key" "${old[$key]:-(empty)}" "${ENV_VALUES[$key]:-(empty)}"
    fi
    shown=1
  done
  if ((shown == 0)); then info "    only comments or layout"; fi
}

# Opens a copy of .env in the terminal's editor and, once the editor closes, tidies and checks it, then puts it in
# place of .env in one step (a rename). Editing a copy means a half-done edit or a Ctrl-C never leaves .env broken.
# Sets ENV_EDITED=1 when .env changed; it always returns 0, so callers don't run it as a condition, where `set -e`
# wouldn't apply inside it.
ENV_EDITED=0
edit_env() {
  ENV_EDITED=0
  [[ $INTERACTIVE == 1 ]] ||
    die "No terminal for an editor. Edit .env by hand, then check it with deploy/deploy.sh env --check"
  local editor copy dups problems old_pg new_pg exit_trap
  editor=$(pick_editor)
  copy=$(umask 077 && mktemp "$ROOT/.env.edit.XXXXXX")
  # Set up may have one already (install_cert's), put back below.
  exit_trap=$(trap -p EXIT)
  # shellcheck disable=SC2064 # `copy` is meant to be expanded now.
  trap "rm -f '$copy' '$copy.tidy'" EXIT
  trap 'exit 130' INT TERM HUP
  cat "$ENV_FILE" >"$copy"

  while true; do
    if [[ $editor == nano ]]; then
      info "${DIM}Opening .env in nano. Ctrl-O Enter saves, Ctrl-X closes.${RESET}"
    else
      info "${DIM}Opening .env in vi. :wq saves and closes, :q! closes without saving.${RESET}"
    fi
    if ! "$editor" "$copy" </dev/tty >/dev/tty; then
      warn "The editor exited with an error, so .env is unchanged."
      break
    fi

    # ------ Compare ------
    if cmp -s "$copy" "$ENV_FILE"; then
      info "No changes."
      break
    fi
    dups=$(env_duplicates "$copy")
    normalize_stream <"$copy" >"$copy.tidy"
    cat "$copy.tidy" >"$copy"
    if cmp -s "$copy" "$ENV_FILE"; then
      info "No changes."
      break
    fi
    step "Changes"
    list_env_changes "$ENV_FILE" "$copy"

    # ------ Check ------
    problems=$(env_problems "$copy" | grep '^[^|]*|ask|' || true)
    if [[ -n $dups ]]; then
      problems+=${problems:+$'\n'}"$dups|ask|invalid|set more than once: only the last line is kept"
    fi
    old_pg=$(env_get POSTGRES_PASSWORD "$ENV_FILE")
    new_pg=$(env_get POSTGRES_PASSWORD "$copy")
    if [[ -n $old_pg && -n $new_pg && $old_pg != "$new_pg" ]] && pgdata_exists; then
      problems+=${problems:+$'\n'}"POSTGRES_PASSWORD|ask|invalid|changed, but Postgres keeps the password the database was created with: change it there too (ALTER USER app PASSWORD '…'), or the app is locked out"
    fi
    if [[ -z $problems ]]; then
      save_edited_env "$copy"
      break
    fi
    warn "The edited .env has problems:"
    print_problems "$problems"
    case $(choose "What now?" "Edit again" "Save anyway" "Discard the changes") in
      1) continue ;;
      2)
        save_edited_env "$copy"
        break
        ;;
      3)
        info "Discarded: .env is unchanged."
        break
        ;;
    esac
  done
  rm -f "$copy" "$copy.tidy"
  trap - EXIT INT TERM HUP
  if [[ -n $exit_trap ]]; then eval "$exit_trap"; fi
}

save_edited_env() {
  chmod 600 "$1"
  # A rename replaces a symlink rather than writing through it, so a linked .env is written in place instead.
  if [[ -L $ENV_FILE ]]; then
    cat "$1" >"$ENV_FILE"
    rm -f "$1"
  else
    mv -f "$1" "$ENV_FILE"
  fi
  ENV_EDITED=1
  ok "Saved .env"
}

# ===== Applied State =====
# A fingerprint of what Compose reads from .env: the sorted KEY=value pairs of the stack keys, so comments, order,
# spacing and the backup settings never count as a change. Every deploy records it with its time in .env.applied;
# when .env's differs, an edit is waiting for Apply.
env_fingerprint() {
  normalize_stream <"$1" | awk -v keys="$(stack_keys | paste -sd' ' -)" '
    BEGIN { n = split(keys, k, " "); for (i = 1; i <= n; i++) want[k[i]] = 1 }
    match($0, /^[A-Za-z_][A-Za-z0-9_]*=/) {
      key = substr($0, 1, RLENGTH - 1)
      if (key in want) value[key] = substr($0, RLENGTH + 1)
    }
    END { for (i = 1; i <= n; i++) print k[i] "=" value[k[i]] }' | sha256sum | cut -d' ' -f1
}

# record_applied [fingerprint]: the one taken before the deploy started, so an edit made during the build stays pending.
record_applied() {
  local fingerprint=${1:-}
  [[ -n $fingerprint ]] || fingerprint=$(env_fingerprint "$ENV_FILE")
  (umask 077 && printf '%s %s\n' "$fingerprint" "$(date +%s)" >"$APPLIED_FILE")
}

# applied | pending | untracked (deployed before .env.applied existed, or never).
settings_state() {
  local fingerprint=""
  if [[ -f $APPLIED_FILE ]]; then read -r fingerprint _ <"$APPLIED_FILE" || true; fi
  if [[ -z $fingerprint ]]; then
    echo untracked
  elif [[ $fingerprint == "$(env_fingerprint "$ENV_FILE")" ]]; then
    echo applied
  else
    echo pending
  fi
}

# ===== Docker =====
dc() { docker compose --project-directory "$ROOT" -f "$ROOT/$COMPOSE_FILE" "$@"; }

is_checkout() { [[ -f $ROOT/$COMPOSE_FILE ]] && git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; }
is_set_up() { is_checkout && [[ -f $ENV_FILE ]]; }

require_tools() {
  local missing=() tool version
  for tool in git docker openssl curl; do
    command -v "$tool" >/dev/null || missing+=("$tool")
  done
  ((${#missing[@]} == 0)) || die "Missing: ${missing[*]}. Install them, then run this again."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 isn't installed (\`docker compose version\` failed)."
  version=$(docker compose version --short)
  version=${version#v}
  [[ $(printf '%s\n' "$MIN_COMPOSE" "$version" | sort -V | head -n 1) == "$MIN_COMPOSE" ]] ||
    die "Docker Compose $version is too old: the stack needs $MIN_COMPOSE or later."
  docker info >/dev/null 2>&1 ||
    die "Can't reach Docker. Is it running, and is $(whoami) in the docker group (or run this with sudo)?"
}

# healthy | unhealthy | starting for a running container with a health check, else running | exited | restarting | …;
# missing when it's gone. A stopped container keeps its last health status, so that only counts while it runs.
id_state() {
  local format='{{if not .State.Running}}{{.State.Status}}'
  format+='{{else if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}'
  docker inspect -f "$format" "$1" 2>/dev/null || echo missing
}

# A service's state, as id_state; missing when it has no container (or there's no stack yet).
container_state() {
  local id
  id=$(dc ps -a -q "$1" 2>/dev/null | head -n 1 || true)
  if [[ -z $id ]]; then
    echo missing
    return
  fi
  id_state "$id"
}

# wait_healthy <service> [seconds]. An unhealthy container may still recover inside the wait, so only a stopped one
# ends it early.
wait_healthy() {
  local service=$1 timeout=${2:-180} waited=0
  while ((waited < timeout)); do
    case $(container_state "$service") in
      healthy | running) return 0 ;;
      exited | dead | missing) return 1 ;;
    esac
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

# wait_container <id> [seconds]: wait_healthy for one container.
wait_container() {
  local id=$1 timeout=${2:-180} waited=0
  while ((waited < timeout)); do
    case $(id_state "$id") in
      healthy | running) return 0 ;;
      exited | dead | missing) return 1 ;;
    esac
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

# Builds the images and starts the stack. A running, healthy app is replaced without downtime (rollout_app); otherwise
# (the first deploy, or an app that's down anyway) Compose starts everything at once. Either way `migrate` and
# `storage-init` run before the new app starts, and a failed build or migration leaves the running app and the database
# as they were. Always a build: SENTRY_DSN is a build argument of the browser bundle, so an .env change can need a new
# image.
deploy_stack() {
  # Docker would create a missing bind-mount folder as root, which this script then couldn't write certificates into.
  mkdir -p "$CERT_DIR"
  local log fingerprint rolling=0 service others=() image
  fingerprint=$(env_fingerprint "$ENV_FILE")
  if [[ $(container_state app) == healthy ]]; then rolling=1; fi

  # ------ Build ------
  step "Building"
  log=$(mktemp)
  if ! dc build 2>&1 | tee "$log"; then
    # Where Google blocks the region, the error viewer's build gets 403 from Go's module proxy (docs/deployment.md).
    if grep -q 'proxy.golang.org.*403 Forbidden' "$log"; then
      rm -f "$log"
      die "This server can't download Go modules from proxy.golang.org. Set GOPROXY in .env to a mirror it can reach
(e.g. GOPROXY=https://goproxy.cn): choose Settings, edit .env, then apply (deploy/deploy.sh apply)."
    fi
    rm -f "$log"
    die "The build failed (see above). Nothing that was running was replaced. Once it's fixed, choose Settings → Apply
(deploy/deploy.sh apply)."
  fi
  rm -f "$log"
  image=$(app_image)
  docker tag "$image" "$image:$(checkout_version)"

  if ((rolling)); then
    # ------ Everything But the App ------
    # `--no-deps`, so Compose leaves the app alone: only rollout_app replaces it.
    step "Updating the other services"
    for service in "${SERVICES[@]}"; do [[ $service == app ]] || others+=("$service"); done
    dc up -d --no-deps --remove-orphans "${others[@]}" ||
      die "Starting the other services failed (see above). The app that was running still runs."

    step "Running migrations"
    dc run --rm -T migrate </dev/null && dc run --rm -T storage-init </dev/null ||
      die "The migration or the bucket setup failed (see above). The app that was running still runs, and pending
migrations run in one transaction, so the database is as it was. Once it's fixed, choose Settings → Apply."

    rollout_app ||
      die "Migrations the new version ran stay applied (Update's pre-update dump has the database from before them).
Once it's fixed, choose Settings → Apply (deploy/deploy.sh apply)."
    record_applied "$fingerprint"
  else
    # ------ Everything at Once ------
    step "Starting the stack"
    dc up -d --remove-orphans ||
      die "The deploy stopped (see above). A failed migration leaves the database as it was. Once it's fixed, choose
Settings → Apply (deploy/deploy.sh apply)."
    # The containers now run with this .env, even if the app turns out unhealthy below.
    record_applied "$fingerprint"
    spin "Waiting for the app to turn healthy" wait_healthy app ||
      die "The app didn't turn healthy. Its logs: deploy/deploy.sh logs app. Once it's fixed, choose Settings → Apply."
  fi
  ok "App is healthy"

  # ------ Caddy and the Error Viewer ------
  # Compose recreates Caddy only when its own config changes, not the mounted Caddyfile. A reload applies an edited
  # Caddyfile without dropping connections, and does nothing when it's unchanged.
  if [[ $(container_state caddy) == running ]]; then
    dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null >/dev/null 2>&1 ||
      warn "Caddy didn't reload its Caddyfile. Its logs: deploy/deploy.sh logs caddy"
  fi
  if spin "Waiting for the error viewer" wait_healthy error-viewer 60; then
    ok "Error viewer is healthy"
  else
    warn "The error viewer didn't turn healthy. Its logs: deploy/deploy.sh logs error-viewer"
  fi

  prune_versions "$image"
  # Each build leaves the previous images behind, untagged; on a small disk they add up. Only this stack's: Compose
  # labels what it builds with the project, and other projects' untagged images on the server aren't ours to remove.
  local project
  project=$(dc config --format json | sed -n 's/^{"name":"\([^"]*\)".*/\1/p')
  if [[ -n $project ]]; then
    docker image prune -f --filter "label=com.docker.compose.project=$project" >/dev/null
  fi
}

# Replaces the running app without downtime: a new app container starts beside the old one, and the old one stops once
# the new one is healthy. Caddy proxies to `app`, which Docker's DNS resolves to every running app container, so
# requests reach whichever is up; the old one finishes what it's serving on SIGTERM. A new container that doesn't turn
# healthy is removed and the old one keeps serving (returns 1). The steps of docker-rollout
# (github.com/wowu/docker-rollout), without installing it.
rollout_app() {
  local old new count old_ids
  old=$(dc ps -q app)
  count=$(grep -c . <<<"$old")

  step "Starting the new app beside the old one"
  # `--no-recreate` keeps the old container as it is; the larger scale adds one on the new image.
  if ! dc up -d --no-deps --no-recreate --scale "app=$((count + 1))" app; then
    warn "The new app didn't start (see above). The old one still serves."
    return 1
  fi
  new=$(dc ps -q app | grep -vxF "$old" | head -n 1 || true)
  if [[ -z $new ]]; then
    warn "Compose started no new app container. The old one still serves."
    return 1
  fi

  if ! spin "Waiting for the new app to turn healthy" wait_container "$new"; then
    docker logs --tail 30 "$new" 2>&1 || true
    docker rm -f "$new" >/dev/null
    warn "The new app didn't turn healthy (its last log lines are above), so it was removed: the old one still serves."
    return 1
  fi

  # Callers test the result, which turns `set -e` off in here: every failure is handled explicitly.
  step "Stopping the old app"
  mapfile -t old_ids <<<"$old"
  docker stop "${old_ids[@]}" >/dev/null && docker rm "${old_ids[@]}" >/dev/null ||
    warn "The old app container didn't stop cleanly (see above); the new one serves. Remove the old one:
  docker rm -f ${old_ids[*]}"
}

# ===== Versions =====
# Every build tags the app's image with the commit it was built from (`template-app:381286c`), next to the `latest` tag
# Compose runs. Roll back points `latest` at an older tag and replaces the app with it; the newest KEEP_VERSIONS stay.

checkout_version() { git -C "$ROOT" rev-parse --short=7 HEAD; }

# The app's image name, as `image:` in compose.prod.yaml sets it. Read from Compose's resolved config, where each
# service is a two-space-indented key under `services:`.
app_image() {
  dc config | awk '/^services:/ { s = 1; next } s && /^[^ ]/ { exit } s && /^  [^ ]/ { svc = $1 }
    svc == "app:" && /^    image:/ { print $2; exit }'
}

# The kept versions, newest first, as `<tag> <built, e.g. "2 days ago">` lines.
list_versions() {
  docker image ls "$1" --format '{{.Tag}} {{.CreatedSince}}' | grep -v '^latest \|^<none> ' || true
}

# The version the app container runs: the tag of its image, other than `latest`. Empty without a container, or for an
# image built before versions were tagged.
running_version() {
  local id image_id image
  id=$(dc ps -a -q app 2>/dev/null | head -n 1 || true)
  [[ -n $id ]] || return 0
  image_id=$(docker inspect -f '{{.Image}}' "$id")
  image=$(docker inspect -f '{{.Config.Image}}' "$id")
  docker image ls "${image%:*}" --no-trunc --format '{{.ID}} {{.Tag}}' |
    awk -v id="$image_id" '$1 == id && $2 != "latest" && $2 != "<none>" { print $2; exit }'
}

# Removes the tags beyond the newest KEEP_VERSIONS, never the running one or the one `latest` points at. The image
# goes with its last tag.
prune_versions() {
  local image=$1 running latest_id tag _
  running=$(running_version)
  latest_id=$(docker image inspect -f '{{.Id}}' "$image" 2>/dev/null || true)
  list_versions "$image" | tail -n +$((KEEP_VERSIONS + 1)) | while read -r tag _; do
    [[ $tag != "$running" && $(docker image inspect -f '{{.Id}}' "$image:$tag") != "$latest_id" ]] || continue
    docker rmi "$image:$tag" >/dev/null || true
  done
}

# ===== Ports =====
# Prints what listens on the port: nothing when it's free, a process name, or `unknown` when `ss` can't tell (another
# user's process, without root).
port_owner() {
  local line name
  if ! command -v ss >/dev/null; then
    echo unknown
    return
  fi
  line=$(ss -Hltnp "sport = :$1" 2>/dev/null | head -n 1 || true)
  [[ -n $line ]] || return 0
  name=$(grep -o 'users:(("[^"]*"' <<<"$line" | sed 's/^users:(("//; s/"$//' || true)
  printf '%s' "${name:-unknown}"
}

# Caddy needs 80 and 443. Another web server on them (one that came with the VPS image) is the most common reason a
# first deploy fails, so setup checks before building.
check_ports_free() {
  local port owner
  for port in 80 443; do
    owner=$(port_owner "$port")
    case $owner in
      "" | docker-proxy) ;;
      unknown) warn "Port $port is in use, and it's not clear by what. Caddy needs it." ;;
      *) die "Port $port is in use by $owner. Caddy needs it: stop that first (e.g. sudo systemctl disable --now $owner)." ;;
    esac
  done
}

# ===== Certificates =====
# Finds the certificate, its key and its intermediates among the files in a folder, checks them, and copies them to
# `certs/` as `fullchain.pem` and `key.pem`. Files are recognized by their contents, not their names, since certificate
# folders come in every layout. The original files are never changed.

CERT_FILES=()
CERT_SOURCES=()

# Splits a PEM or DER file into one file per certificate in `work`, remembering where each came from.
split_certs() {
  local src=$1 work=$2 pem line block="" inside=0 out
  if grep -q -- '-----BEGIN CERTIFICATE-----' "$src" 2>/dev/null; then
    pem=$(cat "$src")
  elif ! pem=$(openssl x509 -inform DER -in "$src" 2>/dev/null); then
    return 0
  fi
  while IFS= read -r line; do
    line=${line%$'\r'}
    if [[ $line == '-----BEGIN CERTIFICATE-----' ]]; then
      inside=1
      block=""
    fi
    if ((inside)); then block+="$line"$'\n'; fi
    if [[ $line == '-----END CERTIFICATE-----' ]]; then
      inside=0
      out="$work/cert-${#CERT_FILES[@]}.pem"
      printf '%s' "$block" >"$out"
      CERT_FILES+=("$out")
      CERT_SOURCES+=("$src")
    fi
  done <<<"$pem"
}

# openssl's output is captured before matching: `openssl … | grep -q` can fail under pipefail when grep stops reading
# early.
cert_field() { openssl x509 -in "$1" -noout "-$2" -nameopt RFC2253 | sed "s/^$2=//"; }
cert_is_ca() { [[ $(openssl x509 -in "$1" -noout -text) == *"CA:TRUE"* ]]; }
cert_covers() { [[ $(openssl x509 -in "$1" -noout -checkhost "$2") == *"does match"* ]]; }
cert_names() {
  openssl x509 -in "$1" -noout -text | grep -o 'DNS:[^,]*' | sed 's/^DNS://' | paste -sd, - | sed 's/,/, /g' || true
}
cert_cn() { cert_field "$1" subject | sed -n 's/.*CN=\([^,]*\).*/\1/p'; }
cert_end_epoch() { date -d "$(openssl x509 -in "$1" -noout -enddate | cut -d= -f2)" +%s; }
pubkey_hash() { openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256 -r | cut -d' ' -f1; }

# install_cert <folder> <domain> <errors domain>
install_cert() {
  local folder=${1/#\~/$HOME} domain=$2 errors_domain=$3
  folder=${folder%/}
  [[ -d $folder ]] || die "$folder isn't a folder."
  local work
  work=$(mktemp -d)
  # shellcheck disable=SC2064 # `work` is meant to be expanded now.
  trap "rm -rf '$work'" EXIT
  CERT_FILES=()
  CERT_SOURCES=()

  # ------ Read Every File ------
  local f keys=() key_hashes=()
  while IFS= read -r -d '' f; do
    if grep -q 'ENCRYPTED PRIVATE KEY\|Proc-Type: 4,ENCRYPTED' "$f" 2>/dev/null; then
      warn "${f#"$folder"/} is a password-protected key. Decrypt it first: openssl pkey -in <file> -out key.pem"
    elif grep -q 'PRIVATE KEY-----' "$f" 2>/dev/null; then
      if openssl pkey -in "$f" -passin pass: -noout 2>/dev/null; then
        keys+=("$f")
        key_hashes+=("$(openssl pkey -in "$f" -passin pass: -pubout | pubkey_hash)")
      fi
    else
      split_certs "$f" "$work"
    fi
  done < <(find "$folder" -maxdepth 2 -type f \( -name '*.crt' -o -name '*.pem' -o -name '*.cer' -o -name '*.key' \) \
    -print0 | sort -z)

  if ((${#CERT_FILES[@]} == 0)); then
    if [[ -n $(find "$folder" -maxdepth 2 -type f \( -name '*.pfx' -o -name '*.p12' \) | head -n 1) ]]; then
      die "No .crt, .pem or .cer certificates in $folder, only a .pfx. Export them from it first:
  openssl pkcs12 -in <file>.pfx -nokeys -out certificate.pem
  openssl pkcs12 -in <file>.pfx -nocerts -nodes -out key.pem"
    fi
    die "No certificates in $folder (looked at .crt, .pem, .cer and .key files)."
  fi

  # ------ The Certificate ------
  # A non-CA certificate for the domain with its key here. With several (an old and a renewed one), the one that
  # expires last.
  local i j hash end leaf="" leaf_src="" key="" leaf_end=0 covering=0
  for i in "${!CERT_FILES[@]}"; do
    f=${CERT_FILES[$i]}
    if cert_is_ca "$f" || ! cert_covers "$f" "$domain"; then continue; fi
    covering=$((covering + 1))
    hash=$(openssl x509 -in "$f" -noout -pubkey | pubkey_hash)
    for j in "${!keys[@]}"; do
      [[ ${key_hashes[$j]} == "$hash" ]] || continue
      end=$(cert_end_epoch "$f")
      if ((end > leaf_end)); then
        leaf=$f leaf_src=${CERT_SOURCES[$i]} key=${keys[$j]} leaf_end=$end
      fi
    done
  done

  if [[ -z $leaf ]]; then
    if ((covering > 0)); then
      die "Found a certificate for $domain, but no private key in $folder that matches it."
    fi
    warn "None of the certificates in $folder covers $domain. They cover:"
    for i in "${!CERT_FILES[@]}"; do
      cert_is_ca "${CERT_FILES[$i]}" && continue
      info "  ${CERT_SOURCES[$i]#"$folder"/}: $(cert_names "${CERT_FILES[$i]}")" >&2
    done
    die "No certificate for $domain."
  fi

  # ------ Checks ------
  cert_covers "$leaf" "$errors_domain" ||
    die "The certificate covers $(cert_names "$leaf"), but not $errors_domain. A wildcard covers one level only."
  local now days
  now=$(date +%s)
  ((leaf_end > now)) || die "The certificate expired on $(date -d "@$leaf_end" +%F)."
  days=$(((leaf_end - now) / 86400))

  # ------ Intermediates ------
  # Follows the issuers up from the certificate. Roots (self-signed) are left out: browsers already have them, and
  # sending one only adds bytes.
  local chain=() current=$leaf issuer next _
  for _ in 1 2 3 4; do
    issuer=$(cert_field "$current" issuer)
    [[ $issuer != "$(cert_field "$current" subject)" ]] || break
    next=""
    for f in "${CERT_FILES[@]}"; do
      if [[ $(cert_field "$f" subject) == "$issuer" && $(cert_field "$f" issuer) != "$issuer" ]]; then
        next=$f
        break
      fi
    done
    [[ -n $next ]] || break
    chain+=("$next")
    current=$next
  done

  if ((${#chain[@]} == 0)); then
    warn "No intermediate certificate for it in $folder (its issuer: $(cert_field "$leaf" issuer))."
    warn "Without one, some browsers and the app's error reporting reject the connection."
    confirm "Use the certificate without it anyway?" n || die "Nothing copied. Add the issuer's intermediate to $folder."
  else
    cat "${chain[@]}" >"$work/chain.pem"
    openssl verify -partial_chain -CAfile "$work/chain.pem" "$leaf" >/dev/null 2>&1 ||
      die "The intermediate certificates don't verify the certificate."
  fi

  # ------ Summary ------
  # A chain certificate named like a root is a cross-sign: the root, signed by an older root, for older clients.
  local source_of role subject
  info ""
  info "  Found:"
  printf '    %-13s %-30s %s\n' certificate "${leaf_src#"$folder"/}" "$(cert_names "$leaf")"
  printf '    %-13s %-30s %s\n' key "${key#"$folder"/}" "matches the certificate ✓"
  for f in "${chain[@]}"; do
    role=intermediate
    subject=$(cert_field "$f" subject)
    for i in "${!CERT_FILES[@]}"; do
      if [[ ${CERT_FILES[$i]} == "$f" ]]; then source_of=${CERT_SOURCES[$i]}; fi
      if [[ $(cert_field "${CERT_FILES[$i]}" subject) == "$subject" &&
        $(cert_field "${CERT_FILES[$i]}" issuer) == "$subject" ]]; then
        role=cross-sign
      fi
    done
    printf '    %-13s %-30s %s\n' "$role" "${source_of#"$folder"/}" "$(cert_cn "$f") ✓"
  done
  info "  Covers $domain ✓  $errors_domain ✓"
  info "  Expires $(date -d "@$leaf_end" +%F) ($days days)"
  ((days >= 30)) || warn "It expires in under 30 days. Caddy can't renew your own certificate: replace it in time."
  info ""
  confirm "Use these?" y || die "Nothing copied."

  # ------ Copy ------
  [[ ! -e $CERT_DIR || -w $CERT_DIR ]] || die "Can't write to $CERT_DIR. Fix its owner: sudo chown $(id -u) $CERT_DIR"
  (
    umask 077
    mkdir -p "$CERT_DIR"
    cat "$leaf" "${chain[@]}" >"$CERT_DIR/fullchain.pem.part"
    openssl pkey -in "$key" -passin pass: -out "$CERT_DIR/key.pem.part"
    mv "$CERT_DIR/fullchain.pem.part" "$CERT_DIR/fullchain.pem"
    mv "$CERT_DIR/key.pem.part" "$CERT_DIR/key.pem"
  )
  ok "Copied to certs/fullchain.pem and certs/key.pem"
}

# Restarts Caddy when TLS_MODE changed (it's an environment variable), and reloads it otherwise. `--force`, since the
# Caddyfile is the same and only the certificate files changed.
apply_tls() {
  local old=$1 new
  new=$(env_get TLS_MODE)
  if [[ $(container_state caddy) == running && $old == "$new" ]]; then
    step "Reloading Caddy"
    dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile --force </dev/null
  else
    step "Restarting Caddy with TLS_MODE=$new"
    dc up -d --no-deps caddy
  fi
  ok "Caddy is using the $([[ $new == files ]] && echo "certificate in certs/" || echo "automatic certificates")"
}

# ===== Backups =====
# backup_db <folder> <stamp> [suffix]. `pg_dump -Fc` is compressed and restores with `pg_restore`.
backup_db() {
  local dir=$1 file="$1/db-$2${3:-}.dump"
  [[ $(container_state db) == healthy ]] || die "The database isn't running, so it can't be backed up."
  mkdir -p "$dir"
  if ! (umask 077 && spin "Dumping the database" dc exec -T db pg_dump -U app -Fc app </dev/null >"$file.part"); then
    rm -f "$file.part"
    die "pg_dump failed (see above)."
  fi
  mv "$file.part" "$file"
  ok "Database → $file ($(du -h "$file" | cut -f1))"
}

# backup_media <folder> <stamp>. The image store is stopped while its volume is copied, so the copy is consistent:
# images don't load for that time. The archive streams to this side, so it belongs to this user, not root.
backup_media() {
  local dir=$1 file="$1/media-$2.tar.gz" id rc=0
  id=$(dc ps -a -q seaweedfs | head -n 1)
  [[ -n $id ]] || die "There's no image store container to back up."
  mkdir -p "$dir"
  step "Stopping the image store (images don't load until it's back)"
  dc stop seaweedfs
  (umask 077 && spin "Copying the media" docker run --rm --volumes-from "$id" "$HELPER_IMAGE" tar czf - -C /data . \
    >"$file.part") || rc=$?
  dc start seaweedfs
  if ((rc != 0)); then
    rm -f "$file.part"
    die "Copying the media failed (see above). The image store is running again."
  fi
  mv "$file.part" "$file"
  ok "Media → $file ($(du -h "$file" | cut -f1))"
}

# Keeps the newest BACKUP_KEEP of each kind.
prune_backups() {
  local dir=$1 keep pattern f
  keep=$(env_get BACKUP_KEEP)
  [[ $keep =~ ^[0-9]+$ ]] && ((keep > 0)) || keep=14
  for pattern in 'db-*.dump' 'media-*.tar.gz'; do
    find "$dir" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' | sort -nr | tail -n +$((keep + 1)) |
      cut -d' ' -f2- | while IFS= read -r f; do rm -f -- "$f"; done
  done
}

# ===== Commands =====

# ------ Set Up ------
cmd_setup() {
  require_tools
  is_checkout || clone_and_continue
  [[ ! -f $ENV_FILE ]] || die "This server is already set up (.env exists). Use Update instead."
  check_ports_free

  local domain errors_domain tls_choice tls_mode=auto folder dir goproxy
  step "Domains"
  info "Both need a DNS record pointing at this server."
  domain=$(ask_domain "Site domain (e.g. app.example.com)")
  errors_domain=$(ask_domain "Error viewer domain" "errors.$domain")
  [[ $domain != "$errors_domain" ]] || die "The error viewer needs its own domain."

  step "HTTPS certificate"
  tls_choice=$(choose "Which certificate?" \
    "Automatic   Let's Encrypt via Caddy (needs ports 80 and 443 open to the internet)" \
    "My own      certificate files you already have")
  if ((tls_choice == 2)); then
    folder=$(ask "Folder with your certificate files")
    install_cert "$folder" "$domain" "$errors_domain"
    tls_mode=files
  fi

  step "Backups"
  dir=$(ask "Folder for backups" "./backups")
  dir=${dir/#\~/$HOME}

  step "Build"
  info "Only if this server can't reach proxy.golang.org (Google blocks some regions): a Go module mirror."
  goproxy=$(ask "Go module mirror (Enter for none)")

  # ------ Write .env ------
  # The answers above go in; check_env generates every secret and SENTRY_DSN, and asks for anything else the registry
  # can't fill in. From here on .env exists and Set up is locked: a failed build is retried with Settings → Apply.
  step "Writing .env"
  (umask 077 && cp "$EXAMPLE_FILE" "$ENV_FILE")
  chmod 600 "$ENV_FILE"
  env_set DOMAIN "$domain"
  env_set ERRORS_DOMAIN "$errors_domain"
  env_set TLS_MODE "$tls_mode"
  env_set BACKUP_DIR "$dir"
  env_set GOPROXY "$goproxy"
  check_env
  ok ".env written. Keep a copy off the server: it's the only copy of its secrets."
  if confirm "Review .env in your editor before the first build?" n; then
    edit_env
    if ((ENV_EDITED)); then check_env; fi
  fi

  deploy_stack
  local password
  password=$(env_get ERROR_VIEWER_ADMIN_PASSWORD)

  # ------ Done ------
  step "Done"
  info "  Site          https://$(env_get DOMAIN)"
  info "  Error viewer  https://$(env_get ERRORS_DOMAIN)   password: $password (also in .env)"
  info ""
  info "  The first admin: sign up on the site, then choose Make admin (or: deploy/deploy.sh admin <email>)."
  info "  A nightly database backup: add this line with crontab -e"
  info "    0 3 * * * $ROOT/deploy/deploy.sh backup --db >>$(backup_dir)/cron.log 2>&1"
}

# Run outside a checkout (the script downloaded on its own): clone the project, then hand over to its own script.
clone_and_continue() {
  local url target
  info "There's no project here yet, so it's cloned first."
  url=$(ask "Git URL of the repository")
  [[ -n $url ]] || die "No URL given."
  target=$(ask "Folder to clone into" "$PWD/app")
  target=${target/#\~/$HOME}
  [[ ! -e $target ]] || die "$target already exists. Run $target/deploy/deploy.sh, or pick another folder."
  git clone "$url" "$target"
  [[ -f $target/deploy/deploy.sh ]] || die "The repository has no deploy/deploy.sh."
  exec bash "$target/deploy/deploy.sh" setup
}

# ------ Update ------
cmd_update() {
  require_tools
  is_set_up || die "Set up first."
  local changes before after
  changes=$(git -C "$ROOT" status --porcelain --untracked-files=no)
  [[ -z $changes ]] || die "Files were changed on this server, so git pull could clash with them:
$changes
Keep them with git stash, or drop them with git checkout -- <file>, then update again."

  # A migration can't be undone by going back a commit; this dump can.
  if [[ $(container_state db) == healthy ]]; then
    step "Backing up the database first"
    backup_db "$(backup_dir)" "$(date +%Y%m%d-%H%M%S)" "-pre-update"
    prune_backups "$(backup_dir)"
  else
    warn "The database isn't running, so there's no backup before this update."
  fi

  step "Pulling"
  before=$(git -C "$ROOT" rev-parse --short HEAD)
  git -C "$ROOT" pull --ff-only || die "git pull failed (see above). Nothing was rebuilt."
  after=$(git -C "$ROOT" rev-parse --short HEAD)
  if [[ $before == "$after" ]]; then
    info "Already on the newest commit ($after); rebuilding anyway, for changes in .env."
  else
    git -C "$ROOT" --no-pager log --oneline "$before..$after"
  fi

  # The pulled script, not the functions already loaded from the old one: its settings registry knows the variables the
  # new commits added, so they're filled in or asked for before the build.
  bash "$ROOT/deploy/deploy.sh" apply --after-update
  ok "Updated to $after"
}

# ------ Roll Back ------
# Runs a kept older image of the app. Only the app goes back: the checkout, .env, the other services and the database
# stay as they are, so the next Update or Apply deploys the checkout again.
cmd_rollback() {
  is_set_up || die "Set up first."
  require_tools
  local version=${1:-} image current head previous kept=() labels=() tag built subject n
  image=$(app_image)
  current=$(running_version)
  head=$(checkout_version)
  while read -r tag built; do
    [[ -n $tag && $tag != "$current" ]] || continue
    kept+=("$tag")
    subject=$(git -C "$ROOT" log -1 --format=%s "$tag" 2>/dev/null || true)
    labels+=("$(printf '%-9s %-12s %s' "$tag" "$built" "${subject:0:60}")")
  done < <(list_versions "$image")
  ((${#kept[@]} > 0)) ||
    die "No other version is kept to roll back to. Each deploy keeps its own (the newest $KEEP_VERSIONS)."

  # ------ Pick ------
  if [[ -z $version ]]; then
    [[ $INTERACTIVE == 1 ]] || die "Pass the version: deploy/deploy.sh rollback <version>. Kept: ${kept[*]}"
    info "Running: ${current:-unknown}"
    n=$(choose "Roll back to which version? (newest first)" "${labels[@]}")
    version=${kept[n - 1]}
  fi
  [[ $version != "$current" ]] || die "The app already runs $version."
  docker image inspect "$image:$version" >/dev/null 2>&1 || die "No kept version $version. Kept: ${kept[*]}"
  if [[ $version == "$head" ]]; then
    info "$version is the checkout's version: this undoes a roll back."
  else
    warn "Only the app goes back to $version. The checkout stays at $head: the next Update or Apply deploys that again."
  fi
  confirm "Switch the app to $version?" y || die "Nothing was changed."

  # ------ Replace ------
  # `latest` is what Compose runs. A healthy app is replaced without downtime; a broken one is simply recreated.
  previous=$(docker image inspect -f '{{.Id}}' "$image")
  docker tag "$image:$version" "$image"
  if [[ $(container_state app) == healthy ]]; then
    if ! rollout_app; then
      docker tag "$previous" "$image"
      die "Nothing was changed: the app still runs ${current:-the version it ran}."
    fi
  else
    step "Recreating the app on $version"
    dc up -d --no-deps --force-recreate app
    spin "Waiting for the app to turn healthy" wait_healthy app ||
      die "The app didn't turn healthy on $version either. Its logs: deploy/deploy.sh logs app"
  fi
  ok "The app runs $version."

  # Back on the checkout's version, the database already fits it.
  if [[ $version != "$head" ]]; then offer_pre_update_restore "$image" "$version"; fi
}

# The old version runs on the database as the newer one's migrations left it. That works as long as they only added
# things; when it doesn't, the dump Update took before replacing this version has the database from back then: the
# oldest pre-update dump newer than the version's image.
offer_pre_update_restore() {
  local image=$1 version=$2 built dump="" when path
  built=$(date -d "$(docker image inspect -f '{{.Created}}' "$image:$version")" +%s)
  while read -r when path; do
    [[ $path == *-pre-update.dump ]] && ((${when%.*} > built)) && dump=$path
  done < <(list_backups "$(backup_dir)")
  [[ -n $dump ]] || return 0
  info ""
  info "The database stays as the newer version left it. If $version fails on it (a column it needs was dropped or"
  info "renamed), restore $(basename "$dump"), the dump taken when $version was replaced."
  info "What was written since is lost."
  if [[ $INTERACTIVE == 1 ]] && confirm "Restore it now?" n; then
    cmd_restore "$dump"
  else
    info "Later: deploy/deploy.sh restore $dump --confirm $(env_get DOMAIN)"
  fi
}

# ------ Settings ------
cmd_env() {
  is_set_up || die "Set up first."
  case ${1:-} in
    --check)
      check_env_only
      return
      ;;
    "") ;;
    *) die "Unknown env option: $1 (see deploy/deploy.sh help)" ;;
  esac
  [[ $INTERACTIVE == 1 ]] ||
    die "No terminal for Settings. deploy/deploy.sh env --check checks .env without asking; deploy/deploy.sh apply deploys it."

  step "Checking .env"
  check_env
  while true; do
    info ""
    status_settings </dev/null
    case $(choose "Settings:" "Edit .env in your editor" "Apply pending changes (rebuild and restart)" "Back") in
      1)
        edit_env
        if ((ENV_EDITED)); then
          check_env
          if confirm "Apply now?" y; then cmd_apply; fi
        fi
        ;;
      2)
        if [[ $(settings_state) == applied ]]; then
          info "Nothing pending: the stack already runs with this .env."
          confirm "Rebuild and restart anyway?" n || continue
        fi
        cmd_apply
        ;;
      3) return 0 ;;
    esac
  done
}

# Reports what check_env would fill in or ask for, and changes nothing: for cron and CI. Exits 1 when .env isn't ready.
check_env_only() {
  local problems key fix _state reason bad=0
  if ! normalize_stream <"$ENV_FILE" | cmp -s - "$ENV_FILE"; then
    info "• .env isn't tidy (line endings, spacing, export, quotes or duplicates); the next apply tidies it."
  fi
  problems=$(env_problems "$ENV_FILE")
  while IFS='|' read -r key fix _state reason; do
    case $fix in
      ask | gen)
        printf '%s✗%s %-30s %s\n' "$RED" "$RESET" "$key" "$reason"
        bad=1
        ;;
      warn) warn "$key $reason." ;;
    esac
  done <<<"$problems"
  if ((bad)); then
    die ".env isn't ready. deploy/deploy.sh env fills in or asks for these; deploy/deploy.sh apply does too, then deploys."
  fi
  ok ".env has every setting."
  status_settings </dev/null
}

# ------ Apply ------
# `--after-update` is how Update hands over to the pulled script; it only changes what a stop says.
cmd_apply() {
  is_set_up || die "Set up first."
  case ${1:-} in
    --after-update) CHECK_FAILED_NOTE="The update stopped before the build: the new code is pulled, but the app that was running still runs the old one." ;;
    "") ;;
    *) die "Unknown apply option: $1 (see deploy/deploy.sh help)" ;;
  esac
  require_tools
  step "Checking .env"
  check_env
  deploy_stack
  ok "The stack runs with the current .env."
}

# ------ Back Up ------
cmd_backup() {
  is_set_up || die "Set up first."
  local what="" dir="" stamp
  while (($#)); do
    case $1 in
      --all) what=all ;;
      --db) what=db ;;
      --media) what=media ;;
      --dir)
        (($# >= 2)) || die "--dir needs a folder."
        dir=$2
        shift
        ;;
      *) die "Unknown backup option: $1 (see deploy/deploy.sh help)" ;;
    esac
    shift
  done

  if [[ -z $what ]]; then
    if [[ $INTERACTIVE == 1 ]]; then
      case $(choose "What to back up?" "Database + media" "Database only" "Media only") in
        1) what=all ;;
        2) what=db ;;
        3) what=media ;;
      esac
    else
      what=db
    fi
  fi
  if [[ -z $dir && $INTERACTIVE == 1 ]]; then
    dir=$(ask "Folder for backups" "$(env_get BACKUP_DIR)")
  fi
  # Remembered, so the next run (and cron) writes to the same place.
  if [[ -n $dir ]]; then
    dir=${dir/#\~/$HOME}
    [[ $dir == "$(env_get BACKUP_DIR)" ]] || env_set BACKUP_DIR "$dir"
  fi

  dir=$(backup_dir)
  stamp=$(date +%Y%m%d-%H%M%S)
  if [[ $what == all || $what == db ]]; then backup_db "$dir" "$stamp"; fi
  if [[ $what == all || $what == media ]]; then backup_media "$dir" "$stamp"; fi
  prune_backups "$dir"
}

# ------ Restore ------
cmd_restore() {
  is_set_up || die "Set up first."
  local file="" confirmed="" domain dir kind typed
  while (($#)); do
    case $1 in
      --confirm)
        (($# >= 2)) || die "--confirm needs the domain."
        confirmed=$2
        shift
        ;;
      -*) die "Unknown restore option: $1 (see deploy/deploy.sh help)" ;;
      *) file=$1 ;;
    esac
    shift
  done
  domain=$(env_get DOMAIN)
  dir=$(backup_dir)

  # ------ Pick ------
  if [[ -z $file ]]; then
    [[ $INTERACTIVE == 1 ]] || die "Pass the backup: deploy/deploy.sh restore <file> --confirm $domain"
    local files=() labels=() f n
    mapfile -t files < <(list_backups "$dir" | head -n 20 | cut -d' ' -f2-)
    ((${#files[@]} > 0)) || die "No backups in $dir."
    for f in "${files[@]}"; do labels+=("$(basename "$f")  ($(du -h "$f" | cut -f1))"); done
    n=$(choose "Which backup? (newest first)" "${labels[@]}")
    file=${files[n - 1]}
  fi
  [[ -f $file ]] || die "$file doesn't exist."
  case $(basename "$file") in
    db-*.dump) kind=database ;;
    media-*.tar.gz) kind=media ;;
    *) die "Can't tell what $file holds: backup names start with db- or media-." ;;
  esac

  # ------ Confirm ------
  # Typing the domain, not y: this replaces live data, and the domain proves it's the server you meant.
  warn "This replaces the current $kind with $(basename "$file")."
  if [[ $INTERACTIVE == 1 && -z $confirmed ]]; then
    typed=$(ask "Type $domain to confirm")
  else
    typed=$confirmed
  fi
  [[ $typed == "$domain" ]] || die "Not confirmed. Nothing was changed."

  if [[ $kind == database ]]; then restore_db "$file" "$dir"; else restore_media "$file" "$dir"; fi
}

# The app is stopped while the dump loads, so nothing writes in between. `--single-transaction` makes a failed
# restore roll back to the database as it was.
restore_db() {
  local file=$1 dir=$2 rc=0
  step "Backing up the current database first"
  backup_db "$dir" "$(date +%Y%m%d-%H%M%S)" "-pre-restore"
  step "Stopping the app"
  dc stop app
  spin "Restoring $(basename "$file")" \
    dc exec -T db pg_restore -U app -d app --clean --if-exists --no-owner --single-transaction <"$file" || rc=$?
  step "Starting the app"
  dc start app
  ((rc == 0)) || die "The restore failed and was rolled back: the database is as it was, and the app is running."
  spin "Waiting for the app to turn healthy" wait_healthy app ||
    warn "The app didn't turn healthy. Its logs: deploy/deploy.sh logs app"
  ok "Database restored from $(basename "$file")"
}

restore_media() {
  local file=$1 dir=$2 id rc=0
  id=$(dc ps -a -q seaweedfs | head -n 1)
  [[ -n $id ]] || die "There's no image store container to restore into."
  if confirm "Back up the current media first?" y; then
    backup_media "$dir" "$(date +%Y%m%d-%H%M%S)-pre-restore"
  fi
  step "Stopping the image store"
  dc stop seaweedfs
  spin "Restoring $(basename "$file")" docker run --rm -i --volumes-from "$id" "$HELPER_IMAGE" \
    sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf - -C /data' <"$file" || rc=$?
  dc start seaweedfs
  ((rc == 0)) || die "The restore failed part-way, so the media may be incomplete. Restore a backup again."
  ok "Media restored from $(basename "$file")"
}

# ------ Certificate ------
cmd_cert() {
  is_set_up || die "Set up first."
  local source=${1:-} old domain errors_domain
  old=$(env_get TLS_MODE)
  old=${old:-auto}
  domain=$(env_get DOMAIN)
  errors_domain=$(env_get ERRORS_DOMAIN)

  if [[ -z $source ]]; then
    info "Now: $([[ $old == files ]] && echo "your own certificate (certs/)" || echo "automatic (Let's Encrypt)")"
    if [[ $(choose "Which certificate?" \
      "Automatic   Let's Encrypt via Caddy (needs ports 80 and 443 open to the internet)" \
      "My own      certificate files you already have; also to replace an expiring one") == 1 ]]; then
      source=auto
    else
      source=$(ask "Folder with your certificate files")
    fi
  fi

  # Only Caddy reads TLS_MODE, and apply_tls restarts it. So when nothing else was pending, nothing is afterwards.
  local state
  state=$(settings_state)
  if [[ $source == auto ]]; then
    env_set TLS_MODE auto
  else
    install_cert "$source" "$domain" "$errors_domain"
    env_set TLS_MODE files
  fi
  apply_tls "$old"
  if [[ $state == applied ]]; then record_applied; fi
}

# ------ Status ------
cmd_status() {
  is_set_up || die "Set up first."
  step "Containers"
  dc ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
  step "Disk"
  df -h "$ROOT"
  docker system df
  step "Backups"
  info "$(backup_dir): $(list_backups "$(backup_dir)" | wc -l) files, $(du -sh "$(backup_dir)" 2>/dev/null | cut -f1 || echo 0)"
  step "Status"
  render_status
}

# ------ Logs ------
cmd_logs() {
  is_set_up || die "Set up first."
  local service=${1:-} n
  if [[ -z $service ]]; then
    n=$(choose "Which service?" "${SERVICES[@]}")
    service=${SERVICES[n - 1]}
  fi
  [[ " ${SERVICES[*]} " == *" $service "* ]] || die "No service \"$service\": one of ${SERVICES[*]}."
  info "${DIM}Following $service; Ctrl-C to stop.${RESET}"
  dc logs -f --tail 200 "$service" || true
}

# ------ Make Admin ------
cmd_admin() {
  is_set_up || die "Set up first."
  local email=${1:-} updated
  [[ -n $email ]] || email=$(ask "Email of the account" "" "the email")
  [[ $email == *@* ]] || die "\"$email\" isn't an email address."
  # The email goes in as a psql variable (`:'email'` quotes it), never pasted into the SQL.
  updated=$(dc exec -T db psql -U app -d app -v ON_ERROR_STOP=1 -v email="$email" -qtA \
    <<<"update \"user\" set role = 'admin' where email = :'email' returning email;")
  [[ -n $updated ]] || die "No account with $email. Sign up on the site first."
  ok "$email is now an admin."
}

# ===== Status Lines =====
status_line() {
  local color=$1 label=$2 text=$3 c
  case $color in
    green) c=$GREEN ;;
    yellow) c=$YELLOW ;;
    red) c=$RED ;;
    *) c=$DIM ;;
  esac
  printf '  %s●%s %-13s%s\n' "$c" "$RESET" "$label" "$text"
}

# The checked-out commit against its upstream. The fetch has a short timeout and never prompts, so an unreachable or
# private remote can't hang the menu.
status_project() {
  if ! is_checkout; then
    status_line red Project "not set up"
    return
  fi
  local head upstream behind
  head=$(git -C "$ROOT" rev-parse --short HEAD)
  if [[ -n $(git -C "$ROOT" status --porcelain --untracked-files=no) ]]; then
    status_line yellow Project "local changes  ($head)"
    return
  fi
  if ! git -C "$ROOT" rev-parse -q --verify '@{u}' >/dev/null; then
    status_line yellow Project "$head  (no upstream branch)"
    return
  fi
  if ! GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=5" \
    timeout 8 git -C "$ROOT" fetch -q 2>/dev/null; then
    status_line yellow Project "$head  (couldn't reach the remote)"
    return
  fi
  behind=$(git -C "$ROOT" rev-list --count 'HEAD..@{u}')
  upstream=$(git -C "$ROOT" rev-parse --short '@{u}')
  if ((behind == 0)); then
    status_line green Project "up to date  ($head)"
  else
    status_line yellow Project "$behind behind  ($head → $upstream)"
  fi
}

# The version the app runs and its health. Yellow when it isn't the checkout (rolled back, or an update that didn't
# finish).
status_app() {
  local state version head color=green text
  state=$(container_state app)
  if [[ $state == missing ]]; then
    status_line red App "not running"
    return
  fi
  version=$(running_version)
  head=$(checkout_version)
  text="${version:-untagged}  $state"
  case $state in
    healthy) ;;
    starting) color=yellow ;;
    *) color=red ;;
  esac
  if [[ -n $version && $version != "$head" ]]; then
    text+="  (the checkout is $head)"
    [[ $color == red ]] || color=yellow
  fi
  status_line "$color" App "$text"
}

# Requests the domain's /healthz from outside, through Caddy, the way a visitor would.
status_url() {
  local label=$1 domain=$2 code rc=0
  if [[ -z $domain ]]; then
    status_line red "$label" "not configured"
    return
  fi
  local url="https://$domain"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$url/healthz" 2>/dev/null) || rc=$?
  case $rc in
    0)
      if [[ $code == 200 ]]; then
        status_line green "$label" "$(printf '%-30s %s' "$url" "200 OK")"
      else
        status_line yellow "$label" "$(printf '%-30s %s' "$url" "$code")"
      fi
      ;;
    35 | 51 | 58 | 60) status_line yellow "$label" "$(printf '%-30s %s' "$url" "certificate not trusted")" ;;
    6) status_line red "$label" "$(printf '%-30s %s' "$url" "DNS doesn't resolve")" ;;
    *) status_line red "$label" "$(printf '%-30s %s' "$url" "no response")" ;;
  esac
}

# Docker publishes Caddy's ports through `docker-proxy`, or with no listening process at all (iptables only), so either
# counts as Caddy's while its container runs.
status_ports() {
  local caddy=0 port owner text="" bad=0
  [[ $(container_state caddy) == running ]] && caddy=1
  for port in 80 443; do
    owner=$(port_owner "$port")
    if [[ $caddy == 1 && ($owner == "" || $owner == docker-proxy || $owner == unknown) ]]; then
      text+="$port ✓  "
    elif [[ -z $owner ]]; then
      text+="$port ✗  "
      bad=1
    else
      text+="$port ✗ ($owner)  "
      bad=1
    fi
  done
  if ((bad == 0)); then
    status_line green Ports "${text}(Caddy)"
  elif ((caddy == 0)); then
    status_line red Ports "${text}(Caddy isn't running)"
  else
    status_line red Ports "${text% }"
  fi
}

status_ssl() {
  local mode end days
  if [[ ! -f $ENV_FILE ]]; then
    status_line red SSL "not configured"
    return
  fi
  mode=$(env_get TLS_MODE)
  if [[ $mode != files ]]; then
    status_line green SSL "automatic (Let's Encrypt)"
    return
  fi
  if [[ ! -f $CERT_DIR/fullchain.pem ]]; then
    status_line red SSL "own certificate missing from certs/"
    return
  fi
  end=$(cert_end_epoch "$CERT_DIR/fullchain.pem")
  days=$(((end - $(date +%s)) / 86400))
  local text
  text="own certificate, expires $(date -d "@$end" +%F)  ($days days)"
  if ((end <= $(date +%s))); then
    status_line red SSL "own certificate, expired $(date -d "@$end" +%F)"
  elif ((days < 30)); then
    status_line yellow SSL "$text"
  else
    status_line green SSL "$text"
  fi
}

ago() {
  local seconds=$(($(date +%s) - $1))
  if ((seconds < 3600)); then
    echo "$((seconds / 60)) min ago"
  elif ((seconds < 86400)); then
    echo "$((seconds / 3600)) h ago"
  elif ((seconds < 172800)); then
    echo "1 day ago"
  else
    echo "$((seconds / 86400)) days ago"
  fi
}

status_backup() {
  local newest when
  newest=$(list_backups "$(backup_dir)" | head -n 1)
  if [[ -z $newest ]]; then
    status_line red "Last backup" "none yet"
    return
  fi
  when=${newest%% *}
  when=${when%.*}
  if (($(date +%s) - when > 7 * 86400)); then
    status_line yellow "Last backup" "$(date -d "@$when" '+%F %H:%M')  ($(ago "$when"))"
  else
    status_line green "Last backup" "$(date -d "@$when" '+%F %H:%M')  ($(ago "$when"))"
  fi
}

# Whether .env has every setting, and whether the running stack uses it: the fingerprint against .env.applied.
status_settings() {
  if [[ ! -f $ENV_FILE ]]; then
    status_line red Settings "not configured"
    return
  fi
  local problems key _fix state _reason missing=() invalid=() text="" edited applied_at=""
  problems=$(env_problems "$ENV_FILE")
  while IFS='|' read -r key _fix state _reason; do
    case $state in
      missing) missing+=("$key") ;;
      invalid) invalid+=("$key") ;;
    esac
  done <<<"$problems"
  if ((${#missing[@]} + ${#invalid[@]})); then
    if ((${#missing[@]})); then text="missing: $(join_comma "${missing[@]}")"; fi
    if ((${#invalid[@]})); then text+="${text:+  }invalid: $(join_comma "${invalid[@]}")"; fi
    status_line red Settings "$text"
    return
  fi

  edited=$(stat -c %Y "$ENV_FILE")
  if [[ -f $APPLIED_FILE ]]; then read -r _ applied_at <"$APPLIED_FILE" || true; fi
  case $(settings_state) in
    untracked) status_line dim Settings "edited $(date -d "@$edited" '+%F %H:%M'), not tracked yet" ;;
    pending) status_line yellow Settings "edited $(date -d "@$edited" '+%F %H:%M'), not applied" ;;
    applied)
      text="applied $(date -d "@${applied_at:-0}" '+%F %H:%M')"
      if [[ $applied_at =~ ^[0-9]+$ ]] && ((edited > applied_at)); then
        text+="  (edited $(date -d "@$edited" '+%F %H:%M'))"
      fi
      status_line green Settings "$text"
      ;;
  esac
}

# Nothing here reads input: a status check that did (docker, git) would swallow what the user types ahead.
render_status() {
  render_status_lines </dev/null
}

render_status_lines() {
  status_project
  if is_set_up; then status_app; fi
  status_settings
  status_url Site "$(env_get DOMAIN)"
  status_url Errors "$(env_get ERRORS_DOMAIN)"
  status_ports
  status_ssl
  status_backup
}

# ===== Menu =====
MENU_KEYS=(setup update rollback env backup restore cert status logs admin)
MENU_LABELS=(
  "Set up" "Update" "Roll back" "Settings" "Back up" "Restore" "SSL certificate" "Status" "Logs" "Make admin"
)
MENU_HINTS=(
  "clone, create .env, first build"
  "back up, pull, rebuild, swap in the new app"
  "run an earlier version of the app"
  "check, edit .env, apply"
  "database and/or media"
  "from a backup file"
  "automatic or your own files"
  "containers, health, disk"
  "pick a service, follow"
  "promote an account by email"
)

# Set up is for a new server only; everything else needs it done.
menu_available() {
  if [[ $1 != setup ]]; then
    is_set_up
  elif is_set_up; then
    return 1
  fi
}

draw_menu() {
  local i rule="─────────────────────────────────────────────────────"
  printf '\e[H\e[2J'
  printf '%sDeploy%s  %s\n\n' "$BOLD" "$RESET" "$(env_get DOMAIN)"
  # With gum the status comes first, boxed, and pick_action lists the actions under it.
  if [[ -n $GUM ]]; then
    status_box
    printf '\n'
    return
  fi
  for i in "${!MENU_KEYS[@]}"; do
    if menu_available "${MENU_KEYS[$i]}"; then
      printf ' %2s) %-17s %s%s%s\n' "$((i + 1))" "${MENU_LABELS[$i]}" "$DIM" "${MENU_HINTS[$i]}" "$RESET"
    elif [[ ${MENU_KEYS[$i]} == setup ]]; then
      printf ' %s%2s) %-17s (already set up)%s\n' "$DIM" "$((i + 1))" "${MENU_LABELS[$i]}" "$RESET"
    else
      printf ' %s%2s) %-17s (set up first)%s\n' "$DIM" "$((i + 1))" "${MENU_LABELS[$i]}" "$RESET"
    fi
  done
  printf '  0) Quit\n\n'
  printf '  %s%s%s\n' "$DIM" "$rule" "$RESET"
  render_status
  printf '  %s%s%s\n\n' "$DIM" "$rule" "$RESET"
}

# The status lines in a box. A box as wide as its longest line breaks apart on a narrower terminal, so a line that
# doesn't fit (a long list of missing settings) makes the box the terminal's width, and gum wraps it.
status_box() {
  local lines cols longest width=()
  lines=$(render_status | sed 's/^  //')
  cols=$(stty size 2>/dev/null | cut -d' ' -f2)
  longest=$(sed 's/\x1b\[[0-9;]*m//g' <<<"$lines" | awk '{ if (length > n) n = length } END { print n + 0 }')
  ((longest + 4 <= ${cols:-80})) || width=(--width "$((${cols:-80} - 2))")
  "$GUM" style --border rounded --border-foreground 240 --padding "0 1" "${width[@]}" <<<"$lines"
}

# Prints the key of the action picked from gum's list, or `quit`. Only the available actions are listed.
pick_action() {
  local i options=()
  for i in "${!MENU_KEYS[@]}"; do
    menu_available "${MENU_KEYS[$i]}" || continue
    options+=("$(printf '%-17s %s' "${MENU_LABELS[$i]}" "${MENU_HINTS[$i]}")"$'\t'"${MENU_KEYS[$i]}")
  done
  options+=("Quit"$'\t'"quit")
  # Esc and Ctrl-C quit too.
  "$GUM" choose --header "" --label-delimiter $'\t' --height "${#options[@]}" "${options[@]}" || echo quit
}

menu() {
  [[ $INTERACTIVE == 1 ]] || die "No terminal for the menu: pass a command (deploy/deploy.sh help)."
  local choice key rc
  while true; do
    draw_menu
    if [[ -n $GUM ]]; then
      key=$(pick_action)
      [[ $key != quit ]] || exit 0
    else
      read -r -p "Choose: " choice || exit 0
      case $choice in
        0 | q | Q) exit 0 ;;
        [1-9] | [1-9][0-9]) ((choice <= ${#MENU_KEYS[@]})) || continue ;;
        *) continue ;;
      esac
      key=${MENU_KEYS[choice - 1]}
    fi
    if ! menu_available "$key"; then
      warn "Not available: $([[ $key == setup ]] && echo "this server is already set up" || echo "set up first")."
      pause
      continue
    fi
    # Without a checkout, setup clones and hands over to the clone's own script, which replaces this one.
    if [[ $key == setup ]] && ! is_checkout; then
      cmd_setup
      exit
    fi

    # Each action runs in its own shell, so an error ends the action rather than the menu, and Ctrl-C (leaving Logs,
    # or giving up on a prompt) comes back here. `set -e` is switched back on inside: bash turns it off in a subshell
    # whose status is tested, which a plain `( … ) || …` would be.
    trap : INT
    set +e
    (
      set -e
      "cmd_$key"
    )
    rc=$?
    set -e
    trap - INT
    ((rc != 130)) || printf '\n'
    pause
  done
}

# ===== Main =====
usage() {
  cat <<EOF
Usage: deploy/deploy.sh [command]

With no command, a menu with the stack's status under it.

  setup                         clone (when run outside a checkout), create .env, first build
  update                        back up the database, git pull, then apply with the pulled script
  rollback [<version>]          run an earlier image of the app (the newest $KEEP_VERSIONS are kept); without a
                                terminal, the version is needed
  env [--check]                 check .env (fill in what can be generated, ask for the rest), edit it in nano
                                or vi, apply it; --check only reports, and exits 1 when something is missing
  apply                         check .env, then rebuild and restart the stack with it
  backup [--all|--db|--media] [--dir <folder>]
                                without a terminal, --db is the default; --dir is remembered in .env
  restore [<file> --confirm <domain>]
                                restore a db-… or media-… backup; without a terminal, both are needed
  cert [auto|<folder>]          switch to Let's Encrypt, or install your own certificate from a folder
  status                        containers, disk, backups and the status lines
  logs [<service>]              follow a service's logs: ${SERVICES[*]}
  admin [<email>]               give an account the admin role
  help                          this text
EOF
}

main() {
  local command=${1:-menu}
  # Not for the script downloaded on its own, outside a checkout: it would leave deploy/.bin wherever it was saved.
  if is_checkout; then find_gum; fi
  (($# == 0)) || shift
  case $command in
    menu) menu ;;
    setup) cmd_setup ;;
    update) cmd_update ;;
    rollback) cmd_rollback "$@" ;;
    env) cmd_env "$@" ;;
    apply) cmd_apply "$@" ;;
    backup) cmd_backup "$@" ;;
    restore) cmd_restore "$@" ;;
    cert) cmd_cert "$@" ;;
    status) cmd_status ;;
    logs) cmd_logs "$@" ;;
    admin) cmd_admin "$@" ;;
    help | -h | --help) usage ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

# On one line with `exit`: bash reads a script as it runs, and `update` may replace this file through git pull.
main "$@"; exit
