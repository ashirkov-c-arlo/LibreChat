import { memo, useId, useRef, useMemo, useState, useEffect, useCallback } from 'react';
import * as Ariakit from '@ariakit/react';
import { AudioLines, Check, ChevronDown, createLucideIcon } from 'lucide-react';
import {
  Spinner,
  IconButton,
  DropdownPopup,
  TooltipAnchor,
  disabledInkClasses,
} from '@librechat/client';
import type { BrowserAudio as BrowserAudioState } from '~/hooks/Input/useBrowserAudio';
import type { CaptureSource } from '~/hooks/Input/capture';
import type { MenuItemProps } from '~/common';
import {
  CAPTURE_SHORTCUT_EVENT,
  captureSourceLabels,
  getCaptureSource,
} from '~/hooks/Input/capture';
import { useShortcutAriaKey, useShortcutDisplay } from '~/hooks/useKeyboardShortcuts';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const AudioLinesOff = createLucideIcon('audio-lines-off', [
  ['path', { d: 'M10 10v11', key: 'tkf9cx' }],
  ['path', { d: 'M10 3v1.35', key: '1rsffz' }],
  ['path', { d: 'M14 14v1', key: 'hsexio' }],
  ['path', { d: 'M14 8v.35', key: 'isohmc' }],
  ['path', { d: 'M18 5v7.35', key: '1b0cqo' }],
  ['path', { d: 'M2 10v3', key: '1fnikh' }],
  ['path', { d: 'm2 2 20 20', key: '1ooewy' }],
  ['path', { d: 'M22 10v3', key: '154ddg' }],
  ['path', { d: 'M6 6v11', key: '11sgs0' }],
]);

interface BrowserAudioProps {
  audio: BrowserAudioState;
  /** Speech is gated off, or the microphone is busy with its own take. */
  disabled: boolean;
}

/** Records audio from a virtual capture device. */
function BrowserAudio({ audio, disabled }: BrowserAudioProps) {
  const localize = useLocalize();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { listening, loading, devices, selectedDeviceId, loadDevices, selectDevice, start, stop } =
    audio;
  const unavailable = loading || (!listening && disabled);
  const browserDisplay = useShortcutDisplay('captureBrowserAudio');
  const externalDisplay = useShortcutDisplay('captureExternalAppAudio');
  const browserAriaKey = useShortcutAriaKey('captureBrowserAudio');
  const externalAriaKey = useShortcutAriaKey('captureExternalAppAudio');
  const ariaKey = [browserAriaKey, externalAriaKey].filter(Boolean).join(' ') || undefined;
  const shortcuts = [browserDisplay, externalDisplay].filter(Boolean).join(' / ');

  const toggle = useCallback(
    (source?: CaptureSource) => {
      if (!unavailable) {
        if (listening) {
          stop();
        } else {
          start(source);
        }
      }
    },
    [unavailable, listening, start, stop],
  );

  useEffect(() => {
    const button = buttonRef.current;
    if (button == null) {
      return;
    }
    const onShortcut = (event: Event) => toggle((event as CustomEvent<CaptureSource>).detail);
    button.addEventListener(CAPTURE_SHORTCUT_EVENT, onShortcut);
    return () => button.removeEventListener(CAPTURE_SHORTCUT_EVENT, onShortcut);
  }, [toggle]);

  const onMenuOpenChange = useCallback(
    (open: boolean) => {
      setMenuOpen(open);
      if (open) {
        void loadDevices();
      }
    },
    [loadDevices],
  );

  const items = useMemo<MenuItemProps[]>(() => {
    if (devices.length === 0) {
      return [
        {
          id: 'no-browser-audio-devices',
          label: localize('com_ui_browser_audio_no_devices'),
          disabled: true,
          hideOnClick: false,
        },
      ];
    }
    return devices.map((device) => {
      const selected = selectedDeviceId === device.deviceId;
      const source = getCaptureSource(device.label);
      return {
        id: device.deviceId,
        label: source === 'externalApp' ? localize(captureSourceLabels[source]) : device.label,
        ariaChecked: selected,
        ariaRole: 'menuitemradio',
        icon: selected ? <Check className="size-4" aria-hidden="true" /> : undefined,
        onClick: () => void selectDevice(device.deviceId),
      };
    });
  }, [devices, selectedDeviceId, localize, selectDevice]);

  const label = localize(listening ? 'com_ui_browser_audio_stop' : 'com_ui_browser_audio_start');
  let icon = <AudioLines className="size-5" aria-hidden="true" />;
  if (loading) {
    icon = <Spinner className="size-5" />;
  } else if (listening) {
    icon = <AudioLinesOff className="size-5" aria-hidden="true" />;
  }

  return (
    <div className="flex items-center">
      <TooltipAnchor
        description={shortcuts ? `${label} (${shortcuts})` : label}
        render={
          <IconButton
            ref={buttonRef}
            data-testid="browser-audio-recorder"
            label={label}
            size="md"
            shape="composer"
            variant={listening ? 'destructive' : 'ghost'}
            onClick={() => toggle()}
            disabled={unavailable}
            aria-keyshortcuts={unavailable ? undefined : ariaKey}
            aria-pressed={listening}
          >
            <span
              className={cn(
                'flex h-full w-full items-center justify-center',
                !listening && 'text-text-secondary hover:text-text-primary transition-colors',
              )}
            >
              {icon}
            </span>
          </IconButton>
        }
      />
      <DropdownPopup
        portal
        unmountOnHide
        menuId={menuId}
        isOpen={menuOpen}
        setIsOpen={onMenuOpenChange}
        trigger={
          <Ariakit.MenuButton
            id="browser-audio-devices"
            render={<button type="button" />}
            disabled={disabled && !listening}
            aria-label={localize('com_ui_browser_audio_devices')}
            title={localize('com_ui_browser_audio_devices')}
            className={cn(
              'text-text-secondary hover:bg-surface-hover hover:text-text-primary flex h-6 w-3.5 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50',
              disabledInkClasses,
            )}
          >
            <ChevronDown className="size-3" aria-hidden="true" />
          </Ariakit.MenuButton>
        }
        items={items}
      />
    </div>
  );
}

export default memo(BrowserAudio);
