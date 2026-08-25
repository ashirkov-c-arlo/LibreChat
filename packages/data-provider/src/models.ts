import { z } from 'zod';
import type { AgentSubagentsConfig } from './types/assistants';
import type { TModelSpecPreset } from './schemas';
import {
  EModelEndpoint,
  tModelSpecPresetSchema,
  eModelEndpointSchema,
  AuthType,
  authTypeSchema,
} from './schemas';
import { MAX_SUBAGENTS } from './limits';

export type TModelSpec = {
  name: string;
  label: string;
  preset: TModelSpecPreset;
  order?: number;
  default?: boolean;
  softDefault?: boolean;
  description?: string;
  /**
   * Optional group name for organizing specs in the UI selector.
   * - If it matches an endpoint name (e.g., "openAI", "groq"), the spec appears nested under that endpoint
   * - If it's a custom name (doesn't match any endpoint), it creates a separate collapsible group
   * - If omitted, the spec appears as a standalone item at the top level
   */
  group?: string;
  /**
   * Optional icon URL for the group this spec belongs to.
   * Only needs to be set on one spec per group - the first one found with a groupIcon will be used.
   * Can be a URL or an endpoint name to use its icon.
   */
  groupIcon?: string | EModelEndpoint;
  showIconInMenu?: boolean;
  showIconInHeader?: boolean;
  /** Show this spec's label and description on the chat landing in place of the greeting. */
  showOnLanding?: boolean;
  /** Conversation starter prompts shown on the chat landing while this spec is active. */
  conversation_starters?: string[];
  /**
   * When false, the spec is omitted from the model selector menu and from the
   * client startup config, but remains usable when invoked explicitly by name
   * via the `spec` field (server-side resolution uses the full, unfiltered list).
   * Unlike `showIconInMenu` (which only hides the icon), this hides the whole entry.
   * Defaults to true (listed).
   */
  showInMenu?: boolean;
  iconURL?: string | EModelEndpoint; // Allow using project-included icons
  authType?: AuthType;
  /** Hide the chat input tool badge row while this model spec is active. */
  hideBadgeRow?: boolean;
  webSearch?: boolean;
  fileSearch?: boolean;
  executeCode?: boolean;
  memory?: boolean;
  /** Equip the spec's ephemeral agent with the `ask_user_question` HITL tool. */
  askUserQuestion?: boolean;
  /**
   * Let the model dispatch tool calls in the background (poll results via
   * `check_background_task`). Code execution is background-NATIVE: when the
   * admin enables the `run_in_background` agent capability, an
   * `executeCode: true` spec backgrounds code with no flag here. `true` opts
   * in every other eligible tool; a string array opts in only the named
   * tools, matched against the spec's resolved tool ids (e.g.
   * `['slow_report_mcp_analytics']`; `execute_code` and `bash_tool` both
   * select the code pair). `false`, the empty list, or a list that omits the
   * code pair explicitly opts it back out. Requires the `run_in_background`
   * agent capability.
   */
  runInBackground?: boolean | string[];
  /**
   * Inject the `intent` label param so each call streams a live status label.
   * `true` opts in every eligible tool; a string array opts in only the named
   * tools, matched against the spec's resolved tool ids (e.g.
   * `['web_search', 'search_code_mcp_github']`). Requires the `tool_intents`
   * agent capability to be enabled by the admin.
   */
  describeIntent?: boolean | string[];
  artifacts?: string | boolean;
  mcpServers?: string[];
  skills?: boolean | string[];
  subagents?: AgentSubagentsConfig;
  effortSelector?: EffortSelectorConfig;
};

export const effortValues = ['low', 'medium', 'high', 'max', 'xhigh'] as const;
export type EffortValue = (typeof effortValues)[number];

export const effortFields = ['effort', 'reasoning_effort'] as const;
export type EffortField = (typeof effortFields)[number];

export type EffortSelectorConfig = {
  field: EffortField;
  options: EffortValue[];
};

/**
 * UI metadata: opts a modelSpec into the inline composer thinking-effort
 * selector. `field` names the existing conversation/provider param the choice
 * is written to; `options` restricts the values offered for this spec. The
 * default is the spec's own `preset[field]` - there is no separate default key.
 */
export const effortSelectorSchema = z.object({
  field: z.enum(effortFields),
  options: z.array(z.enum(effortValues)).min(1),
});

export const modelSpecSubagentsSchema = z.object({
  enabled: z.boolean().optional(),
  allowSelf: z.boolean().optional(),
  agent_ids: z.array(z.string()).max(MAX_SUBAGENTS).optional(),
});

export const tModelSpecSchema = z.object({
  name: z.string(),
  label: z.string(),
  preset: tModelSpecPresetSchema,
  order: z.number().optional(),
  default: z.boolean().optional(),
  softDefault: z.boolean().optional(),
  description: z.string().optional(),
  group: z.string().optional(),
  groupIcon: z.union([z.string(), eModelEndpointSchema]).optional(),
  showIconInMenu: z.boolean().optional(),
  showIconInHeader: z.boolean().optional(),
  showOnLanding: z.boolean().optional(),
  conversation_starters: z.array(z.string()).optional(),
  showInMenu: z.boolean().optional(),
  iconURL: z.union([z.string(), eModelEndpointSchema]).optional(),
  authType: authTypeSchema.optional(),
  hideBadgeRow: z.boolean().optional(),
  webSearch: z.boolean().optional(),
  fileSearch: z.boolean().optional(),
  executeCode: z.boolean().optional(),
  memory: z.boolean().optional(),
  askUserQuestion: z.boolean().optional(),
  runInBackground: z.union([z.boolean(), z.array(z.string())]).optional(),
  describeIntent: z.union([z.boolean(), z.array(z.string())]).optional(),
  artifacts: z.union([z.string(), z.boolean()]).optional(),
  mcpServers: z.array(z.string()).optional(),
  skills: z.union([z.boolean(), z.array(z.string())]).optional(),
  subagents: modelSpecSubagentsSchema.optional(),
  effortSelector: effortSelectorSchema.optional(),
});

export const specsConfigSchema = z
  .object({
    enforce: z.boolean().default(false),
    prioritize: z.boolean().default(true),
    list: z.array(tModelSpecSchema).default([]),
    addedEndpoints: z.array(z.union([z.string(), eModelEndpointSchema])).optional(),
  })
  .superRefine((config, ctx) => {
    config.list?.forEach((spec, index) => {
      const selector = spec.effortSelector;
      if (!selector) {
        return;
      }

      const addIssue = (message: string, key = 'effortSelector') =>
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['list', index, key],
          message: `modelSpec "${spec.name}": ${message}`,
        });

      if (new Set(selector.options).size !== selector.options.length) {
        addIssue('effortSelector.options must not contain duplicates');
      }

      const presetDefault = (spec.preset as Record<string, unknown> | undefined)?.[selector.field];
      if (presetDefault == null || presetDefault === '') {
        addIssue(
          `preset.${selector.field} must be set when effortSelector.field is "${selector.field}"`,
          'preset',
        );
        return;
      }

      if (!selector.options.includes(presetDefault as EffortValue)) {
        addIssue(`preset.${selector.field} must be one of effortSelector.options`, 'preset');
      }
    });
  });

export type TSpecsConfig = z.infer<typeof specsConfigSchema>;
