import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const AREA_TIMEOUT = 20;
const RECORDING_CHECK_INTERVAL = 2;
const sources = {
  browser: { label: 'Recording browser audio', icon: 'audio-headphones-symbolic' },
  externalApp: { label: 'Recording external app audio', icon: 'audio-volume-high-symbolic' },
  microphone: { label: 'Recording microphone', icon: 'audio-input-microphone-symbolic' },
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

async function captureScreenshot(area) {
  if (area == null && global.display.get_focus_window() == null) {
    throw new Error('No window has focus.');
  }
  const stream = Gio.MemoryOutputStream.new_resizable();
  try {
    // GNOME Shell 51.1 configures the Promise form in js/ui/screenshot.js.
    const screenshot = new Shell.Screenshot();
    if (area == null) {
      await screenshot.screenshot_window(true, false, stream);
    } else {
      await screenshot.screenshot_area(...area, stream);
    }
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
    this._settings = this.getSettings();
    this._indicator = new PanelMenu.Button(0.5, 'LibreChat Shot');
    this._icon = new St.Icon({
      icon_name: 'camera-photo-symbolic',
      style_class: 'system-status-icon',
    });
    this._dot = new St.Icon({
      icon_name: 'media-record-symbolic',
      icon_size: 8,
      style_class: 'librechat-shot-recording-dot',
      visible: false,
    });
    const icons = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
    icons.add_child(this._dot);
    icons.add_child(this._icon);
    this._indicator.add_child(icons);
    this._statusItem = this._indicator.menu.addAction('', () => {});
    this._statusItem.setSensitive(false);
    this._indicator.menu.addAction('Settings', () => this.openPreferences());
    Main.panel.addToStatusArea(this.uuid, this._indicator);
    this._areaSignals = [
      [
        this._settings,
        this._settings.connect('changed::librechat-shot-area', () => this._clearArea()),
      ],
      [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._clearArea())],
      [Main.sessionMode, Main.sessionMode.connect('updated', () => this._clearArea())],
    ];
    const bindings = {
      'librechat-shot-window': () => void this._takeWindow(),
      'librechat-shot-area': () => this._takeArea(),
      'librechat-shot-microphone': () => void this._relay('microphone'),
      'librechat-shot-browser': () => void this._relay('browser'),
      'librechat-shot-external-app': () => void this._relay('externalApp'),
    };
    for (const [name, activate] of Object.entries(bindings)) {
      const registered = Main.wm.addKeybinding(
        name,
        this._settings,
        Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
        Shell.ActionMode.NORMAL,
        activate,
      );
      if (registered === Meta.KeyBindingAction.NONE) {
        console.error(`[LibreChat Shot] Could not register ${name}.`);
      } else {
        this._registered.push(name);
      }
    }
    this._updateIndicator();
    void this._refreshRecording();
  }

  disable() {
    this._setRecording(null);
    this._clearArea();
    this._indicator?.destroy();
    this._indicator = null;
    this._icon = null;
    this._dot = null;
    this._statusItem = null;
    for (const [object, id] of this._areaSignals ?? []) {
      object.disconnect(id);
    }
    this._areaSignals = [];
    this._settings = null;
    for (const name of this._registered ?? []) {
      Main.wm.removeKeybinding(name);
    }
    this._registered = [];
    const session = this._session;
    this._session = null;
    session?.abort();
    this._pending = null;
    this._recordingCheck = null;
    this._config = null;
  }

  _clearArea() {
    this._corner = null;
    if (this._areaTimeout) {
      GLib.Source.remove(this._areaTimeout);
      this._areaTimeout = 0;
    }
    this._updateIndicator();
  }

  _updateIndicator() {
    if (this._icon == null) {
      return;
    }
    const source = this._recording == null ? null : sources[this._recording];
    const selecting = this._corner != null;
    this._dot.visible = source != null || selecting;
    this._icon.icon_name = source?.icon ?? 'camera-photo-symbolic';
    const label = source?.label ?? (selecting ? 'Select the opposite corner' : 'Ready');
    this._statusItem.label.text = label;
    this._indicator.accessible_name = `LibreChat Shot: ${label}`;
  }

  _setRecording(source) {
    this._recording = source;
    if (source != null && !this._recordingTimer) {
      // The bridge can stop recording without a hotkey, for example when the tab closes.
      this._recordingTimer = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        RECORDING_CHECK_INTERVAL,
        () => {
          void this._refreshRecording();
          return GLib.SOURCE_CONTINUE;
        },
      );
    } else if (source == null && this._recordingTimer) {
      GLib.Source.remove(this._recordingTimer);
      this._recordingTimer = 0;
    }
    this._updateIndicator();
  }

  async _refreshRecording() {
    const session = this._session;
    if (session == null || this._pending != null || this._recordingCheck != null) {
      return;
    }
    const message = this._bridgeMessage('GET', 'recording');
    this._recordingCheck = message;
    try {
      const response = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
      if (this._recordingCheck === message && message.get_status() === Soup.Status.OK) {
        const source = new TextDecoder().decode(response.get_data());
        if (source === '' || Object.hasOwn(sources, source)) {
          this._setRecording(source || null);
        }
      }
    } catch {
      // Keep the last verified state until the bridge responds again.
    } finally {
      if (this._recordingCheck === message) {
        this._recordingCheck = null;
      }
    }
  }

  _takeWindow() {
    this._clearArea();
    return this._relay(null);
  }

  _takeArea() {
    if (this._session == null || this._pending != null) {
      return;
    }
    // The pointer and screenshot API both use stage coordinates. Mutter applies output scaling.
    const [x, y] = global.get_pointer();
    if (x < 0 || y < 0 || x >= global.screen_width || y >= global.screen_height) {
      this._clearArea();
      this._showStatus('camera-photo-symbolic', 'No capture area selected');
      return;
    }
    if (this._corner == null) {
      this._corner = [x, y];
      this._updateIndicator();
      this._areaTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, AREA_TIMEOUT, () => {
        this._areaTimeout = 0;
        this._clearArea();
        return GLib.SOURCE_REMOVE;
      });
      return;
    }
    const [startX, startY] = this._corner;
    this._clearArea();
    const left = Math.min(startX, x);
    const top = Math.min(startY, y);
    const right = Math.max(startX, x);
    const bottom = Math.max(startY, y);
    if (left === right || top === bottom) {
      this._showStatus('camera-photo-symbolic', 'No capture area selected');
      return;
    }
    void this._relay(null, [left, top, right - left + 1, bottom - top + 1]);
  }

  _showStatus(iconName, label) {
    const icon = Gio.ThemedIcon.new(iconName);
    Main.osdWindowManager.showAll(icon, label, null);
  }

  _bridgeMessage(method, route) {
    const { port, token } = this._config;
    const message = Soup.Message.new(method, `http://127.0.0.1:${port}/${route}`);
    message.set_flags(Soup.MessageFlags.NO_REDIRECT);
    message.get_request_headers().append('X-Token', token);
    return message;
  }

  async _relay(action, area) {
    const session = this._session;
    if (session == null || this._pending != null) {
      return;
    }
    this._pending = session;
    if (action != null) {
      this._recordingCheck = null;
    }
    let refresh = false;
    try {
      const png = action == null;
      const body = png
        ? await captureScreenshot(area)
        : new GLib.Bytes(new TextEncoder().encode(action));
      if (this._session !== session) {
        return;
      }
      const message = this._bridgeMessage('POST', png ? 'upload' : 'command');
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
        if (state === 'recording-started') {
          this._setRecording(action);
          return;
        }
        if (state === 'audio-delivered' || state === 'recording-canceled') {
          this._setRecording(null);
          return;
        }
      }
      throw new Error(`The bridge returned HTTP ${status}.`);
    } catch (error) {
      if (this._session === session) {
        console.error(`[LibreChat Shot] ${error.message}`);
        if (action != null) {
          refresh = true;
          this._showStatus('audio-input-microphone-symbolic', 'Audio action failed');
        } else if (area != null) {
          this._showStatus('camera-photo-symbolic', 'Could not send the screenshot');
        }
      }
    } finally {
      if (this._pending === session) {
        this._pending = null;
        if (refresh) {
          void this._refreshRecording();
        }
      }
    }
  }
}
