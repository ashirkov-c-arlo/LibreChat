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
       <button type="button" data-local-audio="new">Capture</button>
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

  deliver(new window.Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer);

  assert.deepEqual(receipts, ['accepted']);
  assert.equal(received.length, 1);
  assert.match(received[0].name, /^window-.*\.png$/);
  assert.equal(received[0].type, 'image/png');
  assert.equal(document.activeElement.id, 'other');
  assert.equal(document.querySelector('[data-chat-pane="1"] input').files.length, 0);
});

function wav(window) {
  return window.Uint8Array.from('RIFF0000WAVE', (char) => char.charCodeAt(0)).buffer;
}

test('passes local WAV to STT without starting browser recording or moving focus', (context) => {
  const { window, document, receipts, deliver } = setup(context);
  const files = [];
  const capture = document.querySelector('[data-local-audio]');
  const other = document.querySelector('#other');
  capture.addEventListener('click', () => assert.fail('Unexpected browser recording'));
  capture.addEventListener('librechat:transcribe-local-audio', (event) => {
    if (event.detail != null) {
      files.push(event.detail);
    }
    event.preventDefault();
  });
  other.focus();
  deliver('arm-audio');
  deliver(wav(window));

  assert.deepEqual(receipts, ['accepted', 'accepted']);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'recording.wav');
  assert.equal(files[0].type, 'audio/wav');
  assert.equal(document.activeElement, other);
});

test('rejects audio from an old conversation, a disabled control or an old bridge', (context) => {
  const { window, document, receipts, deliver } = setup(context);
  const capture = document.querySelector('[data-local-audio]');
  capture.addEventListener('librechat:transcribe-local-audio', (event) => {
    assert.equal(event.detail, null);
    event.preventDefault();
  });
  deliver('arm-audio');
  capture.setAttribute('data-local-audio', 'another-chat');
  deliver(wav(window));
  capture.disabled = true;
  deliver('arm-audio');
  deliver('microphone');
  assert.deepEqual(receipts, ['accepted', 'unavailable', 'unavailable', 'unavailable']);
});
