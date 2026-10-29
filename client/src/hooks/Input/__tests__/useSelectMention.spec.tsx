import React from 'react';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { renderHook } from '@testing-library/react';
import type { TConversation, TEndpointsConfig } from 'librechat-data-provider';
import useSelectMention from '../useSelectMention';
import store from '~/store';

jest.mock('~/hooks', () => ({
  useDefaultConvo:
    () =>
    ({
      conversation,
      preset,
    }: {
      conversation: TConversation;
      preset: Partial<TConversation>;
    }) => ({
      ...conversation,
      ...preset,
    }),
}));

const endpointsConfig = {
  LiteLLM: { order: 0, type: 'custom' },
} as unknown as TEndpointsConfig;

/** A saved conversation carries the budget the server computed for its model. */
const saved = {
  conversationId: 'c1',
  endpoint: 'LiteLLM',
  endpointType: 'custom',
  model: 'Sonnet 5.5',
  maxContextTokens: 950000,
} as unknown as TConversation;

const select = (model: string, modularChat: boolean) => {
  const newConversation = jest.fn();
  const { result } = renderHook(
    () =>
      useSelectMention({
        modelSpecs: [],
        returnHandlers: true,
        endpointsConfig,
        getConversation: () => saved,
        newConversation,
      }),
    {
      wrapper: ({ children }) => (
        <RecoilRoot
          initializeState={({ set }) => {
            set(store.modularChat, modularChat);
          }}
        >
          <MemoryRouter>{children}</MemoryRouter>
        </RecoilRoot>
      ),
    },
  );
  result.current.onSelectEndpoint?.('LiteLLM', { model });
  return newConversation.mock.calls[0][0].template as Partial<TConversation>;
};

describe('useSelectMention model switch', () => {
  it.each([true, false])(
    'drops the previous model context limit when the model changes (modular: %s)',
    (modularChat) => {
      const template = select('Qwen3 32B', modularChat);
      expect(template.model).toBe('Qwen3 32B');
      expect(template.maxContextTokens).toBeUndefined();
    },
  );

  it('keeps the context limit when the same model is selected again', () => {
    expect(select('Sonnet 5.5', true).maxContextTokens).toBe(950000);
  });
});
