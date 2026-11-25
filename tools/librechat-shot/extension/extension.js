import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup?version=3.0';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const bindings = {
  'librechat-shot-window': null,
  'librechat-shot-microphone': 'microphone',
  'librechat-shot-browser': 'browser',
  'librechat-shot-external-app': 'externalApp',
};

function readConfig() {
  const path = GLib.build_filenamev([
    GLib.get_home_dir(),
    '.config',
    'librechat-shot',
    'config.json',
  ]);
  const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
  const config = JSON.parse(new TextDecoder().decode(bytes));
  if (
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    typeof config.token !== 'string' ||
    !/^[0-9a-f]{64}$/.test(config.token)
  ) {
    throw new Error('Invalid bridge configuration.');
  }
  return config;
}

async function captureWindow() {
  if (global.display.get_focus_window() == null) {
    throw new Error('No window has focus.');
  }
  const stream = Gio.MemoryOutputStream.new_resizable();
  try {
    // GNOME Shell 51.1 configures the Promise form in js/ui/screenshot.js.
    const screenshot = new Shell.Screenshot();
    await screenshot.screenshot_window(true, false, stream);
  } finally {
    stream.close(null);
  }
  return stream.steal_as_bytes();
}

export default class LibreChatShot extends Extension {
  enable() {
    this._config = readConfig();
    this._session = new Soup.Session({ timeout: 12 });
    this._session.set_proxy_resolver(null);
    this._registered = [];
    const settings = this.getSettings();
    for (const [name, action] of Object.entries(bindings)) {
      const registered = Main.wm.addKeybinding(
        name,
        settings,
        Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
        Shell.ActionMode.NORMAL,
        () => void this._relay(action),
      );
      if (registered === Meta.KeyBindingAction.NONE) {
        console.error(`[LibreChat Shot] Could not register ${name}.`);
      } else {
        this._registered.push(name);
      }
    }
  }

  disable() {
    for (const name of this._registered ?? []) {
      Main.wm.removeKeybinding(name);
    }
    this._registered = [];
    const session = this._session;
    this._session = null;
    session?.abort();
    this._pending = null;
    this._config = null;
  }

  _showAudioStatus(label) {
    const icon = Gio.ThemedIcon.new('audio-input-microphone-symbolic');
    Main.osdWindowManager.showAll(icon, label, null);
  }

  async _relay(action) {
    const session = this._session;
    if (session == null || this._pending != null) {
      return;
    }
    this._pending = session;
    try {
      const { port, token } = this._config;
      const png = action == null;
      const body = png ? await captureWindow() : new GLib.Bytes(new TextEncoder().encode(action));
      if (this._session !== session) {
        return;
      }
      const route = png ? 'upload' : 'command';
      const message = Soup.Message.new('POST', `http://127.0.0.1:${port}/${route}`);
      message.set_flags(Soup.MessageFlags.NO_REDIRECT);
      message.get_request_headers().append('X-Token', token);
      message.set_request_body_from_bytes(png ? 'image/png' : 'text/plain', body);
      const response = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
      if (this._session !== session) {
        return;
      }
      const status = message.get_status();
      if (png && status === Soup.Status.NO_CONTENT) {
        return;
      }
      if (!png && status === Soup.Status.OK) {
        const state = new TextDecoder().decode(response.get_data());
        const label = {
          'recording-started': 'Recording started',
          'audio-delivered': 'Recording sent for transcription',
          'recording-canceled': 'Recording canceled',
        }[state];
        if (label != null) {
          this._showAudioStatus(label);
          return;
        }
      }
      throw new Error(`The bridge returned HTTP ${status}.`);
    } catch (error) {
      if (this._session === session) {
        console.error(`[LibreChat Shot] ${error.message}`);
        if (action != null) {
          this._showAudioStatus('Audio action failed');
        }
      }
    } finally {
      if (this._pending === session) {
        this._pending = null;
      }
    }
  }
}
