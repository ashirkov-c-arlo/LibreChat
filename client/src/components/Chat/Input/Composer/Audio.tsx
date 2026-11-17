import { memo, useId, useMemo, useState, useCallback } from 'react';
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
import type { MenuItemProps } from '~/common';
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

/** Records a `librechat_` capture device (browser audio), with a picker for which one. */
function BrowserAudio({ audio, disabled }: BrowserAudioProps) {
  const localize = useLocalize();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const { listening, loading, devices, selectedDeviceId, loadDevices, selectDevice } = audio;

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
      return {
        id: device.deviceId,
        label: device.label,
        ariaChecked: selected,
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
        description={label}
        render={
          <IconButton
            id="browser-audio-recorder"
            label={label}
            size="md"
            shape="composer"
            variant={listening ? 'destructive' : 'ghost'}
            onClick={listening ? audio.stop : audio.start}
            disabled={loading || (!listening && disabled)}
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
