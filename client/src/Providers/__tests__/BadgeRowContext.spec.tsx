import React from 'react';
import { render } from '@testing-library/react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { Constants, LocalStorageKeys, Tools } from 'librechat-data-provider';
import type { TEphemeralAgent } from 'librechat-data-provider';
import BadgeRowProvider from '../BadgeRowContext';
import { setTimestamp } from '~/utils/timestamps';
import { ephemeralAgentByConvoId } from '~/store';

const chatDefaults = { webSearch: true, executeCode: true, memory: true };

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: {} }),
  useGetEndpointsQuery: () => ({
    data: { LiteLLM: { chatDefaults }, Other: {} },
  }),
}));

jest.mock('~/hooks', () => ({
  useGetAgentsConfig: () => ({ agentsConfig: null }),
  useToolToggle: () => ({}),
  useSearchApiKeyForm: () => ({ setIsDialogOpen: jest.fn() }),
  useMCPServerManager: () => ({}),
}));

let agent: TEphemeralAgent | null = null;
function Probe() {
  agent = useRecoilValue(ephemeralAgentByConvoId(Constants.NEW_CONVO));
  return null;
}

const renderWith = (endpoint: string) =>
  render(
    <RecoilRoot>
      <BadgeRowProvider conversationId={null} endpoint={endpoint}>
        <Probe />
      </BadgeRowProvider>
    </RecoilRoot>,
  );

beforeEach(() => {
  localStorage.clear();
  agent = null;
});

describe('BadgeRowProvider chatDefaults', () => {
  it('presets the tool toggles from the endpoint defaults', () => {
    renderWith('LiteLLM');
    expect(agent).toMatchObject({
      [Tools.web_search]: true,
      [Tools.execute_code]: true,
      [Tools.memory]: true,
    });
  });

  it('lets a stored user choice override the endpoint default', () => {
    const key = `${LocalStorageKeys.LAST_WEB_SEARCH_TOGGLE_}${Constants.NEW_CONVO}`;
    localStorage.setItem(key, 'false');
    setTimestamp(key);
    renderWith('LiteLLM');
    expect(agent?.[Tools.web_search]).toBe(false);
    expect(agent?.[Tools.execute_code]).toBe(true);
  });

  it('leaves endpoints without defaults untouched', () => {
    renderWith('Other');
    expect(agent).toBeNull();
  });
});
