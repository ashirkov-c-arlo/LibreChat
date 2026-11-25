# LibreChat Shot

Capture the focused window or record audio from GNOME without moving focus to Firefox. The bridge sends the PNG or WAV to one selected LibreChat tab. The buttons in LibreChat still record through the browser.

## Install on Bazzite

Use GNOME Shell 51 on Wayland, Firefox with a userscript manager, Python 3.11 or later with `venv` and `pip`, and the PipeWire Pulse tools `pactl` and `parec`. To upgrade from version 1, deploy the updated LibreChat client, run the installer again, and replace the old userscript with the generated version 2 script. Keep only one copy of the script enabled. On the desktop, from the repository root, run:

```sh
bash tools/librechat-shot/install.sh https://chat.example.com
```

Replace `https://chat.example.com` with your LibreChat origin. The installer writes to `~/.local/share` and `~/.config`. It starts `librechat-shot-bridge.service` for the current user. It creates a private token in `~/.config/librechat-shot/config.json`. Do not share this file or the generated userscript. To use a different loopback port, pass it as the second argument. Reimport the generated userscript after a port or origin change.

Log out and log in to GNOME. If necessary, run `gnome-extensions enable librechat-shot@local`. Import `~/.local/share/librechat-shot/librechat-shot.user.js` into the Firefox userscript manager. Do not install the template directly from the repository.

Use a certificate that your Firefox profile trusts for the LibreChat site. If the site's CSP blocks the connection, add `ws://127.0.0.1:17321` to its existing `connect-src`. For LibreChat's own CSP, append this address to `CSP_CONNECT_SRC_EXTRA`. Do not disable CSP or browser security checks.

## Use and configure

1. Open the target chat. Add `#librechat-shot` to the end of the URL, for example `https://chat.example.com/c/new#librechat-shot`. The script removes the fragment and connects this tab. To move the receiver, add `#librechat-shot-off` to the old tab before selecting the new tab. Select the tab again after reload or discard.
2. Enable **Speech to Text** in LibreChat and configure an external STT provider on the server. Leave the Firefox focus checks at their defaults. Local recording does not need Firefox microphone permission. The microphone shortcut uses the default input in GNOME; set it to your physical microphone, not a monitor or a LibreChat virtual source. The other two shortcuts use the virtual sources in [.debug/pipewire-setup.md](../../.debug/pipewire-setup.md). Use `pactl list short sources` to check that the sources are available.
3. Move focus to another window or select another tab. The receiver tab must stay open and loaded. The bridge does not store captures or commands for later delivery.

| Default GNOME shortcut | Action                                               |
| ---------------------- | ---------------------------------------------------- |
| `Super+Alt+Q`          | Start or stop browser audio capture.                 |
| `Super+Alt+W`          | Start or stop external app audio capture.            |
| `Super+Alt+E`          | Start or stop microphone recording.                  |
| `Super+Alt+D`          | Capture the focused window.                          |
| `Super+Alt+C`          | Capture a screen area between two pointer positions. |

The PNG uses the normal LibreChat attachment upload. For audio, wait for a red dot next to the source icon in the top GNOME panel. The source icon shows a browser, an application, or a microphone. Press the same shortcut to stop. The icon menu also names the source. The local bridge records one source at a time. To cancel without transcription, press a different audio shortcut. The bridge also discards a recording if the tab disconnects or the recording reaches five minutes. Keep the target conversation open until the transcript appears. A new conversation receives no audio from an earlier capture.

LibreChat sends the WAV to its STT endpoint when you stop the recording. It appends the transcript to the draft and does not send the message, even if **Auto send text** is enabled for browser recording. The bridge does not save recordings to disk. No shortcut changes window or tab focus.

In LibreChat, open **Settings → Chat → Messages → Send LibreChat Shot screenshots automatically**. The switch is off by default. If enabled, the screenshot sends only after a successful upload to an otherwise empty, idle draft. Text, other attachments, quotes, or staged skills prevent auto-send. Update the LibreChat client and use the generated userscript version 2.1 or later for this setting.

Open the camera icon in the top GNOME panel and select **Settings**. You can also open the settings from a terminal. Changes to the shortcuts do not require a restart:

```sh
gnome-extensions prefs librechat-shot@local
```

To capture a screen area, press **Capture a screen area** (`Super+Alt+C` by default) at one corner. The panel icon shows that the extension is waiting for the second corner, unless audio recording is active. Move to the opposite corner and press the same shortcut. The order of the corners does not matter. The first corner expires after 20 seconds. **Capture the focused window** (`Super+Alt+D` by default) cancels the area selection and captures the window in one press.

Enter a combination in GNOME format, such as `<Super><Alt>q`, then select Apply. Clear the field to disable a shortcut. The reset button restores its default. You can also use GSettings directly. For example:

```sh
schema_dir="$HOME/.local/share/gnome-shell/extensions/librechat-shot@local/schemas"
gsettings --schemadir "$schema_dir" set org.gnome.shell.extensions.librechat-shot \
  librechat-shot-window "['<Super><Alt>F8']"
```

The other keys are `librechat-shot-area`, `librechat-shot-microphone`, `librechat-shot-browser`, and `librechat-shot-external-app`. Set a key to `[]` to disable that global shortcut. New defaults do not replace saved shortcuts. Use `gsettings reset` for a key to restore its default. If GNOME cannot register a key, choose a different combination.

## Verify

```sh
systemctl --user status librechat-shot-bridge.service
gnome-extensions info librechat-shot@local
journalctl --user -f -u librechat-shot-bridge.service
journalctl -f /usr/bin/gnome-shell
```

Check that the unit is running and the extension is active. In the Firefox console for the receiver tab, look for `[LibreChat Shot] This tab is connected.` Test all five shortcuts with Firefox in an unfocused window and with another Firefox tab selected. Check that the screenshot appears in only the selected draft and that repeated audio shortcuts stop the active recording. The red dot next to the source icon shows that audio is recording. After you stop the recording, check the draft to confirm transcription completed. If the audio action fails, check the GNOME Shell log and verify that the target tab is connected, Speech to Text is enabled, and the PipeWire source exists.

For local development, install `requirements.txt` in a Python virtual environment. Run the bridge tests from this directory with `python -B -m unittest`. Run the receiver and extension tests from the repository root with `node --test tools/librechat-shot/test-*.cjs` after installing the workspace dependencies.
