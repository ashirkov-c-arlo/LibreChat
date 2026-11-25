// ==UserScript==
// @name        LibreChat Shot
// @namespace   librechat-shot@local
// @version     2.0.0
// @match       __LIBRECHAT_MATCH__
// @grant       none
// @noframes
// @run-at      document-idle
// ==/UserScript==

(() => {
  'use strict';
  const config = /* __LIBRECHAT_CONFIG__ */ null;
  if (config == null || location.origin !== config.origin || window.top !== window) {
    return;
  }

  let armed = false;
  let socket = null;
  let retryTimer;
  let retryDelay = 1000;
  let audioTarget = null;

  function isUsable(element) {
    return (
      element != null &&
      !element.matches(':disabled, [aria-disabled="true"]') &&
      element.closest('[hidden], [inert], [aria-hidden="true"]') == null &&
      element.getClientRects().length !== 0 &&
      getComputedStyle(element).visibility === 'visible'
    );
  }

  function attachPng(pane, bytes) {
    const textarea = pane.querySelector('textarea[data-testid="text-input"]');
    const form = textarea?.closest('form');
    if (!isUsable(textarea) || form == null || bytes.byteLength === 0) {
      return false;
    }
    const inputs = form.querySelectorAll('input[type="file"]');
    if (inputs.length > 1 || inputs[0]?.matches(':disabled')) {
      return false;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = new File([bytes], `window-${stamp}.png`, { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    if (inputs.length === 1) {
      inputs[0].files = transfer.files;
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      textarea.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }
    return true;
  }

  function routeAudio(button, audio) {
    const event = new CustomEvent('librechat:transcribe-local-audio', {
      cancelable: true,
      detail: audio,
    });
    return !button.dispatchEvent(event);
  }

  function deliver(data) {
    const panes = document.querySelectorAll('[data-chat-pane="0"]');
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
    if (panes.length !== 1 || !isUsable(panes[0]) || Array.from(dialogs).some(isUsable)) {
      return false;
    }
    const pane = panes[0];
    const button = pane.querySelector('button[data-local-audio]');
    if (data === 'arm-audio') {
      audioTarget = null;
      if (!isUsable(button) || !routeAudio(button, null)) {
        return false;
      }
      audioTarget = {
        button,
        path: location.pathname,
        owner: button.getAttribute('data-local-audio'),
      };
      return true;
    }
    if (!(data instanceof ArrayBuffer)) {
      return false;
    }
    const bytes = new Uint8Array(data, 0, Math.min(data.byteLength, 12));
    const signature = String.fromCharCode(...bytes);
    if (signature.startsWith('\x89PNG\r\n\x1a\n')) {
      return attachPng(pane, data);
    }
    if (!signature.startsWith('RIFF') || signature.slice(8) !== 'WAVE') {
      return false;
    }
    const target = audioTarget;
    audioTarget = null;
    if (
      target == null ||
      target.button !== button ||
      target.path !== location.pathname ||
      target.owner !== button.getAttribute('data-local-audio') ||
      !isUsable(button)
    ) {
      return false;
    }
    return routeAudio(button, new File([data], 'recording.wav', { type: 'audio/wav' }));
  }

  function connect() {
    if (!armed || socket != null) {
      return;
    }
    const endpoint = new URL(`ws://127.0.0.1:${config.port}/ws`);
    endpoint.searchParams.set('token', config.token);
    let connection;
    try {
      connection = new WebSocket(endpoint);
    } catch {
      armed = false;
      console.error('[LibreChat Shot] Firefox blocked the bridge connection.');
      return;
    }
    socket = connection;
    connection.binaryType = 'arraybuffer';
    connection.onmessage = (event) => {
      if (!armed || socket !== connection) {
        return;
      }
      if (event.data === 'ready' || event.data === 'ready-v2') {
        retryDelay = 1000;
        console.info('[LibreChat Shot] This tab is connected.');
        if (event.data === 'ready') {
          console.warn('[LibreChat Shot] Update the local bridge to use audio shortcuts.');
        }
        return;
      }
      let accepted = false;
      try {
        accepted = deliver(event.data);
      } catch {
        console.error('[LibreChat Shot] Could not pass the action to the chat.');
      }
      if (connection.readyState === WebSocket.OPEN) {
        connection.send(accepted ? 'accepted' : 'unavailable');
      }
    };
    connection.onclose = (event) => {
      if (socket !== connection) {
        return;
      }
      socket = null;
      audioTarget = null;
      if (event.code === 4009) {
        disconnect();
        console.warn('[LibreChat Shot] Another tab is already connected.');
        return;
      }
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(30_000, retryDelay * 2);
    };
  }

  function disconnect() {
    armed = false;
    audioTarget = null;
    clearTimeout(retryTimer);
    const connection = socket;
    socket = null;
    connection?.close();
    retryDelay = 1000;
  }

  function selectTab() {
    const hash = location.hash;
    if (hash !== '#librechat-shot' && hash !== '#librechat-shot-off') {
      return;
    }
    history.replaceState(history.state, '', location.pathname + location.search);
    if (hash === '#librechat-shot-off') {
      disconnect();
    } else if (!armed) {
      armed = true;
      connect();
    }
  }

  window.addEventListener('hashchange', selectTab);
  window.addEventListener('pagehide', disconnect);
  selectTab();
})();
