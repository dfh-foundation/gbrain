import type { Recipe } from '../types.ts';

/**
 * Amazon Bedrock, via `@ai-sdk/amazon-bedrock`.
 *
 * Distinct from the `anthropic` recipe in one way that matters operationally:
 * auth is the AWS credential chain, not an API key. On EC2, ECS or EKS that
 * resolves to the instance/task role, so a deployment needs no secret at all —
 * which is the main reason to prefer it over `anthropic` when already inside
 * AWS. It also keeps inference traffic on AWS's network.
 *
 * Model ids are inference-profile ids, not bare foundation-model ids. Claude on
 * Bedrock is served through cross-Region profiles carrying a `us.` / `eu.` /
 * `global.` prefix; the bare `anthropic.claude-*` form is rejected for these
 * models. Discover what a given account can reach with:
 *
 *   aws bedrock list-inference-profiles --region <region>
 *
 * Availability is per-account (model access is granted per account and region),
 * so the lists below are what Bedrock offers, not what any given account has.
 */
export const bedrock: Recipe = {
  id: 'bedrock',
  name: 'Amazon Bedrock',
  tier: 'native',
  implementation: 'native-bedrock',
  // Deliberately no `auth_env.required`: credentials come from the AWS chain
  // (env vars, shared config, SSO, container or instance metadata), so there is
  // no single variable whose presence signals readiness. `capability.ts` treats
  // an absent `auth_env` as "no required vars", which is the correct answer here
  // — an EC2 host with an instance role has working credentials and no AWS_* set.
  auth_env: {
    required: [],
    optional: ['AWS_REGION', 'AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'],
    setup_url: 'https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html',
  },
  touchpoints: {
    embedding: {
      // Both the inference-profile and on-demand forms. Unlike the newer Claude
      // models, the bare foundation-model ids still resolve for embeddings.
      models: [
        'us.cohere.embed-v4:0',
        'cohere.embed-v4:0',
        'amazon.titan-embed-text-v2:0',
      ],
      default_model: 'us.cohere.embed-v4:0',

      // Cohere Embed v4's native width, matching default_model. Getting this
      // wrong is not cosmetic: the gateway asserts returned embeddings match
      // the configured width, so a recipe-wide default that suits a different
      // model fails at first embed.
      default_dims: 1536,
      model_dims: {
        'us.cohere.embed-v4:0': 1536,
        'cohere.embed-v4:0': 1536,
        'amazon.titan-embed-text-v2:0': 1024,
      },

      // Both are Matryoshka, so a narrower index is a config change rather than
      // a different model.
      dims_options: [256, 512, 1024, 1536],

      max_input_tokens: {
        'us.cohere.embed-v4:0': 128000,
        'cohere.embed-v4:0': 128000,
        'amazon.titan-embed-text-v2:0': 8192,
      },

      cost_per_1m_tokens_usd: 0.12,
      price_last_verified: '2026-09-06',
    },
    expansion: {
      models: [
        'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        'us.anthropic.claude-sonnet-5',
      ],
      cost_per_1m_tokens_usd: 0.25,
      price_last_verified: '2026-09-06',
    },
    chat: {
      models: [
        'us.anthropic.claude-fable-5',
        'us.anthropic.claude-opus-5',
        'us.anthropic.claude-opus-4-8',
        'us.anthropic.claude-opus-4-7',
        'us.anthropic.claude-sonnet-5',
        'us.anthropic.claude-sonnet-4-6',
        'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      ],
      supports_tools: true,
      supports_subagent_loop: true,
      // The gateway emits each cache breakpoint in both spellings — Anthropic's
      // `cacheControl` and Bedrock's positional `cachePoint` — so caching is
      // real here, not a claim the transport drops.
      supports_prompt_cache: true,
      model_context_tokens: {
        'us.anthropic.claude-fable-5': 1_000_000,
        'us.anthropic.claude-opus-5': 1_000_000,
        'us.anthropic.claude-sonnet-5': 1_000_000,
        'us.anthropic.claude-opus-4-8': 1_000_000,
        'us.anthropic.claude-opus-4-7': 1_000_000,
      },
      max_context_tokens: 200000,
      // Bedrock is partner-priced and differs from the first-party API; these
      // are sonnet-class list rates. See https://aws.amazon.com/bedrock/pricing/
      cost_per_1m_input_usd: 3.0,
      cost_per_1m_output_usd: 15.0,
      price_last_verified: '2026-09-06',
    },
  },
  // Accept the first-party model ids as aliases for the `us.` profiles, so a
  // config can move between `anthropic:` and `bedrock:` by changing only the
  // provider half of `provider:model`.
  aliases: {
    'claude-fable-5': 'us.anthropic.claude-fable-5',
    'claude-opus-5': 'us.anthropic.claude-opus-5',
    'claude-opus-4-8': 'us.anthropic.claude-opus-4-8',
    'claude-opus-4-7': 'us.anthropic.claude-opus-4-7',
    'claude-sonnet-5': 'us.anthropic.claude-sonnet-5',
    'claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
    'claude-haiku-4-5': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'cohere.embed-v4:0': 'us.cohere.embed-v4:0',
  },
  setup_hint:
    'Configure AWS credentials (instance role, SSO profile, or AWS_* env vars) and set AWS_REGION, then enable model access in the Bedrock console.',
};
