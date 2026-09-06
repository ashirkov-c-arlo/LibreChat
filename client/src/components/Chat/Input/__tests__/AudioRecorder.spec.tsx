import React from 'react';
import { RecoilRoot } from 'recoil';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AudioRecorder from '../AudioRecorder';
import store from '~/store';

let mockSpeechToTextEndpoint = 'browser';
let mockBrowserIsListening = false;
let mockExternalIsListening = false;
let mockBrowserAudioIsListening = false;
let mockBrowserAudioIsLoading = false;
let mockSetText: ((text: string) => void) | undefined;
let mockOnTranscriptionComplete: ((text: string) => void) | undefined;

const mockStartSpeechRecordingBrowser = jest.fn();
const mockStopSpeechRecordingBrowser = jest.fn();
const mockStartSpeechRecordingExternal = jest.fn();
const mockStopSpeechRecordingExternal = jest.fn();
const mockStartBrowserAudioRecording = jest.fn();
const mockStopBrowserAudioRecording = jest.fn();
const mockSetValue = jest.fn();
const mockReset = jest.fn();
const mockGetValues = jest.fn(() => 'existing draft');
const mockAsk = jest.fn(() => true);

type MockButtonProps = React.ComponentProps<'button'> & {
  label?: string;
  variant?: string;
  size?: string;
  shape?: string;
};

jest.mock('@librechat/client', () => ({
  IconButton: ({
    children,
    label,
    variant: _variant,
    size: _size,
    shape: _shape,
    ...props
  }: MockButtonProps) => (
    <button aria-label={label} {...props}>
      {children}
    </button>
  ),
  TooltipAnchor: ({ render }: { render: React.ReactElement }) => render,
  ListeningIcon: () => <span />,
  Spinner: () => <span />,
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('~/hooks/Input/useSpeechToTextBrowser', () => ({
  __esModule: true,
  default: (setText: (text: string) => void) => {
    mockSetText = setText;
    return {
      isListening: mockBrowserIsListening,
      isLoading: false,
      startRecording: mockStartSpeechRecordingBrowser,
      stopRecording: mockStopSpeechRecordingBrowser,
    };
  },
}));

jest.mock('~/hooks/Input/useSpeechToTextExternal', () => ({
  __esModule: true,
  default: (setText: (text: string) => void, onTranscriptionComplete: (text: string) => void) => {
    mockSetText = setText;
    mockOnTranscriptionComplete = onTranscriptionComplete;
    return {
      isListening: mockExternalIsListening,
      isLoading: false,
      externalStartRecording: mockStartSpeechRecordingExternal,
      externalStopRecording: mockStopSpeechRecordingExternal,
      isBrowserAudioListening: mockBrowserAudioIsListening,
      isBrowserAudioLoading: mockBrowserAudioIsLoading,
      startBrowserAudioRecording: mockStartBrowserAudioRecording,
      stopBrowserAudioRecording: mockStopBrowserAudioRecording,
    };
  },
}));

jest.mock('~/hooks/Input/useGetAudioSettings', () => ({
  __esModule: true,
  default: () => ({ speechToTextEndpoint: mockSpeechToTextEndpoint }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useGetAudioSettings: () => ({ speechToTextEndpoint: mockSpeechToTextEndpoint }),
  useSpeechToText: jest.requireActual('~/hooks/Input/useSpeechToText').default,
}));

jest.mock('~/common', () => ({
  ...jest.requireActual('~/common'),
  globalAudioId: 'global-audio',
}));

const dispatchSpeechShortcut = () => {
  const event = new KeyboardEvent('keydown', {
    shiftKey: true,
    altKey: true,
    code: 'KeyL',
    bubbles: true,
    cancelable: true,
  });

  act(() => window.dispatchEvent(event));
  return event;
};

const renderRecorder = ({ disabled = false, initialized = true } = {}) =>
  render(
    <RecoilRoot initializeState={({ set }) => set(store.speechSettingsInitialized, initialized)}>
      <AudioRecorder
        disabled={disabled}
        ask={mockAsk as never}
        methods={
          {
            setValue: mockSetValue,
            reset: mockReset,
            getValues: mockGetValues,
          } as never
        }
        isSubmitting={false}
      />
    </RecoilRoot>,
  );

describe('AudioRecorder speech shortcut', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpeechToTextEndpoint = 'browser';
    mockBrowserIsListening = false;
    mockExternalIsListening = false;
    mockBrowserAudioIsListening = false;
    mockBrowserAudioIsLoading = false;
    mockSetText = undefined;
    mockOnTranscriptionComplete = undefined;
  });

  it('renders the Firefox audio control immediately before the microphone control', () => {
    renderRecorder();

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'com_ui_browser_audio_start',
      'com_ui_use_micrphone',
    ]);
    expect(buttons[0].querySelector('.lucide-audio-lines')).toBeInTheDocument();

    fireEvent.click(buttons[0]);
    expect(mockStartBrowserAudioRecording).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing draft when Firefox audio is transcribed', () => {
    renderRecorder();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_browser_audio_start' }));
    act(() => mockOnTranscriptionComplete?.('transcript'));

    expect(mockAsk).toHaveBeenCalledWith({ text: 'existing draft transcript' });
  });

  it('stops Firefox audio and blocks the microphone while it is recording', () => {
    mockBrowserAudioIsListening = true;
    renderRecorder();

    const browserAudioButton = screen.getByRole('button', {
      name: 'com_ui_browser_audio_stop',
    });
    expect(screen.getByRole('button', { name: 'com_ui_use_micrphone' })).toBeDisabled();
    expect(browserAudioButton).not.toBeDisabled();
    expect(browserAudioButton.querySelector('.lucide-audio-lines-off')).toBeInTheDocument();

    fireEvent.click(browserAudioButton);
    expect(mockStopBrowserAudioRecording).toHaveBeenCalledTimes(1);
  });

  it('blocks Firefox audio while the microphone is recording', () => {
    mockBrowserIsListening = true;
    renderRecorder();

    expect(screen.getByRole('button', { name: 'com_ui_browser_audio_start' })).toBeDisabled();
  });

  it('preserves the existing draft when browser recording starts from the shortcut', () => {
    renderRecorder();

    const event = dispatchSpeechShortcut();
    act(() => mockSetText?.('transcript'));

    expect(mockStartSpeechRecordingBrowser).toHaveBeenCalledTimes(1);
    expect(mockSetValue).toHaveBeenCalledWith('text', 'existing draft transcript', {
      shouldValidate: true,
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not invoke either recorder while the control is disabled', () => {
    renderRecorder({ disabled: true });

    dispatchSpeechShortcut();

    expect(mockStartSpeechRecordingBrowser).not.toHaveBeenCalled();
    expect(mockStopSpeechRecordingBrowser).not.toHaveBeenCalled();
  });

  it('does not start browser recording before speech settings initialization completes', () => {
    renderRecorder({ initialized: false });

    dispatchSpeechShortcut();

    expect(mockStartSpeechRecordingBrowser).not.toHaveBeenCalled();
    expect(mockStartSpeechRecordingExternal).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'com_ui_use_micrphone' })).toBeDisabled();
  });

  it('stops the selected engine from the shortcut', () => {
    mockSpeechToTextEndpoint = 'external';
    mockExternalIsListening = true;
    renderRecorder();

    dispatchSpeechShortcut();

    expect(mockStopSpeechRecordingExternal).toHaveBeenCalledTimes(1);
    expect(mockStopSpeechRecordingBrowser).not.toHaveBeenCalled();
  });

  it('does not stop a recorder while the control is disabled', () => {
    mockSpeechToTextEndpoint = 'external';
    mockExternalIsListening = true;
    renderRecorder({ disabled: true });

    dispatchSpeechShortcut();

    expect(mockStopSpeechRecordingExternal).not.toHaveBeenCalled();
  });
});
