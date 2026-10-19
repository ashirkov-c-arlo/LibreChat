import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AudioLines, Check, ChevronDown, createLucideIcon, MicOff } from 'lucide-react';
import * as Ariakit from '@ariakit/react';
import { useRecoilValue } from 'recoil';
import {
  IconButton,
  DropdownPopup,
  useToastContext,
  TooltipAnchor,
  ListeningIcon,
  Spinner,
} from '@librechat/client';
import { useLocalize, useSpeechToText, useGetAudioSettings } from '~/hooks';
import { globalAudioId, type TAskFunction, type MenuItemProps } from '~/common';
import { useChatFormContext } from '~/Providers';
import store from '~/store';

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

const isExternalSTT = (speechToTextEndpoint: string) => speechToTextEndpoint === 'external';
export default memo(function AudioRecorder({
  disabled,
  ask,
  methods,
  isSubmitting,
}: {
  disabled: boolean;
  ask: TAskFunction;
  methods: ReturnType<typeof useChatFormContext>;
  isSubmitting: boolean;
}) {
  const { setValue, reset, getValues } = methods;
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { speechToTextEndpoint } = useGetAudioSettings();
  const speechSettingsInitialized = useRecoilValue(store.speechSettingsInitialized);
  const recorderDisabled = disabled || !speechSettingsInitialized;

  const existingTextRef = useRef<string>('');
  const browserAudioRef = useRef(false);
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;

  const onTranscriptionComplete = useCallback(
    (text: string) => {
      if (isSubmittingRef.current) {
        showToast({
          message: localize('com_ui_speech_while_submitting'),
          status: 'error',
        });
        return;
      }
      if (text) {
        const globalAudio = document.getElementById(globalAudioId) as HTMLAudioElement | null;
        if (globalAudio) {
          console.log('Unmuting global audio');
          globalAudio.muted = false;
        }
        /** For external STT, append existing text to the transcription */
        const finalText =
          (isExternalSTT(speechToTextEndpoint) || browserAudioRef.current) &&
          existingTextRef.current
            ? `${existingTextRef.current} ${text}`
            : text;
        const submitted = ask({ text: finalText });
        if (submitted === false) {
          return;
        }
        reset({ text: '' });
        existingTextRef.current = '';
        browserAudioRef.current = false;
      }
    },
    [ask, reset, showToast, localize, speechToTextEndpoint],
  );

  const setText = useCallback(
    (text: string) => {
      let newText = text;
      if (isExternalSTT(speechToTextEndpoint)) {
        /** For external STT, the text comes as a complete transcription, so append to existing */
        newText = existingTextRef.current ? `${existingTextRef.current} ${text}` : text;
      } else {
        /** For browser STT, the transcript is cumulative, so we only need to prepend the existing text once */
        newText = existingTextRef.current ? `${existingTextRef.current} ${text}` : text;
      }
      setValue('text', newText, {
        shouldValidate: true,
      });
    },
    [setValue, speechToTextEndpoint],
  );

  const {
    isListening,
    isLoading,
    isBrowserAudioLoading,
    isBrowserAudioListening,
    startRecording,
    stopRecording,
    startBrowserAudioRecording,
    stopBrowserAudioRecording,
    browserCaptureDevices,
    selectedBrowserCaptureDeviceId,
    loadBrowserCaptureDevices,
    selectBrowserCaptureDevice,
  } = useSpeechToText(setText, onTranscriptionComplete);
  const microphoneDisabled = recorderDisabled || isBrowserAudioListening || isBrowserAudioLoading;
  const browserAudioDisabled =
    recorderDisabled ||
    (!isBrowserAudioListening && (isBrowserAudioLoading || isListening || isLoading));
  const browserAudioMenuDisabled = recorderDisabled || isListening || isLoading;

  const handleStartRecording = useCallback(() => {
    if (isBrowserAudioListening || isBrowserAudioLoading) {
      return;
    }
    browserAudioRef.current = false;
    existingTextRef.current = getValues('text') || '';
    startRecording();
  }, [getValues, isBrowserAudioListening, isBrowserAudioLoading, startRecording]);

  const handleStopRecording = useCallback(() => {
    stopRecording();
    /** For browser STT, clear the reference since text was already being updated */
    if (!isExternalSTT(speechToTextEndpoint)) {
      existingTextRef.current = '';
    }
  }, [speechToTextEndpoint, stopRecording]);

  const handleStartBrowserAudio = useCallback(() => {
    if (isListening || isLoading) {
      return;
    }
    browserAudioRef.current = true;
    existingTextRef.current = getValues('text') || '';
    void startBrowserAudioRecording();
  }, [getValues, isListening, isLoading, startBrowserAudioRecording]);

  const handleStopBrowserAudio = useCallback(() => {
    stopBrowserAudioRecording();
  }, [stopBrowserAudioRecording]);

  const browserAudioMenuId = useId();
  const [browserAudioMenuOpen, setBrowserAudioMenuOpen] = useState(false);

  const handleOpenBrowserAudioMenu = useCallback(() => {
    void loadBrowserCaptureDevices();
  }, [loadBrowserCaptureDevices]);

  const handleBrowserAudioMenuOpenChange = useCallback(
    (open: boolean) => {
      setBrowserAudioMenuOpen(open);
      if (open) {
        handleOpenBrowserAudioMenu();
      }
    },
    [handleOpenBrowserAudioMenu],
  );

  const handleSelectBrowserAudioDevice = useCallback(
    (deviceId: string) => {
      void selectBrowserCaptureDevice(deviceId);
    },
    [selectBrowserCaptureDevice],
  );

  const browserAudioDeviceItems = useMemo<MenuItemProps[]>(() => {
    if (browserCaptureDevices.length === 0) {
      return [
        {
          id: 'no-browser-audio-devices',
          label: localize('com_ui_browser_audio_no_devices'),
          disabled: true,
          hideOnClick: false,
        },
      ];
    }
    return browserCaptureDevices.map((device) => {
      const selected = selectedBrowserCaptureDeviceId === device.deviceId;
      return {
        id: device.deviceId,
        label: device.label,
        ariaChecked: selected,
        icon: selected ? <Check className="size-4" aria-hidden="true" /> : undefined,
        onClick: () => handleSelectBrowserAudioDevice(device.deviceId),
      };
    });
  }, [browserCaptureDevices, selectedBrowserCaptureDeviceId, localize, handleSelectBrowserAudioDevice]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || !event.altKey || event.code !== 'KeyL' || microphoneDisabled) {
        return;
      }

      event.preventDefault();
      if (isListening === true) {
        handleStopRecording();
        return;
      }

      handleStartRecording();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStartRecording, handleStopRecording, isListening, microphoneDisabled]);

  const renderIcon = () => {
    if (isListening === true) {
      return <MicOff className="stroke-status-error" />;
    }
    if (isLoading === true) {
      return <Spinner className="stroke-text-secondary" />;
    }
    return <ListeningIcon className="stroke-text-secondary" />;
  };

  const renderBrowserAudioIcon = () => {
    if (isBrowserAudioLoading) {
      return <Spinner className="stroke-text-secondary" />;
    }
    if (isBrowserAudioListening) {
      return <AudioLinesOff />;
    }
    return <AudioLines className="stroke-text-secondary" />;
  };

  const browserAudioLabel = localize(
    isBrowserAudioListening ? 'com_ui_browser_audio_stop' : 'com_ui_browser_audio_start',
  );

  return (
    <>
      <div className="flex items-center">
        <TooltipAnchor
          description={browserAudioLabel}
          render={
            <IconButton
              id="browser-audio-recorder"
              type="button"
              variant={isBrowserAudioListening ? 'destructive' : 'ghost'}
              size="theme"
              shape="theme"
              label={browserAudioLabel}
              onClick={isBrowserAudioListening ? handleStopBrowserAudio : handleStartBrowserAudio}
              disabled={browserAudioDisabled}
              className={isBrowserAudioListening ? 'p-1' : 'p-1 hover:bg-surface-composer-hover'}
              aria-pressed={isBrowserAudioListening}
            >
              {renderBrowserAudioIcon()}
            </IconButton>
          }
        />
        <DropdownPopup
          portal
          unmountOnHide
          menuId={browserAudioMenuId}
          isOpen={browserAudioMenuOpen}
          setIsOpen={handleBrowserAudioMenuOpenChange}
          trigger={
            <Ariakit.MenuButton
              id="browser-audio-devices"
              type="button"
              disabled={browserAudioMenuDisabled}
              aria-label={localize('com_ui_browser_audio_devices')}
              title={localize('com_ui_browser_audio_devices')}
              className="flex items-center justify-center rounded-theme-control text-text-secondary transition-colors hover:bg-surface-composer-hover disabled:pointer-events-none disabled:opacity-50"
              style={{
                height: 'calc(var(--theme-control-height, 2.25rem) * 2 / 3)',
                width: '0.85rem',
              }}
            >
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </Ariakit.MenuButton>
          }
          items={browserAudioDeviceItems}
        />
      </div>
      <TooltipAnchor
        description={localize('com_ui_use_micrphone')}
        render={
          <IconButton
            id="audio-recorder"
            type="button"
            variant="ghost"
            size="theme"
            shape="theme"
            label={localize('com_ui_use_micrphone')}
            onClick={isListening === true ? handleStopRecording : handleStartRecording}
            disabled={microphoneDisabled}
            className="p-1 hover:bg-surface-composer-hover"
            aria-pressed={isListening}
          >
            {renderIcon()}
          </IconButton>
        }
      />
    </>
  );
});
