import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import type { BrowserCaptureDevice } from './capture';
import type { useChatFormContext } from '~/Providers';
import type { TAskFunction } from '~/common';
import { BROWSER_CAPTURE_DEVICE_KEY, matchesBrowserCaptureDevice } from './capture';
import { getBestSupportedMimeType } from './useSpeechToTextExternal';
import { useSpeechToTextMutation } from '~/data-provider';
import useLocalize from '../useLocalize';
import { globalAudioId } from '~/common';
import store from '~/store';

type Status = 'idle' | 'requesting' | 'recording' | 'finalizing' | 'transcribing';

export interface BrowserAudio {
  /** A capture is being opened, recorded or transcribed; the microphone stays off meanwhile. */
  busy: boolean;
  listening: boolean;
  loading: boolean;
  devices: BrowserCaptureDevice[];
  selectedDeviceId: string | null;
  start: () => void;
  stop: () => void;
  loadDevices: () => Promise<void>;
  selectDevice: (deviceId: string) => Promise<void>;
}

const getFileExtension = (mimeType: string) => {
  if (mimeType.includes('mp4')) {
    return 'm4a';
  }
  if (mimeType.includes('ogg')) {
    return 'ogg';
  }
  if (mimeType.includes('wav')) {
    return 'wav';
  }
  return 'webm';
};

const isMissingDeviceError = (error: Error) =>
  error.name === 'NotFoundError' || error.name === 'OverconstrainedError';

/** Raw capture: speech processing would treat the browser's audio as noise and flatten it. */
const requestCaptureStream = (deviceId?: string) =>
  navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });

const readStoredDeviceId = () =>
  typeof localStorage === 'undefined' ? null : localStorage.getItem(BROWSER_CAPTURE_DEVICE_KEY);

/**
 * Records a `librechat_` virtual input (browser or app audio routed through PipeWire/Pulse)
 * and transcribes it with the external STT endpoint into the composer, beside the draft that
 * was there. Independent of dictation: the composer gates the two against each other.
 */
export default function useBrowserAudio({
  ask,
  methods,
  isSubmitting,
  autoSendText,
  speechToText,
}: {
  ask: TAskFunction;
  methods: ReturnType<typeof useChatFormContext>;
  isSubmitting: boolean;
  autoSendText: number;
  speechToText: boolean;
}): BrowserAudio {
  const { setValue, reset, getValues } = methods;
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const languageSTT = useRecoilValue(store.languageSTT);
  const { mutate: processAudio } = useSpeechToTextMutation();

  const [status, setStatus] = useState<Status>('idle');
  const [devices, setDevices] = useState<BrowserCaptureDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(readStoredDeviceId);

  const statusRef = useRef<Status>('idle');
  const mountedRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const existingTextRef = useRef('');
  const pendingSwitchRef = useRef(false);
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;

  const updateStatus = useCallback((next: Status) => {
    statusRef.current = next;
    if (mountedRef.current) {
      setStatus(next);
    }
  }, []);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  };

  const handleCaptureError = useCallback(
    (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      if (isMissingDeviceError(err)) {
        localStorage.removeItem(BROWSER_CAPTURE_DEVICE_KEY);
        showToast({ message: localize('com_ui_browser_audio_unavailable'), status: 'error' });
        return;
      }
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        showToast({ message: localize('com_ui_browser_audio_permission_denied'), status: 'error' });
        return;
      }
      showToast({ message: localize('com_ui_browser_audio_error'), status: 'error' });
    },
    [localize, showToast],
  );

  const saveDevice = (stream: MediaStream) => {
    const deviceId = stream.getAudioTracks()[0]?.getSettings().deviceId;
    if (deviceId) {
      localStorage.setItem(BROWSER_CAPTURE_DEVICE_KEY, deviceId);
    }
    return stream;
  };

  const getCaptureStream = async () => {
    const savedDeviceId = readStoredDeviceId();
    if (savedDeviceId) {
      try {
        return saveDevice(await requestCaptureStream(savedDeviceId));
      } catch (error) {
        if (!(error instanceof Error) || !isMissingDeviceError(error)) {
          throw error;
        }
        localStorage.removeItem(BROWSER_CAPTURE_DEVICE_KEY);
      }
    }

    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audioinput',
    );
    const captureDevice = inputs.find((device) => matchesBrowserCaptureDevice(device.label));
    if (captureDevice) {
      return saveDevice(await requestCaptureStream(captureDevice.deviceId));
    }
    if (inputs.some((device) => device.label !== '')) {
      throw new DOMException('Browser capture device not found', 'NotFoundError');
    }

    /* Labels stay hidden until access is granted, so let the user pick the device in the prompt. */
    showToast({ message: localize('com_ui_browser_audio_select_device'), status: 'info' });
    const stream = await requestCaptureStream();
    const track = stream.getAudioTracks()[0];
    if (track?.label && !matchesBrowserCaptureDevice(track.label)) {
      stream.getTracks().forEach((item) => item.stop());
      throw new DOMException('Browser capture device not selected', 'NotFoundError');
    }
    return saveDevice(stream);
  };

  const submitTranscript = (text: string) => {
    if (isSubmittingRef.current) {
      showToast({ message: localize('com_ui_speech_while_submitting'), status: 'error' });
      return;
    }
    const globalAudio = document.getElementById(globalAudioId) as HTMLAudioElement | null;
    if (globalAudio) {
      globalAudio.muted = false;
    }
    if (ask({ text }) === false) {
      return;
    }
    reset({ text: '' });
  };

  const transcribe = (chunks: Blob[], mimeType: string) => {
    const audio = new File(
      [new Blob(chunks, { type: mimeType })],
      `audio.${getFileExtension(mimeType)}`,
      {
        type: mimeType,
      },
    );
    const formData = new FormData();
    formData.append('audio', audio);
    if (languageSTT) {
      formData.append('language', languageSTT);
    }
    updateStatus('transcribing');
    processAudio(formData, {
      onSuccess: ({ text }) => {
        if (!mountedRef.current) {
          return;
        }
        updateStatus('idle');
        const existing = existingTextRef.current;
        const finalText = existing && text ? `${existing} ${text}` : text || existing;
        setValue('text', finalText, { shouldValidate: true });
        if (autoSendText > -1 && speechToText && text.length > 0) {
          autoSendTimerRef.current = setTimeout(() => {
            autoSendTimerRef.current = null;
            submitTranscript(finalText);
          }, autoSendText * 1000);
        }
      },
      onError: () => {
        if (!mountedRef.current) {
          return;
        }
        showToast({
          message: 'An error occurred while processing the audio, maybe the audio was too short',
          status: 'error',
        });
        updateStatus('idle');
      },
    });
  };

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder == null || recorder.state !== 'recording') {
      return;
    }
    updateStatus('finalizing');
    recorder.stop();
  }, [updateStatus]);

  const start = async () => {
    if (statusRef.current !== 'idle') {
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      showToast({ message: 'MediaRecorder is not supported in this browser', status: 'error' });
      return;
    }
    existingTextRef.current = getValues('text') || '';
    updateStatus('requesting');
    try {
      const stream = await getCaptureStream();
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      const preferredMimeType = getBestSupportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType: preferredMimeType });
      const mimeType = recorder.mimeType || preferredMimeType;
      recorderRef.current = recorder;
      recorder.addEventListener('dataavailable', (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener(
        'stop',
        () => {
          const chunks = chunksRef.current;
          chunksRef.current = [];
          releaseStream();
          if (!mountedRef.current) {
            return;
          }
          if (pendingSwitchRef.current) {
            /* A device switch mid-capture drops this take and restarts on the new device. */
            pendingSwitchRef.current = false;
            updateStatus('idle');
            void start();
            return;
          }
          if (chunks.length === 0) {
            showToast({ message: localize('com_ui_browser_audio_too_short'), status: 'warning' });
            updateStatus('idle');
            return;
          }
          transcribe(chunks, mimeType);
        },
        { once: true },
      );
      stream.getAudioTracks()[0]?.addEventListener(
        'ended',
        () => {
          if (statusRef.current !== 'recording') {
            return;
          }
          showToast({ message: localize('com_ui_browser_audio_unavailable'), status: 'error' });
          stop();
        },
        { once: true },
      );
      recorder.start(100);
      updateStatus('recording');
    } catch (error) {
      releaseStream();
      updateStatus('idle');
      handleCaptureError(error);
    }
  };

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const capture = all
        .filter(
          (device) => device.kind === 'audioinput' && matchesBrowserCaptureDevice(device.label),
        )
        .map(({ deviceId, label }) => ({ deviceId, label }));
      if (mountedRef.current) {
        setDevices(capture);
      }
    } catch {
      /* enumeration failures are non-fatal for the selector */
    }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!all.some((device) => device.kind === 'audioinput' && device.label !== '')) {
        /* Labels unlock only after one granted capture; probe once, then re-enumerate. */
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        probe.getTracks().forEach((track) => track.stop());
      }
      await refreshDevices();
    } catch (error) {
      handleCaptureError(error);
    }
  }, [handleCaptureError, refreshDevices]);

  const selectDevice = useCallback(
    async (deviceId: string) => {
      localStorage.setItem(BROWSER_CAPTURE_DEVICE_KEY, deviceId);
      setSelectedDeviceId(deviceId);
      if (statusRef.current === 'recording') {
        pendingSwitchRef.current = true;
        stop();
        return;
      }
      /* Arm only: acquiring it now lets Firefox prompt for this device, then release it at once. */
      try {
        const stream = await requestCaptureStream(deviceId);
        stream.getTracks().forEach((track) => track.stop());
        await refreshDevices();
      } catch (error) {
        handleCaptureError(error);
      }
    },
    [handleCaptureError, refreshDevices, stop],
  );

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) {
      return;
    }
    const onChange = () => void refreshDevices();
    mediaDevices.addEventListener('devicechange', onChange);
    return () => mediaDevices.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (autoSendTimerRef.current != null) {
        clearTimeout(autoSendTimerRef.current);
      }
      const recorder = recorderRef.current;
      if (recorder?.state === 'recording') {
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  /* `start` reads refs only, so a stable wrapper keeps `memo(Bar)` from re-rendering. */
  const startRef = useRef(start);
  startRef.current = start;
  const startStable = useCallback(() => void startRef.current(), []);

  return useMemo(
    () => ({
      busy: status !== 'idle',
      listening: status === 'recording',
      loading: status === 'requesting' || status === 'finalizing' || status === 'transcribing',
      devices,
      selectedDeviceId,
      start: startStable,
      stop,
      loadDevices,
      selectDevice,
    }),
    [status, devices, selectedDeviceId, startStable, stop, loadDevices, selectDevice],
  );
}
