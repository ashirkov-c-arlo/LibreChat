#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
INSTALL_DIR="$TMP/librechat"
LOG="$TMP/calls"
mkdir -p "$INSTALL_DIR"
STD=""
APP="LibreChat"

# Exercise only the update function, without downloading or sourcing the Proxmox engine.
body="$(awk '/^function update_script\(\)/ { printing=1 } /^start$/ { exit } printing' "$ROOT/ct/librechat.sh")"
body="${body//\/opt\/librechat/$INSTALL_DIR}"
source <(printf '%s\n' "$body")

for name in header_info check_container_storage check_container_resources msg_info msg_ok msg_error; do
  eval "$name() { :; }"
done
cd() { :; }
systemctl() { echo "systemctl $*" >>"$LOG"; }
npm() { echo "npm $*" >>"$LOG"; }
create_backup() { echo "backup $*" >>"$LOG"; }
restore_backup() { echo restore >>"$LOG"; }
check_for_gh_branch() {
  [[ "$*" == 'librechat ashirkov-c-arlo/LibreChat main' ]] || exit 1
  return "$BRANCH_STATUS"
}
check_for_gh_release() {
  [[ "$*" == 'rag-api danny-avila/rag_api' ]]
  return 1
}
fetch_and_deploy_gh_branch() {
  [[ "$CLEAN_INSTALL" == 1 ]]
  [[ "$*" == 'librechat ashirkov-c-arlo/LibreChat main' ]]
  echo deploy >>"$LOG"
}

BRANCH_STATUS=0
(update_script)
printf '%s\n' \
  'systemctl stop librechat rag-api' \
  "backup $INSTALL_DIR/.env $INSTALL_DIR/.npmrc $INSTALL_DIR/librechat.yaml $INSTALL_DIR/librechat.yml $INSTALL_DIR/uploads $INSTALL_DIR/data $INSTALL_DIR/api/data $INSTALL_DIR/logs $INSTALL_DIR/images $INSTALL_DIR/client/public/images" \
  deploy restore \
  'npm ci --allow-remote=all' \
  'npm run frontend' \
  'npm prune --production' \
  'npm cache clean --force' \
  'systemctl start rag-api librechat' >"$TMP/expected"
diff -u "$TMP/expected" "$LOG"

BRANCH_STATUS=1
: >"$LOG"
(update_script)
[[ ! -s "$LOG" ]]

rmdir "$INSTALL_DIR"
if (update_script); then
  echo 'Missing installation must fail' >&2
  exit 1
fi
[[ ! -s "$LOG" ]]
echo 'LibreChat updater checks passed'
