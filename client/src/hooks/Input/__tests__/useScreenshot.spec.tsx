import { useRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, render, screen } from '@testing-library/react';
import type { UploadLifecycleCallbacks } from '~/hooks/Files/useFileHandling';
import type { ExtendedFile } from '~/common';
import { autoSendScreenshotAtom } from '~/store/screenshot';
import useScreenshot from '../useScreenshot';

function setup(enabled = true) {
  const store = createStore();
  store.set(autoSendScreenshotAtom, enabled);
  const submit = jest.fn();
  const onError = jest.fn();
  let upload: UploadLifecycleCallbacks | undefined;
  const routeFiles = jest.fn(async (_files, _destination, lifecycle?: UploadLifecycleCallbacks) => {
    upload = lifecycle;
    return true;
  });
  type Props = { hasDraft?: boolean; files?: Map<string, ExtendedFile>; canAttach?: boolean };
  function Harness({ hasDraft = false, files = new Map(), canAttach = true }: Props) {
    const surface = useRef<HTMLDivElement>(null);
    useScreenshot({
      surface,
      index: 30,
      conversationId: 'new',
      files,
      hasDraft: () => hasDraft,
      canAttach,
      canSend: true,
      routeFiles,
      submit,
      onError,
    });
    return <div ref={surface} data-testid="composer" />;
  }
  const tree = (props: Props = {}) => (
    <Provider store={store}>
      <Harness {...props} />
    </Provider>
  );
  const view = render(tree());
  const rerender = (props: Props) => view.rerender(tree(props));
  function receive() {
    const file = new File(['png'], 'window.png', { type: 'image/png' });
    const event = new CustomEvent('librechat:attach-screenshot', {
      detail: file,
      cancelable: true,
    });
    act(() => screen.getByTestId('composer').dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
  }
  function attachment(progress: number) {
    const id = upload?.fileId ?? '';
    expect(id).not.toBe('');
    return new Map([[id, { file_id: id, progress } as ExtendedFile]]);
  }
  function succeed() {
    const id = upload?.fileId ?? '';
    upload?.onSuccess?.(id);
    rerender({ files: attachment(1) });
  }
  return {
    submit,
    onError,
    store,
    routeFiles,
    rerender,
    receive,
    attachment,
    succeed,
    fail: () => upload?.onError?.(upload.fileId ?? ''),
  };
}

describe('LibreChat Shot auto-send', () => {
  beforeEach(() => localStorage.clear());

  it('attaches but does not send when disabled', () => {
    const view = setup(false);
    view.receive();
    view.succeed();
    expect(view.routeFiles).toHaveBeenCalledTimes(1);
    expect(view.submit).not.toHaveBeenCalled();
  });

  it('sends only once after upload success and the attachment is ready', () => {
    const view = setup();
    view.receive();
    view.rerender({ files: view.attachment(0.6) });
    expect(view.submit).not.toHaveBeenCalled();
    view.succeed();
    view.rerender({ files: view.attachment(1) });
    expect(view.submit).toHaveBeenCalledTimes(1);
  });

  it.each([
    'existing draft',
    'draft edit',
    'another attachment',
    'disabled',
    'failed upload',
    'route change',
  ])('leaves the screenshot unsent after %s', (condition) => {
    const view = setup();
    if (condition === 'existing draft') view.rerender({ hasDraft: true });
    view.receive();
    if (condition === 'draft edit') view.rerender({ hasDraft: true });
    if (condition === 'another attachment') {
      const files = view.attachment(0.6);
      files.set('other', { file_id: 'other', progress: 1 } as ExtendedFile);
      view.rerender({ files });
    }
    if (condition === 'disabled') act(() => view.store.set(autoSendScreenshotAtom, false));
    if (condition === 'failed upload') view.fail();
    if (condition === 'route change') window.history.replaceState(null, '', '/c/other');
    try {
      view.succeed();
      expect(view.submit).not.toHaveBeenCalled();
    } finally {
      if (condition === 'route change') window.history.replaceState(null, '', '/');
    }
  });

  it('does not fall back to a file input when the composer rejects the upload', () => {
    const view = setup();
    view.rerender({ canAttach: false });
    view.receive();
    expect(view.routeFiles).not.toHaveBeenCalled();
    expect(view.onError).toHaveBeenCalledTimes(1);
  });
});
