import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const shortcuts = {
  'librechat-shot-browser': 'Browser audio',
  'librechat-shot-external-app': 'External app audio',
  'librechat-shot-microphone': 'Microphone',
  'librechat-shot-window': 'Capture the focused window',
  'librechat-shot-area': 'Capture a screen area',
};

function normalize(text) {
  const [parsed, key, modifiers] = Gtk.accelerator_parse(text);
  const required =
    Gdk.ModifierType.CONTROL_MASK |
    Gdk.ModifierType.ALT_MASK |
    Gdk.ModifierType.SUPER_MASK |
    Gdk.ModifierType.META_MASK;
  return parsed && modifiers & required && Gtk.accelerator_valid(key, modifiers)
    ? Gtk.accelerator_name(key, modifiers)
    : null;
}

export default class LibreChatShotPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage({ title: 'LibreChat Shot' });
    const group = new Adw.PreferencesGroup({
      title: 'Global shortcuts',
      description:
        'Enter a shortcut such as <Super><Alt>q, then select Apply. Leave the field empty to disable it.',
    });
    page.add(group);
    window.add(page);

    for (const [key, title] of Object.entries(shortcuts)) {
      const row = new Adw.EntryRow({
        title,
        text: settings.get_strv(key).join(', '),
        show_apply_button: true,
        use_markup: false,
      });
      const status = new Gtk.Label({ wrap: true, visible: false });
      status.add_css_class('error');
      row.add_suffix(status);
      const reset = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: `Reset ${title.toLowerCase()} shortcut`,
        valign: Gtk.Align.CENTER,
      });
      reset.connect('clicked', () => {
        settings.reset(key);
        row.text = settings.get_strv(key).join(', ');
        status.visible = false;
      });
      row.add_suffix(reset);
      row.connect('apply', () => {
        const text = row.text.trim();
        const values = text === '' ? [] : text.split(',').map((value) => normalize(value.trim()));
        const used = new Set(
          Object.keys(shortcuts)
            .filter((other) => other !== key)
            .flatMap((other) => settings.get_strv(other).map(normalize)),
        );
        if (values.some((value) => value == null)) {
          status.label = 'Enter a key with Ctrl, Alt, or Super.';
        } else if (
          new Set(values).size !== values.length ||
          values.some((value) => used.has(value))
        ) {
          status.label = 'This shortcut is already assigned in LibreChat Shot.';
        } else if (settings.set_strv(key, values)) {
          row.text = settings.get_strv(key).join(', ');
          status.visible = false;
          return;
        } else {
          status.label = 'Could not save the shortcut.';
        }
        status.visible = true;
      });
      group.add(row);
    }
  }
}
