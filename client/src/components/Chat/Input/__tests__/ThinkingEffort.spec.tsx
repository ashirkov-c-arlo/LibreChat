import React from 'react';
import { render, screen } from '@testing-library/react';
import ThinkingEffort from '../ThinkingEffort';

const mockSetOption = jest.fn();
let mockConversation: { endpoint: string; model: string; reasoning_effort?: string } | null = null;
let mockTokenConfig: Record<string, Record<string, { reasoningEfforts?: string[] }>> = {};
let mockEndpointsConfig: Record<string, { chatDefaults?: { reasoningEffort?: string } }> = {};

jest.mock('@librechat/client', () => ({
  TooltipAnchor: ({ render }: { render: React.ReactElement }) => render,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: { parameters: true } } }),
  useGetEndpointsQuery: () => ({ data: mockEndpointsConfig }),
  useTokenConfigQuery: () => ({ data: mockTokenConfig }),
}));

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ conversation: mockConversation, isSubmitting: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useSetIndexOptions: () => ({
    setOption: (field: string) => (value: unknown) => mockSetOption(field, value),
  }),
}));

const LITELLM = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

beforeEach(() => {
  mockSetOption.mockClear();
  mockTokenConfig = {
    LiteLLM: { 'Sonnet 5.5': { reasoningEfforts: LITELLM }, 'Qwen3 32B': {} },
  };
  mockEndpointsConfig = { LiteLLM: { chatDefaults: { reasoningEffort: 'medium' } } };
});

describe('ThinkingEffort from gateway metadata', () => {
  it('shows the selector for a model with reported efforts and seeds the default', () => {
    mockConversation = { endpoint: 'LiteLLM', model: 'Sonnet 5.5' };
    render(<ThinkingEffort />);
    expect(screen.getByTestId('thinking-effort')).toHaveTextContent(
      'com_ui_thinking_effort_medium',
    );
    expect(mockSetOption).toHaveBeenCalledWith('reasoning_effort', 'medium');
  });

  it('keeps a stored level the model offers', () => {
    mockConversation = { endpoint: 'LiteLLM', model: 'Sonnet 5.5', reasoning_effort: 'max' };
    render(<ThinkingEffort />);
    expect(screen.getByTestId('thinking-effort')).toHaveTextContent('com_ui_thinking_effort_max');
    expect(mockSetOption).not.toHaveBeenCalled();
  });

  it('renders nothing for a model without reported efforts', () => {
    mockConversation = { endpoint: 'LiteLLM', model: 'Qwen3 32B' };
    const { container } = render(<ThinkingEffort />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the token config has not loaded', () => {
    mockTokenConfig = {};
    mockConversation = { endpoint: 'LiteLLM', model: 'Sonnet 5.5' };
    const { container } = render(<ThinkingEffort />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Default and sends nothing when the configured default is not offered', () => {
    mockTokenConfig = { LiteLLM: { 'Kimi K3': { reasoningEfforts: ['low', 'high', 'max'] } } };
    mockConversation = { endpoint: 'LiteLLM', model: 'Kimi K3' };
    render(<ThinkingEffort />);
    expect(screen.getByTestId('thinking-effort')).toHaveTextContent(
      'com_ui_thinking_effort_default',
    );
    expect(mockSetOption).not.toHaveBeenCalled();
  });
});
