#!/usr/bin/env bash
# Sets up, updates, backs up and checks the production stack on its server (docs/deployment.md → The Deploy Script).
#
#   deploy/deploy.sh             a menu, with the stack's status under it
#   deploy/deploy.sh <command>   the same actions without the menu, for cron and scripts (`deploy/deploy.sh help`)
#
# Needs bash, git, Docker with Compose 2.23.1+, openssl and curl. Without a terminal (cron) it never asks: it uses the
# flags or the defaults, or stops with an error naming the flag to pass.
set -euo pipefail
shopt -s inherit_errexit

# ===== Paths =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="compose.prod.yaml"
ENV_FILE="$ROOT/.env"
CERT_DIR="$ROOT/certs"
SERVICES=(app caddy error-viewer db seaweedfs)
MIN_COMPOSE="2.23.1"
# Reads and writes the image store's volume for media backups. Any image with `sh`, `find` and `tar` works.
HELPER_IMAGE="busybox:1.37"

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

# ===== Prompts =====
# Each prompt reads from the terminal and prints the answer, so it's used as `answer=$(ask …)`. Without a terminal it
# stops the script; `flag` tells the caller what to pass instead.

# ask <question> [default] [flag]
ask() {
  local question=$1 default=${2:-} flag=${3:-} answer
  [[ $INTERACTIVE == 1 ]] || die "No terminal to ask \"$question\"${flag:+: pass $flag}."
  if [[ -n $default ]]; then
    read -r -p "$question [$default]: " answer
  else
    read -r -p "$question: " answer
  fi
  printf '%s' "${answer:-$default}"
}

# confirm <question> <y|n>: the default is what Enter answers, and what runs without a terminal.
confirm() {
  local question=$1 default=$2 answer hint="[y/N]"
  [[ $default == y ]] && hint="[Y/n]"
  if [[ $INTERACTIVE != 1 ]]; then
    [[ $default == y ]]
    return
  fi
  read -r -p "$question $hint " answer
  answer=${answer:-$default}
  [[ $answer == [yY]* ]]
}

# choose <question> <option>…: prints the chosen option's number, from 1.
choose() {
  local question=$1 i answer
  shift
  [[ $INTERACTIVE == 1 ]] || die "No terminal to ask \"$question\"."
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

ask_domain() {
  local question=$1 default=${2:-} domain
  while true; do
    domain=$(ask "$question" "$default")
    domain=${domain,,}
    if [[ $domain =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
      printf '%s' "$domain"
      return
    fi
    warn "\"$domain\" isn't a domain name like app.example.com."
  done
}

pause() { read -r -p $'\nPress Enter for the menu… ' _ || true; }

# ===== Settings =====
# `.env` is only ever read line by line, never sourced: it's data, not a script.
env_get() {
  [[ -f $ENV_FILE ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
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

# healthy | unhealthy | starting for a service with a health check, else running | exited | …; missing when there's no
# container (or no stack yet).
container_state() {
  local id
  id=$(dc ps -a -q "$1" 2>/dev/null | head -n 1 || true)
  if [[ -z $id ]]; then
    echo missing
    return
  fi
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id"
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

# Builds and starts the stack. Compose runs `migrate` and `storage-init` first and starts the new app only if both
# succeed, so a failure here leaves the database and the running app as they were.
deploy_stack() {
  # Docker would create a missing bind-mount folder as root, which this script then couldn't write certificates into.
  mkdir -p "$CERT_DIR"

  step "Building and starting the stack"
  local log
  log=$(mktemp)
  if ! dc up -d --build --remove-orphans 2>&1 | tee "$log"; then
    # Where Google blocks the region, the error viewer's build gets 403 from Go's module proxy (docs/deployment.md).
    if grep -q 'proxy.golang.org.*403 Forbidden' "$log"; then
      rm -f "$log"
      die "This server can't download Go modules from proxy.golang.org. Set GOPROXY in .env to a mirror it can reach
(e.g. GOPROXY=https://goproxy.cn), then choose Update."
    fi
    rm -f "$log"
    die "The deploy stopped (see above). Nothing that was running was replaced: a failed build or migration leaves the
running app and the database as they were."
  fi
  rm -f "$log"

  step "Waiting for the app to turn healthy"
  wait_healthy app || die "The app didn't turn healthy. Its logs: deploy/deploy.sh logs app"
  ok "App is healthy"
  if wait_healthy error-viewer 60; then
    ok "Error viewer is healthy"
  else
    warn "The error viewer didn't turn healthy. Its logs: deploy/deploy.sh logs error-viewer"
  fi

  # Each build leaves the previous images behind, untagged; on a small disk they add up. Only this stack's: Compose
  # labels what it builds with the project, and other projects' untagged images on the server aren't ours to remove.
  local project
  project=$(dc config --format json | sed -n 's/^{"name":"\([^"]*\)".*/\1/p')
  if [[ -n $project ]]; then
    docker image prune -f --filter "label=com.docker.compose.project=$project" >/dev/null
  fi
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
  if ! (umask 077 && dc exec -T db pg_dump -U app -Fc app </dev/null >"$file.part"); then
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
  (umask 077 && docker run --rm --volumes-from "$id" "$HELPER_IMAGE" tar czf - -C /data . >"$file.part") || rc=$?
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
  step "Writing .env"
  local public_key password
  public_key=$(secret 16)
  password=$(secret 12)
  (umask 077 && cp "$ROOT/.env.production.example" "$ENV_FILE")
  chmod 600 "$ENV_FILE"
  env_set DOMAIN "$domain"
  env_set ERRORS_DOMAIN "$errors_domain"
  env_set TLS_MODE "$tls_mode"
  env_set BACKUP_DIR "$dir"
  env_set GOPROXY "$goproxy"
  env_set ERROR_VIEWER_PUBLIC_KEY "$public_key"
  env_set ERROR_VIEWER_ADMIN_PASSWORD "$password"
  env_set ERROR_VIEWER_SESSION_SECRET "$(secret)"
  env_set SENTRY_DSN "https://$public_key@$errors_domain/1"
  env_set POSTGRES_PASSWORD "$(secret)"
  env_set BETTER_AUTH_SECRET "$(secret)"
  env_set ALTCHA_HMAC_KEY "$(secret)"
  env_set S3_ACCESS_KEY "$(secret 16)"
  env_set S3_SECRET_KEY "$(secret)"
  env_set S3_ADMIN_ACCESS_KEY "$(secret 16)"
  env_set S3_ADMIN_SECRET_KEY "$(secret)"
  ok ".env written, with every secret generated. Keep a copy off the server: it's the only copy of them."

  deploy_stack

  # ------ Done ------
  step "Done"
  info "  Site          https://$domain"
  info "  Error viewer  https://$errors_domain   password: $password (also in .env)"
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
    git -C "$ROOT" log --oneline "$before..$after"
  fi

  deploy_stack
  ok "Updated to $after"
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
  step "Restoring $(basename "$file")"
  dc exec -T db pg_restore -U app -d app --clean --if-exists --no-owner --single-transaction <"$file" || rc=$?
  step "Starting the app"
  dc start app
  ((rc == 0)) || die "The restore failed and was rolled back: the database is as it was, and the app is running."
  wait_healthy app || warn "The app didn't turn healthy. Its logs: deploy/deploy.sh logs app"
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
  step "Restoring $(basename "$file")"
  docker run --rm -i --volumes-from "$id" "$HELPER_IMAGE" \
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

  if [[ $source == auto ]]; then
    env_set TLS_MODE auto
  else
    install_cert "$source" "$domain" "$errors_domain"
    env_set TLS_MODE files
  fi
  apply_tls "$old"
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

# Nothing here reads input: a status check that did (docker, git) would swallow what the user types ahead.
render_status() {
  render_status_lines </dev/null
}

render_status_lines() {
  status_project
  status_url Site "$(env_get DOMAIN)"
  status_url Errors "$(env_get ERRORS_DOMAIN)"
  status_ports
  status_ssl
  status_backup
}

# ===== Menu =====
MENU_KEYS=(setup update backup restore cert status logs admin)
MENU_LABELS=("Set up" "Update" "Back up" "Restore" "SSL certificate" "Status" "Logs" "Make admin")
MENU_HINTS=(
  "clone, create .env, first build"
  "back up, pull, rebuild, wait for healthy"
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
  for i in "${!MENU_KEYS[@]}"; do
    if menu_available "${MENU_KEYS[$i]}"; then
      printf '  %s) %-17s %s%s%s\n' "$((i + 1))" "${MENU_LABELS[$i]}" "$DIM" "${MENU_HINTS[$i]}" "$RESET"
    elif [[ ${MENU_KEYS[$i]} == setup ]]; then
      printf '  %s%s) %-17s (already set up)%s\n' "$DIM" "$((i + 1))" "${MENU_LABELS[$i]}" "$RESET"
    else
      printf '  %s%s) %-17s (set up first)%s\n' "$DIM" "$((i + 1))" "${MENU_LABELS[$i]}" "$RESET"
    fi
  done
  printf '  9) Quit\n\n'
  printf '  %s%s%s\n' "$DIM" "$rule" "$RESET"
  render_status
  printf '  %s%s%s\n\n' "$DIM" "$rule" "$RESET"
}

menu() {
  [[ $INTERACTIVE == 1 ]] || die "No terminal for the menu: pass a command (deploy/deploy.sh help)."
  local choice key rc
  while true; do
    draw_menu
    read -r -p "Choose: " choice || exit 0
    case $choice in
      9 | q | Q) exit 0 ;;
      [1-8]) key=${MENU_KEYS[choice - 1]} ;;
      *) continue ;;
    esac
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
  update                        back up the database, git pull, rebuild, wait for healthy
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
  (($# == 0)) || shift
  case $command in
    menu) menu ;;
    setup) cmd_setup ;;
    update) cmd_update ;;
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
