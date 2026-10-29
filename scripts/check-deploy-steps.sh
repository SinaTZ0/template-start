#!/usr/bin/env bash
# The commit-msg hook's deploy steps check (lefthook.yml; docs/deployment.md → Deploy Steps). Run as
# `bash scripts/check-deploy-steps.sh <message file>`. It fails a commit that:
#
#   - changes a path in deploy/steps/needs-step.txt without adding a step file, unless its message has a
#     `Deploy-Step: none` line (the server keeps its data on purpose);
#   - edits or renames a committed step file: the server records how many of its commands ran, so a changed step
#     would carry on at the wrong command. Deleting one is fine.
#
# It runs at commit-msg rather than pre-commit because only then is the message there to read.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
message_file=$1
list=deploy/steps/needs-step.txt

# A merge brings other commits' changes, which their own commits already answered for.
if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  exit 0
fi

# ------ Staged changes ------
# `<status>\t<path>[\t<new path>]`, renames detected, so an edited step that was also renamed shows as one.
mapfile -t changes < <(git diff --cached --name-status -M)

is_step() { [[ $1 == deploy/steps/[0-9]*.md ]]; }

patterns=()
while IFS= read -r line; do
  [[ -z $line || $line == \#* ]] && continue
  patterns+=("$line")
done <"$list"

added_step=false
needs=()
edited=()
for change in "${changes[@]}"; do
  IFS=$'\t' read -r status path new_path <<<"$change"
  if is_step "$path"; then
    case $status in
      A) added_step=true ;;
      M | R* | C*) edited+=("$path") ;;
    esac
    continue
  fi
  [[ $status == D ]] && continue
  for pattern in "${patterns[@]}"; do
    # Unquoted on the right, so it's a pattern; inside [[ ]] `*` matches `/` too.
    # shellcheck disable=SC2053
    if [[ $path == $pattern || ${new_path:-} == $pattern ]]; then
      needs+=("${new_path:-$path}")
      break
    fi
  done
done

# ------ Verdict ------
failed=false
if ((${#edited[@]})); then
  failed=true
  printf 'A committed deploy step was changed:\n' >&2
  printf '  %s\n' "${edited[@]}" >&2
  printf 'Servers record how many of its commands ran. Undo the change and add a new step instead.\n\n' >&2
fi
if ((${#needs[@]})) && ! $added_step && ! grep -qiE '^Deploy-Step:[[:space:]]*none[[:space:]]*$' "$message_file"; then
  failed=true
  printf 'These changes need a deploy step to reach the server'"'"'s data:\n' >&2
  printf '  %s\n' "${needs[@]}" >&2
  printf 'Add deploy/steps/<yyyymmdd>-<hhmm>-<what>.md (deploy/steps/README.md), or, when the server should keep\n' >&2
  printf 'its data, add a line "Deploy-Step: none" to the commit message.\n' >&2
fi
if $failed; then
  exit 1
fi
