import React from 'react';
import { RecoilRoot } from 'recoil';
import { act, renderHook } from '@testing-library/react';
import { findPhysicalMicrophone, BROWSER_CAPTURE_DEVICE_KEY } from '../capture';
import { captureComposerDraft } from '~/utils/drafts';
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

const setup = (autoSendText = -1) =>
  renderHook(
    () =>
      useBrowserAudio({
        ask: ask as never,
        methods: methods as never,
        isSubmitting: false,
        autoSendText,
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

  it.each([
    ['browser', 'LibreChat_Browser_Capture'],
    ['externalApp', 'LibreChat_External_App_Capture'],
    ['externalApp', 'LibreChat Zoom Capture'],
  ] as const)('records the %s source with the label %s', async (source, label) => {
    mockEnumerate.mockResolvedValue([
      { kind: 'audioinput', deviceId: 'previous', label: 'librechat_other' },
      { kind: 'audioinput', deviceId: 'target', label },
    ]);
    const capture = track(label, 'target');
    mockGetUserMedia.mockResolvedValue({
      getTracks: () => [capture],
      getAudioTracks: () => [capture],
    });
    localStorage.setItem(BROWSER_CAPTURE_DEVICE_KEY, 'previous');
    const { result } = setup();

    await act(async () => result.current.start(source));

    expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    expect(mockGetUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: 'target' } }),
      video: false,
    });
    expect(result.current.listening).toBe(true);
    expect(result.current.selectedDeviceId).toBe('target');
  });

  it('does not record a different source when the requested source is missing', async () => {
    localStorage.setItem(BROWSER_CAPTURE_DEVICE_KEY, 'cap-1');
    const { result } = setup();

    await act(async () => result.current.start('externalApp'));

    expect(mockGetUserMedia).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    expect(localStorage.getItem(BROWSER_CAPTURE_DEVICE_KEY)).toBe('cap-1');
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_audio_capture_source_unavailable',
      status: 'error',
    });
  });

  it('releases a different capture source selected in the permission prompt', async () => {
    mockEnumerate.mockResolvedValue([{ kind: 'audioinput', deviceId: '', label: '' }]);
    const browser = track('LibreChat_Browser_Capture', 'browser');
    mockGetUserMedia.mockResolvedValue({
      getTracks: () => [browser],
      getAudioTracks: () => [browser],
    });
    const { result } = setup();

    await act(async () => result.current.start('externalApp'));

    expect(browser.stop).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(result.current.busy).toBe(false);
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

  it('transcribes local WAV without opening devices or sending the message', () => {
    const { result } = setup(0);
    const audio = new File([new Uint8Array(100)], 'recording.wav', { type: 'audio/wav' });
    const owner = captureComposerDraft(0, 'new');
    act(() => expect(result.current.transcribeLocal(audio, owner)).toBe(true));
    expect(result.current.loading).toBe(true);
    expect(mockEnumerate).not.toHaveBeenCalled();
    expect(mockGetUserMedia).not.toHaveBeenCalled();
    expect(result.current.transcribeLocal(audio, owner)).toBe(false);
    expect(mockProcessAudio).toHaveBeenCalledTimes(1);
    expect(mockProcessAudio.mock.calls[0][0].get('audio')).toBe(audio);
    methods.getValues.mockReturnValueOnce('draft edited while transcribing');
    act(() => mockProcessAudio.mock.calls[0][1].onSuccess?.({ text: 'heard' }));
    expect(methods.setValue).toHaveBeenCalledWith('text', 'draft edited while transcribing heard', {
      shouldValidate: true,
    });
    expect(result.current.loading).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('does not write a local transcript after its draft lost ownership', () => {
    const { result } = setup();
    const owner = captureComposerDraft(0, 'new');
    const audio = new File([new Uint8Array(100)], 'recording.wav', { type: 'audio/wav' });
    act(() => expect(result.current.transcribeLocal(audio, owner)).toBe(true));
    window.history.replaceState(null, '', '/c/another-chat');
    try {
      act(() => mockProcessAudio.mock.calls[0][1].onSuccess?.({ text: 'heard' }));
      expect(methods.setValue).not.toHaveBeenCalled();
      expect(result.current.busy).toBe(false);
    } finally {
      window.history.replaceState(null, '', '/');
    }
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
      { kind: 'audioinput', deviceId: 'app', label: 'LibreChat External App Capture' },
      { kind: 'audioinput', deviceId: 'microphone', label: 'Built-in Audio Analog Stereo' },
    ]);
    expect(microphone?.deviceId).toBe('microphone');
  });
});
