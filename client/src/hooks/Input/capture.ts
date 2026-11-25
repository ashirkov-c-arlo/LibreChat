/** Virtual `librechat_*` inputs (PipeWire/Pulse sinks) that carry browser or app audio, not a voice. */
export const BROWSER_CAPTURE_PREFIX = 'librechat_';
export const BROWSER_CAPTURE_DEVICE_KEY = 'librechatBrowserCaptureDeviceId';

export type CaptureSource = 'browser' | 'externalApp';
export const CAPTURE_SHORTCUT_EVENT = 'librechat:capture-shortcut';
export const LOCAL_AUDIO_EVENT = 'librechat:transcribe-local-audio';
export const captureSourceLabels = {
  browser: 'com_ui_audio_browser_capture',
  externalApp: 'com_ui_audio_external_app_capture',
} as const satisfies Record<CaptureSource, string>;

export type BrowserCaptureDevice = { deviceId: string; label: string };
type AudioInputDevice = Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>;

const normalizeDeviceLabel = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_');

export const matchesBrowserCaptureDevice = (label: string) =>
  normalizeDeviceLabel(label).startsWith(BROWSER_CAPTURE_PREFIX);

export function getCaptureSource(label: string): CaptureSource | undefined {
  const normalized = normalizeDeviceLabel(label);
  if (/^librechat_browser(?:_|$)/.test(normalized)) {
    return 'browser';
  }
  if (/^librechat_(?:external_app|zoom)(?:_|$)/.test(normalized)) {
    return 'externalApp';
  }
}

const isLibreChatCaptureDevice = (label: string) =>
  normalizeDeviceLabel(label).includes(BROWSER_CAPTURE_PREFIX);

export const findPhysicalMicrophone = (devices: AudioInputDevice[]) =>
  devices.find(
    (device) =>
      device.kind === 'audioinput' &&
      device.label !== '' &&
      !isLibreChatCaptureDevice(device.label),
  );

const requestMicrophoneStream = (deviceId?: string) =>
  navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    video: false,
  });

/**
 * Opens the user's real microphone, never a `librechat_` capture source: the system default
 * input may be one of those virtual devices, which would dictate the browser's audio instead.
 * Without device enumeration it falls back to the default input.
 */
export async function getMicrophoneStream(): Promise<MediaStream> {
  const mediaDevices = navigator.mediaDevices;
  if (typeof mediaDevices.enumerateDevices !== 'function') {
    return requestMicrophoneStream();
  }
  let microphone = findPhysicalMicrophone(await mediaDevices.enumerateDevices());
  if (microphone) {
    return requestMicrophoneStream(microphone.deviceId);
  }

  const stream = await requestMicrophoneStream();
  const track = stream.getAudioTracks()[0];
  if (!track?.label || !isLibreChatCaptureDevice(track.label)) {
    return stream;
  }

  stream.getTracks().forEach((item) => item.stop());
  microphone = findPhysicalMicrophone(await mediaDevices.enumerateDevices());
  if (!microphone) {
    throw new DOMException('Physical microphone not found', 'NotFoundError');
  }
  return requestMicrophoneStream(microphone.deviceId);
}
