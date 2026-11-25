# LibreChat Shot

Capture the focused window or control audio from GNOME without moving focus to Firefox. The bridge sends actions to one selected LibreChat tab. Compose controls continue to use LibreChat's audio, attachment, and permission settings.

## Install on Bazzite

Use GNOME Shell 51 on Wayland, Firefox with a userscript manager, and Python 3.11 or later with `venv` and `pip`. The LibreChat server must run the fork with the audio capture controls. On the desktop, from the repository root, run:

```sh
bash tools/librechat-shot/install.sh https://chat.example.com
```

Replace `https://chat.example.com` with your LibreChat origin. The installer writes to `~/.local/share` and `~/.config`. It starts `librechat-shot-bridge.service` for the current user. It creates a private token in `~/.config/librechat-shot/config.json`. Do not share this file or the generated userscript. To use a different loopback port, pass it as the second argument. Reimport the generated userscript after a port or origin change.

Log out and log in to GNOME. If necessary, run `gnome-extensions enable librechat-shot@local`. Import `~/.local/share/librechat-shot/librechat-shot.user.js` into the Firefox userscript manager. Do not install the template directly from the repository.

Use a certificate that your Firefox profile trusts for the LibreChat site. If the site's CSP blocks the connection, add `ws://127.0.0.1:17321` to its existing `connect-src`. For LibreChat's own CSP, append this address to `CSP_CONNECT_SRC_EXTRA`. Do not disable CSP or browser security checks.

## Use and configure

1. Open the target chat. Add `#librechat-shot` to the end of the URL, for example `https://chat.example.com/c/new#librechat-shot`. The script removes the fragment and connects this tab. To move the receiver, add `#librechat-shot-off` to the old tab before selecting the new tab. Select the tab again after reload or discard.
2. Grant LibreChat permission to access the required audio sources before using audio shortcuts from another window or tab. The browser and external app shortcuts use the sources in [.debug/pipewire-setup.md](../../.debug/pipewire-setup.md).
3. Move focus to another window or select another tab. The receiver tab must stay open and loaded. The bridge does not store captures or commands for later delivery.

| Default GNOME shortcut | Action                                                |
| ---------------------- | ----------------------------------------------------- |
| `Super+Alt+Q`          | Start or stop browser audio capture.                  |
| `Super+Alt+W`          | Start or stop external app audio capture.             |
| `Super+Alt+E`          | Start or stop microphone recording.                   |
| `Super+Alt+D`          | Attach a PNG of the focused window to the main draft. |

The PNG uses the normal LibreChat attachment upload. The tool does not send the chat message. Audio follows the existing speech settings, which can send a transcript when auto-send is enabled. No shortcut changes the Firefox or GNOME focus intentionally. Browser permission prompts and an unavailable composer can prevent an action.

Use GSettings to change the global shortcuts independently of the in-page LibreChat shortcuts. For example:

```sh
schema_dir="$HOME/.local/share/gnome-shell/extensions/librechat-shot@local/schemas"
gsettings --schemadir "$schema_dir" set org.gnome.shell.extensions.librechat-shot \
  librechat-shot-window "['<Super><Alt>F8']"
```

The other keys are `librechat-shot-microphone`, `librechat-shot-browser`, and `librechat-shot-external-app`. Set a key to `[]` to disable that global shortcut. New defaults do not replace saved shortcuts. Use `gsettings reset` for a key to restore its default. If GNOME cannot register a key, choose a different combination.

## Verify

```sh
systemctl --user status librechat-shot-bridge.service
gnome-extensions info librechat-shot@local
journalctl --user -f -u librechat-shot-bridge.service
journalctl -f /usr/bin/gnome-shell
```

Check that the unit is running and the extension is active. In the Firefox console for the receiver tab, look for `[LibreChat Shot] This tab is connected.` Test all four shortcuts with Firefox in an unfocused window and with another Firefox tab selected. Check that the screenshot appears in only the selected draft and that repeated audio shortcuts stop the active recording. If the bridge reports a delivery success, the browser passed the action to the composer. Check the draft or recording control to confirm that LibreChat completed it.

For local development, install `requirements.txt` in a Python virtual environment. Run the bridge tests from this directory with `python -B -m unittest`. Run the receiver tests from the repository root with `node --test tools/librechat-shot/test-receiver.cjs` after installing the workspace dependencies.
