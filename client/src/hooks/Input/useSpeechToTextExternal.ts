import { useEffect, useRef, useState } from 'react';
import { useRecoilState } from 'recoil';
import { useToastContext } from '@librechat/client';
import { useSpeechToTextMutation } from '~/data-provider';
import useLocalize from '~/hooks/useLocalize';
import store from '~/store';

type RecordingSource = 'microphone' | 'browser';

type BrowserCaptureDevice = { deviceId: string; label: string };
type AudioInputDevice = Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>;

const BROWSER_CAPTURE_PREFIX = 'librechat_';
const BROWSER_CAPTURE_DEVICE_KEY = 'librechatBrowserCaptureDeviceId';

const getBestSupportedMimeType = () => {
  const types = [
    'audio/webm',
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/wav',
  ];

  for (const type of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent.toLowerCase();
  if (userAgent.includes('safari') && !userAgent.includes('chrome')) {
    return 'audio/mp4';
  }
  if (userAgent.includes('firefox')) {
    return 'audio/ogg';
  }
  return 'audio/webm';
};

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

const normalizeDeviceLabel = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_');

const matchesBrowserCaptureDevice = (label: string) =>
  normalizeDeviceLabel(label).startsWith(BROWSER_CAPTURE_PREFIX);

const isLibreChatCaptureDevice = (label: string) =>
  normalizeDeviceLabel(label).includes(BROWSER_CAPTURE_PREFIX);

export const findPhysicalMicrophone = (devices: AudioInputDevice[]) =>
  devices.find(
    (device) =>
      device.kind === 'audioinput' &&
      device.label !== '' &&
      !isLibreChatCaptureDevice(device.label),
  );

const isMissingDeviceError = (error: Error) =>
  error.name === 'NotFoundError' || error.name === 'OverconstrainedError';

const browserCaptureConstraints = (deviceId?: string): MediaTrackConstraints => ({
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
});

const useSpeechToTextExternal = (
  setText: (text: string) => void,
  onTranscriptionComplete: (text: string) => void,
) => {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const audioStreamRef = useRef<MediaStream | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingSourceRef = useRef<RecordingSource | null>(null);
  const busySourceRef = useRef<RecordingSource | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mountedRef = useRef(true);
  const discardRecordingRef = useRef(false);
  const pendingSwitchDeviceRef = useRef<string | null>(null);

  const [recordingSource, setRecordingSource] = useState<RecordingSource | null>(null);
  const [requestingSource, setRequestingSource] = useState<RecordingSource | null>(null);
  const [finalizingSource, setFinalizingSource] = useState<RecordingSource | null>(null);
  const [browserCaptureDevices, setBrowserCaptureDevices] = useState<BrowserCaptureDevice[]>([]);
  const [selectedBrowserCaptureDeviceId, setSelectedBrowserCaptureDeviceId] = useState<
    string | null
  >(() =>
    typeof localStorage === 'undefined' ? null : localStorage.getItem(BROWSER_CAPTURE_DEVICE_KEY),
  );

  const [minDecibels] = useRecoilState(store.decibelValue);
  const [autoSendText] = useRecoilState(store.autoSendText);
  const [languageSTT] = useRecoilState<string>(store.languageSTT);
  const [speechToText] = useRecoilState<boolean>(store.speechToText);
  const [autoTranscribeAudio] = useRecoilState<boolean>(store.autoTranscribeAudio);

  const resetBusyState = () => {
    busySourceRef.current = null;
    if (!mountedRef.current) {
      return;
    }
    setRequestingSource(null);
    setRecordingSource(null);
    setFinalizingSource(null);
  };

  const { mutate: processAudio } = useSpeechToTextMutation({
    onSuccess: (data) => {
      if (!mountedRef.current) {
        return;
      }
      const extractedText = data.text;
      setText(extractedText);
      resetBusyState();

      if (autoSendText > -1 && speechToText && extractedText.length > 0) {
        setTimeout(() => onTranscriptionComplete(extractedText), autoSendText * 1000);
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
      resetBusyState();
    },
  });

  const stopMonitoring = () => {
    if (animationFrameIdRef.current !== null) {
      window.cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const stopTracks = () => {
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
  };

  const cleanupMedia = () => {
    stopMonitoring();
    stopTracks();
    mediaRecorderRef.current = null;
    recordingSourceRef.current = null;
  };

  const requestAudioStream = (deviceId?: string) =>
    navigator.mediaDevices.getUserMedia({
      audio: browserCaptureConstraints(deviceId),
      video: false,
    });

  const requestMicrophoneStream = (deviceId?: string) =>
    navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    });

  const getMicrophoneStream = async () => {
    let microphone = findPhysicalMicrophone(await navigator.mediaDevices.enumerateDevices());
    if (microphone) {
      return requestMicrophoneStream(microphone.deviceId);
    }

    const stream = await requestMicrophoneStream();
    const track = stream.getAudioTracks()[0];
    if (!track?.label || !isLibreChatCaptureDevice(track.label)) {
      return stream;
    }

    stream.getTracks().forEach((item) => item.stop());
    microphone = findPhysicalMicrophone(await navigator.mediaDevices.enumerateDevices());
    if (!microphone) {
      throw new DOMException('Physical microphone not found', 'NotFoundError');
    }
    return requestMicrophoneStream(microphone.deviceId);
  };

  const saveBrowserCaptureDevice = (stream: MediaStream) => {
    const deviceId = stream.getAudioTracks()[0]?.getSettings().deviceId;
    if (deviceId) {
      localStorage.setItem(BROWSER_CAPTURE_DEVICE_KEY, deviceId);
    }
    return stream;
  };

  const getBrowserCaptureStream = async () => {
    const savedDeviceId = localStorage.getItem(BROWSER_CAPTURE_DEVICE_KEY);
    if (savedDeviceId) {
      try {
        return saveBrowserCaptureDevice(await requestAudioStream(savedDeviceId));
      } catch (error) {
        if (!(error instanceof Error) || !isMissingDeviceError(error)) {
          throw error;
        }
        localStorage.removeItem(BROWSER_CAPTURE_DEVICE_KEY);
      }
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === 'audioinput');
    const captureDevice = audioInputs.find((device) => matchesBrowserCaptureDevice(device.label));

    if (captureDevice) {
      return saveBrowserCaptureDevice(await requestAudioStream(captureDevice.deviceId));
    }
    if (audioInputs.some((device) => device.label !== '')) {
      throw new DOMException('Browser capture device not found', 'NotFoundError');
    }

    showToast({
      message: localize('com_ui_browser_audio_select_device'),
      status: 'info',
    });
    const stream = await requestAudioStream();
    const track = stream.getAudioTracks()[0];
    if (track?.label && !matchesBrowserCaptureDevice(track.label)) {
      stream.getTracks().forEach((item) => item.stop());
      throw new DOMException('Browser capture device not selected', 'NotFoundError');
    }
    return saveBrowserCaptureDevice(stream);
  };

  const getAudioStream = (source: RecordingSource) => {
    if (source === 'browser') {
      return getBrowserCaptureStream();
    }
    return getMicrophoneStream();
  };

  const handleCaptureError = (error: Error) => {
    if (isMissingDeviceError(error)) {
      localStorage.removeItem(BROWSER_CAPTURE_DEVICE_KEY);
      showToast({ message: localize('com_ui_browser_audio_unavailable'), status: 'error' });
      return;
    }
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      showToast({ message: localize('com_ui_browser_audio_permission_denied'), status: 'error' });
      return;
    }
    showToast({ message: localize('com_ui_browser_audio_error'), status: 'error' });
  };

  const finishRecording = (source: RecordingSource, mimeType: string) => {
    const audioChunks = audioChunksRef.current;
    audioChunksRef.current = [];
    cleanupMedia();

    if (source === 'browser' && pendingSwitchDeviceRef.current) {
      // A device switch was requested mid-capture: discard the in-flight audio
      // and restart the browser capture on the newly selected device.
      pendingSwitchDeviceRef.current = null;
      resetBusyState();
      void startRecording('browser');
      return;
    }

    if (discardRecordingRef.current) {
      return;
    }
    if (audioChunks.length === 0 || audioChunks.every((chunk) => chunk.size === 0)) {
      showToast({
        message:
          source === 'browser'
            ? localize('com_ui_browser_audio_too_short')
            : 'The audio was too short',
        status: 'warning',
      });
      resetBusyState();
      return;
    }

    const audioBlob = new Blob(audioChunks, { type: mimeType });
    const audioFile = new File([audioBlob], `audio.${getFileExtension(mimeType)}`, {
      type: mimeType,
    });
    const formData = new FormData();
    formData.append('audio', audioFile);
    if (languageSTT) {
      formData.append('language', languageSTT);
    }
    processAudio(formData);
  };

  const stopRecording = (source: RecordingSource) => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording' || recordingSourceRef.current !== source) {
      return false;
    }

    if (mountedRef.current) {
      setRecordingSource(null);
      setFinalizingSource(source);
    }
    recorder.stop();
    return true;
  };

  const monitorSilence = (stream: MediaStream) => {
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    const analyser = audioContext.createAnalyser();
    analyser.minDecibels = minDecibels;
    audioContext.createMediaStreamSource(stream).connect(analyser);

    const domainData = new Uint8Array(analyser.frequencyBinCount);
    let lastSoundTime = Date.now();
    const detectSound = () => {
      analyser.getByteFrequencyData(domainData);
      if (domainData.some((value) => value > 0)) {
        lastSoundTime = Date.now();
      }
      if (Date.now() - lastSoundTime > 3000) {
        stopRecording('microphone');
        return;
      }
      animationFrameIdRef.current = window.requestAnimationFrame(detectSound);
    };
    animationFrameIdRef.current = window.requestAnimationFrame(detectSound);
  };

  const startRecording = async (source: RecordingSource) => {
    if (busySourceRef.current) {
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      showToast({ message: 'MediaRecorder is not supported in this browser', status: 'error' });
      return;
    }

    busySourceRef.current = source;
    setRequestingSource(source);
    try {
      const stream = await getAudioStream(source);
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      audioStreamRef.current = stream;
      audioChunksRef.current = [];
      const preferredMimeType = getBestSupportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType: preferredMimeType });
      const mimeType = recorder.mimeType || preferredMimeType;
      mediaRecorderRef.current = recorder;
      recordingSourceRef.current = source;
      recorder.addEventListener('dataavailable', (event: BlobEvent) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener('stop', () => finishRecording(source, mimeType), { once: true });
      if (source === 'browser') {
        stream.getAudioTracks()[0]?.addEventListener(
          'ended',
          () => {
            if (recordingSourceRef.current !== 'browser' || discardRecordingRef.current) {
              return;
            }
            showToast({ message: localize('com_ui_browser_audio_unavailable'), status: 'error' });
            stopRecording('browser');
          },
          { once: true },
        );
      }
      recorder.start(100);
      setRequestingSource(null);
      setRecordingSource(source);

      if (source === 'microphone' && autoTranscribeAudio && speechToText) {
        monitorSilence(stream);
      }
    } catch (error) {
      cleanupMedia();
      resetBusyState();
      if (source === 'browser') {
        handleCaptureError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      showToast({ message: 'Microphone permission not granted', status: 'error' });
    }
  };

  const listBrowserCaptureDevices = async (): Promise<BrowserCaptureDevice[]> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'audioinput' && matchesBrowserCaptureDevice(device.label))
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  };

  const refreshBrowserCaptureDevices = async () => {
    try {
      const captureDevices = await listBrowserCaptureDevices();
      if (mountedRef.current) {
        setBrowserCaptureDevices(captureDevices);
      }
    } catch {
      /* enumeration failures are non-fatal for the selector */
    }
  };

  const loadBrowserCaptureDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasLabels = devices.some(
        (device) => device.kind === 'audioinput' && device.label !== '',
      );
      if (!hasLabels) {
        /**
         * Device labels stay hidden until microphone access is granted for this
         * page load, so we cannot filter by the librechat_ prefix yet. Probe for
         * permission once (this shows Firefox's native prompt), then release the
         * stream and re-enumerate now that labels are exposed.
         */
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        probe.getTracks().forEach((track) => track.stop());
      }
      await refreshBrowserCaptureDevices();
    } catch (error) {
      handleCaptureError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const selectBrowserCaptureDevice = async (deviceId: string) => {
    localStorage.setItem(BROWSER_CAPTURE_DEVICE_KEY, deviceId);
    if (mountedRef.current) {
      setSelectedBrowserCaptureDeviceId(deviceId);
    }

    if (recordingSourceRef.current === 'browser') {
      /**
       * Switch on the go: stop the in-flight capture and let finishRecording
       * restart the browser recording on the newly selected device.
       */
      pendingSwitchDeviceRef.current = deviceId;
      stopRecording('browser');
      return;
    }

    /**
     * Not recording (variant A): only arm the device. Acquiring the stream now
     * makes Firefox prompt for access when this device has not been granted
     * yet; we immediately release it so no hot mic stays open.
     */
    try {
      const stream = await requestAudioStream(deviceId);
      stream.getTracks().forEach((track) => track.stop());
      await refreshBrowserCaptureDevices();
    } catch (error) {
      handleCaptureError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) {
      return;
    }
    const handleDeviceChange = () => {
      void refreshBrowserCaptureDevices();
    };
    mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      mountedRef.current = false;
      discardRecordingRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === 'recording') {
        recorder.stop();
      }
      if (animationFrameIdRef.current !== null) {
        window.cancelAnimationFrame(animationFrameIdRef.current);
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
      mediaRecorderRef.current = null;
      recordingSourceRef.current = null;
    },
    [],
  );

  return {
    isListening: recordingSource === 'microphone',
    isLoading: requestingSource === 'microphone' || finalizingSource === 'microphone',
    externalStartRecording: () => startRecording('microphone'),
    externalStopRecording: () => stopRecording('microphone'),
    isBrowserAudioListening: recordingSource === 'browser',
    isBrowserAudioLoading: requestingSource === 'browser' || finalizingSource === 'browser',
    startBrowserAudioRecording: () => startRecording('browser'),
    stopBrowserAudioRecording: () => stopRecording('browser'),
    browserCaptureDevices,
    selectedBrowserCaptureDeviceId,
    loadBrowserCaptureDevices,
    selectBrowserCaptureDevice,
  };
};

export default useSpeechToTextExternal;
