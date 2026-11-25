#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf 'Usage: bash %s https://librechat.example.com [port]\n' "$0" >&2
  exit 2
fi

for tool in gnome-shell gnome-extensions glib-compile-schemas python3 systemctl pactl parec; do
  if ! command -v "$tool" >/dev/null; then
    printf 'Required command not found: %s\n' "$tool" >&2
    exit 1
  fi
done
case "$(gnome-shell --version)" in
  'GNOME Shell 51'|'GNOME Shell 51.'*) ;;
  *) printf 'This extension requires GNOME Shell 51.\n' >&2; exit 1 ;;
esac

source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
share="$HOME/.local/share/librechat-shot"
config_dir="$HOME/.config/librechat-shot"
unit_dir="$HOME/.config/systemd/user"
extension="$HOME/.local/share/gnome-shell/extensions/librechat-shot@local"
mkdir -p -- "$share/tmp" "$config_dir"
export TMPDIR="$share/tmp"

python3 - "$source_dir" "$config_dir/config.json" "$share/librechat-shot.user.js" "$@" <<'PY'
import json
import re
import secrets
import sys
from pathlib import Path

source, config_file, script_file = map(Path, sys.argv[1:4])
origin = sys.argv[4]
if not re.fullmatch(r"https://[a-z0-9.-]+(?::[0-9]+)?", origin):
    sys.exit("Enter an exact HTTPS origin without a path or trailing slash.")
if ":" in origin[8:]:
    host, origin_port = origin.rsplit(":", 1)
    if not 1 <= int(origin_port) <= 65535:
        sys.exit("The LibreChat origin has an invalid port.")
    origin = host if int(origin_port) == 443 else f"{host}:{int(origin_port)}"
prior = json.loads(config_file.read_text()) if config_file.exists() else {}
try:
    port = int(sys.argv[5]) if len(sys.argv) > 5 else prior.get("port", 17321)
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError
except ValueError:
    sys.exit("The bridge port must be between 1024 and 65535.")
token = prior.get("token", secrets.token_hex(32))
if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{64}", token):
    sys.exit("The existing bridge token is invalid.")
config = {"port": port, "origin": origin, "token": token}
template = (source / "receiver.user.js").read_text()
outputs = {
    config_file: json.dumps(config, indent=2) + "\n",
    script_file: template.replace("__LIBRECHAT_MATCH__", origin + "/*").replace(
        "/* __LIBRECHAT_CONFIG__ */ null", json.dumps(config)
    ),
}
for path, contents in outputs.items():
    temporary = path.with_suffix(".new")
    with temporary.open("x") as file:
        file.write(contents)
    temporary.replace(path)
PY

python3 -m venv "$share/venv"
"$share/venv/bin/python" -m pip install --no-cache-dir -r "$source_dir/requirements.txt"
install -m 600 "$source_dir/bridge.py" "$source_dir/audio.py" "$share/"
install -D -m 600 "$source_dir/librechat-shot-bridge.service" "$unit_dir/librechat-shot-bridge.service"
install -D -m 600 "$source_dir/extension/metadata.json" "$extension/metadata.json"
install -m 600 "$source_dir/extension/extension.js" "$source_dir/extension/prefs.js" \
  "$source_dir/extension/stylesheet.css" "$extension/"
schema=org.gnome.shell.extensions.librechat-shot.gschema.xml
install -D -m 600 "$source_dir/extension/schemas/$schema" "$extension/schemas/$schema"
glib-compile-schemas --strict "$extension/schemas"

systemctl --user daemon-reload
if systemctl --user is-active --quiet librechat-shot-bridge.service; then
  systemctl --user restart librechat-shot-bridge.service
fi
systemctl --user enable --now librechat-shot-bridge.service
if ! gnome-extensions enable librechat-shot@local; then
  printf 'Log out and back in. Then run: gnome-extensions enable librechat-shot@local\n' >&2
fi
printf 'Import this private file into the Firefox userscript manager: %s\n' "$share/librechat-shot.user.js"
printf 'Open the target chat with #librechat-shot at the end of its URL to connect it.\n'
