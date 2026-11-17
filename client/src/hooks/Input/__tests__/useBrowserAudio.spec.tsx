import React from 'react';
import { RecoilRoot } from 'recoil';
import { act, renderHook } from '@testing-library/react';
import { findPhysicalMicrophone, BROWSER_CAPTURE_DEVICE_KEY } from '../capture';
import useBrowserAudio from '../useBrowserAudio';

type MutateOptions = { onSuccess?: (data: { text: string }) => void; onError?: () => void };
const mockProcessAudio = jest.fn<void, [FormData, MutateOptions]>();
const mockShowToast = jest.fn();

jest.mock('~/data-provider', () => ({
  useSpeechToTextMutation: () => ({ mutate: mockProcessAudio, isLoading: false }),
}));
jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));
jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/ogg';
  private handlers: Record<string, Array<(event?: unknown) => void>> = {};
  constructor() {
    FakeRecorder.instances.push(this);
  }

  addEventListener(type: string, handler: (event?: unknown) => void) {
    (this.handlers[type] ??= []).push(handler);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.handlers.dataavailable?.forEach((h) => h({ data: new Blob(['x']) }));
    this.handlers.stop?.forEach((h) => h());
  }
}

const track = (label: string, deviceId: string) => ({
  label,
  stop: jest.fn(),
  getSettings: () => ({ deviceId }),
  addEventListener: jest.fn(),
});

const mockGetUserMedia = jest.fn();
const mockEnumerate = jest.fn();
const methods = {
  setValue: jest.fn(),
  reset: jest.fn(),
  getValues: jest.fn(() => 'draft'),
};
const ask = jest.fn(() => true);

const setup = () =>
  renderHook(
    () =>
      useBrowserAudio({
        ask: ask as never,
        methods: methods as never,
        isSubmitting: false,
        autoSendText: -1,
        speechToText: true,
      }),
    { wrapper: ({ children }) => <RecoilRoot>{children}</RecoilRoot> },
  );

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  FakeRecorder.instances = [];
  global.MediaRecorder = FakeRecorder as unknown as typeof MediaRecorder;
  const capture = track('librechat_browser', 'cap-1');
  mockGetUserMedia.mockResolvedValue({
    getTracks: () => [capture],
    getAudioTracks: () => [capture],
  });
  mockEnumerate.mockResolvedValue([
    { kind: 'audioinput', deviceId: 'mic', label: 'Built-in Mic' },
    { kind: 'audioinput', deviceId: 'cap-1', label: 'librechat_browser' },
  ]);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: mockGetUserMedia, enumerateDevices: mockEnumerate },
  });
});

describe('useBrowserAudio', () => {
  it('records the librechat_ device raw and appends the transcript to the draft', async () => {
    const { result } = setup();

    await act(async () => result.current.start());
    expect(result.current.listening).toBe(true);
    expect(result.current.busy).toBe(true);
    expect(mockGetUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({
        deviceId: { exact: 'cap-1' },
        echoCancellation: false,
        noiseSuppression: false,
      }),
      video: false,
    });
    expect(localStorage.getItem(BROWSER_CAPTURE_DEVICE_KEY)).toBe('cap-1');

    act(() => result.current.stop());
    expect(mockProcessAudio).toHaveBeenCalledTimes(1);
    act(() => mockProcessAudio.mock.calls[0][1].onSuccess?.({ text: 'heard' }));

    expect(methods.setValue).toHaveBeenCalledWith('text', 'draft heard', { shouldValidate: true });
    expect(result.current.busy).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('refuses a non-librechat device picked in the permission prompt', async () => {
    mockEnumerate.mockResolvedValue([{ kind: 'audioinput', deviceId: '', label: '' }]);
    const mic = track('Built-in Mic', 'mic');
    mockGetUserMedia.mockResolvedValue({ getTracks: () => [mic], getAudioTracks: () => [mic] });
    const { result } = setup();

    await act(async () => result.current.start());

    expect(mic.stop).toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_browser_audio_unavailable',
      status: 'error',
    });
  });

  it('lists only librechat_ inputs', async () => {
    const { result } = setup();
    await act(async () => result.current.loadDevices());
    expect(result.current.devices).toEqual([{ deviceId: 'cap-1', label: 'librechat_browser' }]);
  });
});

describe('findPhysicalMicrophone', () => {
  it('skips LibreChat capture sources', () => {
    const microphone = findPhysicalMicrophone([
      { kind: 'audioinput', deviceId: 'browser', label: 'LibreChat Browser Capture' },
      { kind: 'audioinput', deviceId: 'zoom', label: 'LibreChat Zoom Capture' },
      { kind: 'audioinput', deviceId: 'microphone', label: 'Built-in Audio Analog Stereo' },
    ]);
    expect(microphone?.deviceId).toBe('microphone');
  });
});
