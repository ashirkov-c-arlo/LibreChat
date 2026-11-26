const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const script = readFileSync(join(__dirname, 'extension/extension.js'), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('export default class', 'class');

function setup() {
  let point = [0, 0];
  let timerId = 0;
  const timers = new Map();
  const relays = [];
  const status = [];
  let source = '';
  const context = {
    TextDecoder,
    TextEncoder,
    Extension: class {},
    global: { screen_width: 1920, screen_height: 1080, get_pointer: () => point },
    GLib: {
      timeout_add_seconds: (_priority, seconds, callback) => {
        assert.ok(seconds === 2 || seconds === 20);
        timers.set(++timerId, { seconds, callback });
        return timerId;
      },
      Source: { remove: (id) => assert.ok(timers.delete(id)) },
      Bytes: class {},
    },
    Soup: { Status: { OK: 200 } },
  };
  const extension = runInNewContext(`${script}\nnew LibreChatShot()`, context);
  const relay = extension._relay.bind(extension);
  extension._session = {
    send_and_read_async: async () => ({ get_data: () => Buffer.from(source) }),
  };
  extension._bridgeMessage = () => ({ get_status: () => 200, set_request_body_from_bytes() {} });
  extension._icon = { icon_name: 'camera-photo-symbolic' };
  extension._dot = { visible: false };
  extension._statusItem = { label: { text: 'Ready' } };
  extension._indicator = { accessible_name: 'LibreChat Shot: Ready' };
  extension._relay = (...args) => relays.push(JSON.parse(JSON.stringify(args)));
  extension._showStatus = (_icon, label) => status.push(label);
  return {
    relays,
    status,
    timers,
    dot: extension._dot,
    label: extension._statusItem.label,
    async command(action, response) {
      source = response;
      await relay(action);
    },
    async report(action) {
      source = action;
      await extension._refreshRecording();
    },
    icon: extension._icon,
    indicator: extension._indicator,
    press(x, y) {
      point = [x, y];
      extension._takeArea();
    },
    expireArea() {
      const [id, timer] = [...timers].find(([, timer]) => timer.seconds === 20);
      timers.delete(id);
      timer.callback();
    },
    captureWindow() {
      extension._takeWindow();
    },
  };
}

test('two opposite corners capture the same rectangle in either order', () => {
  for (const [first, second] of [
    [
      [100, 300],
      [10, 20],
    ],
    [
      [10, 20],
      [100, 300],
    ],
  ]) {
    const shell = setup();
    shell.press(...first);
    assert.equal(shell.icon.icon_name, 'camera-photo-symbolic');
    assert.equal(shell.dot.visible, true);
    assert.match(shell.indicator.accessible_name, /opposite corner/);
    assert.equal(shell.status.length, 0);
    assert.equal(shell.relays.length, 0);
    shell.press(...second);
    assert.deepEqual(shell.relays, [[null, [10, 20, 91, 281]]]);
    assert.equal(shell.icon.icon_name, 'camera-photo-symbolic');
    assert.equal(shell.dot.visible, false);
    assert.equal(shell.indicator.accessible_name, 'LibreChat Shot: Ready');
    assert.equal(shell.timers.size, 0);
  }
});

test('empty or out-of-bounds selections do not send a screenshot', () => {
  for (const second of [
    [10, 40],
    [1920, 40],
  ]) {
    const shell = setup();
    shell.press(10, 20);
    shell.press(...second);
    assert.equal(shell.relays.length, 0);
    assert.equal(shell.status.length, 1);
    assert.equal(shell.timers.size, 0);
    assert.equal(shell.icon.icon_name, 'camera-photo-symbolic');
    assert.equal(shell.dot.visible, false);
  }
});

test('shows a recording dot next to the source icon for Q, W, and E', async () => {
  const shell = setup();
  for (const [action, label, icon] of [
    ['browser', 'browser audio', 'audio-headphones-symbolic'],
    ['externalApp', 'external app audio', 'audio-volume-high-symbolic'],
    ['microphone', 'microphone', 'audio-input-microphone-symbolic'],
  ]) {
    await shell.command(action, 'recording-started');
    assert.equal(shell.icon.icon_name, icon);
    assert.equal(shell.dot.visible, true);
    assert.equal(shell.label.text, `Recording ${label}`);
    assert.equal(shell.indicator.accessible_name, `LibreChat Shot: Recording ${label}`);
    assert.equal(shell.status.length, 0);
    await shell.command(action, 'audio-delivered');
    assert.equal(shell.icon.icon_name, 'camera-photo-symbolic');
    assert.equal(shell.dot.visible, false);
    assert.equal(shell.timers.size, 0);
  }
});

test('recording takes precedence over area selection and a bridge stop restores camera mode', async () => {
  const shell = setup();
  await shell.report('browser');
  shell.press(10, 20);
  assert.equal(shell.icon.icon_name, 'audio-headphones-symbolic');
  shell.expireArea();
  assert.equal(shell.icon.icon_name, 'audio-headphones-symbolic');
  assert.equal(shell.dot.visible, true);
  await shell.report('');
  assert.equal(shell.icon.icon_name, 'camera-photo-symbolic');
  assert.equal(shell.dot.visible, false);
  assert.equal(shell.timers.size, 0);
});

test('expiry clears the first corner and a window capture cancels pending area selection', () => {
  const shell = setup();
  shell.press(10, 20);
  shell.expireArea();
  assert.equal(shell.icon.icon_name, 'camera-photo-symbolic');
  assert.equal(shell.dot.visible, false);
  shell.press(50, 60);
  assert.equal(shell.relays.length, 0);
  shell.captureWindow();
  assert.deepEqual(shell.relays, [[null]]);
  assert.equal(shell.timers.size, 0);
  assert.equal(shell.icon.icon_name, 'camera-photo-symbolic');
  assert.equal(shell.dot.visible, false);
  shell.press(100, 200);
  assert.equal(shell.relays.length, 1);
  assert.equal(shell.icon.icon_name, 'camera-photo-symbolic');
  assert.equal(shell.dot.visible, true);
});
