import useSpeechToTextExternal from './useSpeechToTextExternal';
import useSpeechToTextBrowser from './useSpeechToTextBrowser';
import useGetAudioSettings from './useGetAudioSettings';

const useSpeechToText = (
  setText: (text: string) => void,
  onTranscriptionComplete: (text: string) => void,
): {
  isLoading?: boolean;
  isListening?: boolean;
  isBrowserAudioLoading: boolean;
  isBrowserAudioListening: boolean;
  stopRecording: () => void | boolean;
  startRecording: () => void | Promise<void>;
  stopBrowserAudioRecording: () => boolean;
  startBrowserAudioRecording: () => Promise<void>;
  browserCaptureDevices: { deviceId: string; label: string }[];
  selectedBrowserCaptureDeviceId: string | null;
  loadBrowserCaptureDevices: () => Promise<void>;
  selectBrowserCaptureDevice: (deviceId: string) => Promise<void>;
} => {
  const { speechToTextEndpoint } = useGetAudioSettings();
  const externalSpeechToText = speechToTextEndpoint === 'external';

  const {
    isListening: speechIsListeningBrowser,
    isLoading: speechIsLoadingBrowser,
    startRecording: startSpeechRecordingBrowser,
    stopRecording: stopSpeechRecordingBrowser,
  } = useSpeechToTextBrowser(setText, onTranscriptionComplete);

  const {
    isListening: speechIsListeningExternal,
    isLoading: speechIsLoadingExternal,
    externalStartRecording: startSpeechRecordingExternal,
    externalStopRecording: stopSpeechRecordingExternal,
    isBrowserAudioLoading,
    isBrowserAudioListening,
    stopBrowserAudioRecording,
    startBrowserAudioRecording,
    browserCaptureDevices,
    selectedBrowserCaptureDeviceId,
    loadBrowserCaptureDevices,
    selectBrowserCaptureDevice,
  } = useSpeechToTextExternal(setText, onTranscriptionComplete);

  const isListening = externalSpeechToText ? speechIsListeningExternal : speechIsListeningBrowser;
  const isLoading = externalSpeechToText ? speechIsLoadingExternal : speechIsLoadingBrowser;

  const startRecording = externalSpeechToText
    ? startSpeechRecordingExternal
    : startSpeechRecordingBrowser;
  const stopRecording = externalSpeechToText
    ? stopSpeechRecordingExternal
    : stopSpeechRecordingBrowser;

  return {
    isLoading,
    isListening,
    isBrowserAudioLoading,
    isBrowserAudioListening,
    stopRecording,
    startRecording,
    stopBrowserAudioRecording,
    startBrowserAudioRecording,
    browserCaptureDevices,
    selectedBrowserCaptureDeviceId,
    loadBrowserCaptureDevices,
    selectBrowserCaptureDevice,
  };
};

export default useSpeechToText;
