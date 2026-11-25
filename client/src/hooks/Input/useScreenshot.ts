import { useEffect, useRef } from 'react';
import { v4 } from 'uuid';
import { useAtomValue } from 'jotai';
import type useFileUploadRouter from '~/hooks/Files/useFileUploadRouter';
import type { CapturedComposerDraft } from '~/utils/drafts';
import type { ExtendedFile } from '~/common';
import { autoSendScreenshotAtom } from '~/store/screenshot';
import { captureComposerDraft } from '~/utils/drafts';

const EVENT = 'librechat:attach-screenshot';
const LIMIT = 25 * 1024 * 1024;

export default function useScreenshot({
  surface,
  index,
  conversationId,
  files,
  hasDraft,
  canAttach,
  canSend,
  routeFiles,
  submit,
  onError,
}: {
  surface: React.RefObject<HTMLDivElement>;
  index: number;
  conversationId: string;
  files: ReadonlyMap<string, ExtendedFile>;
  hasDraft: () => boolean;
  canAttach: boolean;
  canSend: boolean;
  routeFiles: ReturnType<typeof useFileUploadRouter>;
  submit: () => void;
  onError: () => void;
}) {
  const enabled = useAtomValue(autoSendScreenshotAtom);
  const pending = useRef<{ id: string; uploaded: boolean; owner: CapturedComposerDraft } | null>(
    null,
  );
  const receive = useRef<(event: Event) => void>();
  receive.current = (event) => {
    const file = (event as CustomEvent<File>).detail;
    if (
      !(file instanceof File) ||
      file.type !== 'image/png' ||
      file.size === 0 ||
      file.size > LIMIT
    ) {
      return;
    }
    event.preventDefault();
    if (!canAttach) {
      onError();
      return;
    }
    const owner = captureComposerDraft(index, conversationId);
    if (!owner()) {
      onError();
      return;
    }
    const id = v4();
    const take = { id, uploaded: false, owner };
    pending.current =
      enabled && canSend && !hasDraft() && files.size === 0 && pending.current == null
        ? take
        : null;
    const clear = () => {
      if (pending.current === take) {
        pending.current = null;
      }
    };
    void routeFiles([file], undefined, {
      fileId: id,
      isCurrent: owner,
      onSuccess: () => {
        take.uploaded = true;
      },
      onError: clear,
      onAbort: clear,
    })
      .then((accepted) => {
        if (!accepted) {
          clear();
        }
      })
      .catch(() => {
        clear();
        if (owner()) {
          onError();
        }
      });
  };

  useEffect(() => {
    const element = surface.current;
    if (element == null) {
      return;
    }
    const listener = (event: Event) => receive.current?.(event);
    element.addEventListener(EVENT, listener);
    return () => element.removeEventListener(EVENT, listener);
  }, [surface]);

  useEffect(() => {
    const take = pending.current;
    if (take == null) {
      return;
    }
    const file = files.get(take.id);
    if (!enabled || !canSend || hasDraft() || !take.owner() || files.size > (file ? 1 : 0)) {
      pending.current = null;
      return;
    }
    // Upload success can run before the file map contains the completed attachment.
    if (take.uploaded && (file == null || file.progress === 1)) {
      pending.current = null;
      if (file != null) {
        submit();
      }
    }
  });
}
