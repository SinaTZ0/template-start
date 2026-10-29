#!/usr/bin/env bash
# Builds the deploy tool into deploy/bin/linux-<arch>/ (docs/deployment.md → The Deploy Tool), where git takes it to the
# server: the server needs no Go. Run through `pnpm deploy:build`:
#
#   pnpm deploy:build                  amd64, the default
#   pnpm deploy:build --arch arm64     another architecture; --arch all builds every one below
#   bash tools/deploy/build.sh --check what the pre-commit hook runs: fails when a committed binary is older than the
#                                      staged source
#
# Each folder's SOURCE_HASH names the source it was built from: a hash of git's blob ids for the files in tools/deploy/,
# taken from the working tree when building and from the index when checking, so the two agree once the source is
# staged. Comparing hashes needs no byte-identical builds, and works for a binary this machine can't run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARCHES=(amd64 arm64)
cd "$ROOT"

# `<path> <blob id>` for every source file, hashed.
source_hash() {
  if [[ $1 == index ]]; then
    git ls-files -s -- tools/deploy | awk '{ print $4, $2 }'
  else
    git ls-files -co --exclude-standard -- tools/deploy | sort | while IFS= read -r f; do
      [[ -f $f ]] && printf '%s %s\n' "$f" "$(git hash-object -- "$f")"
    done
  fi | sha256sum | cut -d' ' -f1
}

# ------ Check ------
if [[ ${1:-} == --check ]]; then
  want=$(source_hash index)
  stale=()
  for arch in "${ARCHES[@]}"; do
    file="deploy/bin/linux-$arch/SOURCE_HASH"
    # Only folders that are committed (or staged): an architecture nobody built yet isn't required.
    git cat-file -e ":$file" 2>/dev/null || continue
    [[ $(git show ":$file") == "$want" ]] || stale+=("$arch")
  done
  if ((${#stale[@]})); then
    echo "✗ The deploy binary is older than the staged source in tools/deploy/ (linux-${stale[*]})." >&2
    arch=${stale[0]}
    ((${#stale[@]} == 1)) || arch=all
    echo "  Rebuild and stage it: pnpm deploy:build --arch $arch && git add deploy/bin" >&2
    echo "  (Untracked files in tools/deploy/ count as source too: stage or remove them first.)" >&2
    exit 1
  fi
  exit 0
fi

# ------ Arguments ------
targets=(amd64)
while (($#)); do
  case $1 in
    --arch)
      (($# >= 2)) || { echo "--arch needs amd64, arm64 or all." >&2; exit 2; }
      case $2 in
        all) targets=("${ARCHES[@]}") ;;
        amd64 | arm64) targets=("$2") ;;
        *) echo "Unknown architecture: $2 (amd64, arm64 or all)." >&2; exit 2 ;;
      esac
      shift
      ;;
    *) echo "Unknown option: $1 (--arch amd64|arm64|all)." >&2; exit 2 ;;
  esac
  shift
done

# ------ Build ------
cd tools/deploy
go vet ./...
go test ./...
hash=$(cd "$ROOT" && source_hash worktree)
for arch in "${targets[@]}"; do
  out="$ROOT/deploy/bin/linux-$arch"
  mkdir -p "$out"
  # Static (no cgo), without the build folder's paths or VCS stamps, symbols stripped: about 9 MB.
  CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -trimpath -buildvcs=false -ldflags="-s -w" -o "$out/deploy" .
  printf '%s\n' "$hash" >"$out/SOURCE_HASH"
  echo "✓ deploy/bin/linux-$arch/deploy ($(du -h "$out/deploy" | cut -f1))"
done
