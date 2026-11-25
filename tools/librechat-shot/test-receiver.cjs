const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const source = readFileSync(join(__dirname, 'receiver.user.js'), 'utf8');
const config = { origin: 'https://chat.example.com', port: 17321, token: 'f'.repeat(64) };

function setup(context) {
  const { window } = new JSDOM(
    `<button id="other">Other</button>
     <section data-chat-pane="0"><form>
       <textarea data-testid="text-input"></textarea>
       <input type="file" hidden>
       <button type="button" data-composer-shortcut="toggleMicrophone">Microphone</button>
       <button type="button" data-testid="browser-audio-recorder">Capture</button>
     </form></section>
     <section data-chat-pane="1"><input type="file" hidden></section>`,
    { url: `${config.origin}/c/new#librechat-shot`, runScripts: 'outside-only' },
  );
  context.after(() => window.close());
  const receipts = [];
  const connections = [];
  const { document } = window;
  window.HTMLElement.prototype.getClientRects = () => [{}];
  window.DataTransfer = class {
    files = [];
    items = { add: (file) => this.files.push(file) };
  };
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor(url) {
      this.url = url;
      connections.push(this);
    }
    send(receipt) {
      receipts.push(receipt);
    }
  };
  const input = document.querySelector('form input[type="file"]');
  Object.defineProperty(input, 'files', { value: [], writable: true });
  window.eval(source.replace('/* __LIBRECHAT_CONFIG__ */ null', JSON.stringify(config)));
  assert.equal(connections.length, 1);
  const [connection] = connections;
  assert.equal(connection.url.origin, 'ws://127.0.0.1:17321');
  assert.equal(connection.url.searchParams.get('token'), config.token);
  return { window, document, input, receipts, deliver: (data) => connection.onmessage({ data }) };
}

test('passes PNG to the main draft without moving focus or submitting', (context) => {
  const { window, document, input, receipts, deliver } = setup(context);
  const received = [];
  input.addEventListener('change', () => received.push(...input.files));
  document.querySelector('form').addEventListener('submit', () => assert.fail('Unexpected submit'));
  document.querySelector('#other').focus();

  deliver(new window.ArrayBuffer(8));

  assert.deepEqual(receipts, ['accepted']);
  assert.equal(received.length, 1);
  assert.match(received[0].name, /^window-.*\.png$/);
  assert.equal(received[0].type, 'image/png');
  assert.equal(document.activeElement.id, 'other');
  assert.equal(document.querySelector('[data-chat-pane="1"] input').files.length, 0);
});

test('uses the existing controls and does not activate unavailable controls', (context) => {
  const { document, receipts, deliver } = setup(context);
  const calls = [];
  const mic = document.querySelector('[data-composer-shortcut]');
  const capture = document.querySelector('[data-testid="browser-audio-recorder"]');
  mic.addEventListener('click', () => calls.push('mic'));
  capture.addEventListener('librechat:capture-shortcut', ({ detail }) => calls.push(detail));

  deliver('microphone');
  deliver('browser');
  deliver('externalApp');
  capture.disabled = true;
  deliver('browser');
  deliver('submit');

  assert.deepEqual(calls, ['mic', 'browser', 'externalApp']);
  assert.deepEqual(receipts, ['accepted', 'accepted', 'accepted', 'unavailable', 'unavailable']);
});
