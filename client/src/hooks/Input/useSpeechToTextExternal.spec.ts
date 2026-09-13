import { findPhysicalMicrophone } from './useSpeechToTextExternal';

const audioInput = (
  deviceId: string,
  label: string,
): Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'> => ({
  deviceId,
  kind: 'audioinput',
  label,
});

describe('findPhysicalMicrophone', () => {
  it('skips LibreChat capture sources', () => {
    const microphone = findPhysicalMicrophone([
      audioInput('browser', 'LibreChat Browser Capture'),
      audioInput('zoom', 'LibreChat Zoom Capture'),
      audioInput('microphone', 'Built-in Audio Analog Stereo'),
    ]);

    expect(microphone?.deviceId).toBe('microphone');
  });
});
