/**
 * Amazon Bedrock recipe smoke.
 *
 * Pins the contract that distinguishes Bedrock from the `anthropic` recipe:
 *   - no credential env var is required (SigV4 via the AWS chain)
 *   - model ids are inference profiles, not bare foundation-model ids
 *   - first-party Claude ids alias onto the `us.` profiles
 *   - prompt caching IS claimed, and the gateway earns it by emitting every
 *     breakpoint in both spellings — Anthropic `cacheControl` plus Bedrock's
 *     positional `cachePoint`, the latter only for this recipe
 */

import { describe, expect, test } from 'bun:test';
import { getRecipe } from '../../src/core/ai/recipes/index.ts';
import { bedrockClientOptions } from '../../src/core/ai/providers/bedrock-credentials.ts';
import { dimsProviderOptions } from '../../src/core/ai/dims.ts';
import { canonicalLookup } from '../../src/core/model-pricing.ts';
import { isEmbedRetriableError } from '../../src/core/embed-retry.ts';
import { isThinkingByDefaultModel } from '../../src/core/ai/gateway.ts';
import { maxOutputTokensFor } from '../../src/core/think/index.ts';

const cfg = (env: Record<string, string | undefined>) => ({ env }) as any;

describe('recipe: bedrock', () => {
  test('registered as a native provider', () => {
    const r = getRecipe('bedrock');
    expect(r).toBeDefined();
    expect(r!.id).toBe('bedrock');
    expect(r!.tier).toBe('native');
    expect(r!.implementation).toBe('native-bedrock');
  });

  test('requires no credential env var', () => {
    // The property that makes a deployment inside AWS need no secret: an EC2
    // host with an instance role has working credentials and no AWS_* set, so
    // there is no single variable whose presence signals readiness.
    expect(getRecipe('bedrock')!.auth_env!.required).toEqual([]);
  });

  test('chat and expansion models are inference profiles', () => {
    // Bare `anthropic.claude-*` ids are rejected for these models; only the
    // cross-Region profile form resolves.
    const r = getRecipe('bedrock')!;
    for (const m of r.touchpoints.chat!.models) {
      expect(m, `${m} should be an inference profile`).toMatch(/^(us|eu|global)\./);
    }
    for (const m of r.touchpoints.expansion!.models) {
      expect(m, `${m} should be an inference profile`).toMatch(/^(us|eu|global)\./);
    }
  });

  test('first-party Claude ids alias onto us. profiles', () => {
    // Lets a config move between `anthropic:` and `bedrock:` by changing only
    // the provider half of `provider:model`.
    const aliases = getRecipe('bedrock')!.aliases!;
    expect(aliases['claude-sonnet-5']).toBe('us.anthropic.claude-sonnet-5');
    expect(aliases['claude-opus-5']).toBe('us.anthropic.claude-opus-5');
  });

  test('claims prompt caching, which the gateway actually delivers', () => {
    // Only honest because the gateway emits every breakpoint in both spellings.
    // Bedrock reads `providerOptions.bedrock.cachePoint`; the Anthropic
    // `cacheControl` marker alone would be dropped in transit and cache nothing
    // while still succeeding — the failure mode this pair of assertions exists
    // to catch.
    expect(getRecipe('bedrock')!.touchpoints.chat!.supports_prompt_cache).toBe(true);
  });

  test('embedding declares per-model dims, not one recipe-wide width', () => {
    // The gateway asserts returned embeddings match the configured width, so a
    // single default that suits one model fails at first embed for the others.
    const e = getRecipe('bedrock')!.touchpoints.embedding!;
    expect(e.default_model).toBe('us.cohere.embed-v4:0');
    expect(e.default_dims).toBe(1536);
    expect(e.model_dims!['us.cohere.embed-v4:0']).toBe(1536);
    expect(e.model_dims!['amazon.titan-embed-text-v2:0']).toBe(1024);
  });

  test('the configured embedding model is actually listed', () => {
    // Regression: the recipe originally listed the Cohere v3 models, which are
    // not offered in us-east-2 at all, while the host was configured for v4.
    const e = getRecipe('bedrock')!.touchpoints.embedding!;
    expect(e.models).toContain('us.cohere.embed-v4:0');
    expect(e.max_input_tokens!['us.cohere.embed-v4:0']).toBe(128000);
  });
});

describe('bedrockClientOptions', () => {
  test('requires a region', () => {
    expect(() => bedrockClientOptions(cfg({}))).toThrow(/region/i);
  });

  test('accepts AWS_DEFAULT_REGION as a fallback', () => {
    expect(bedrockClientOptions(cfg({ AWS_DEFAULT_REGION: 'us-east-2' })).region).toBe('us-east-2');
  });

  test('AWS_REGION wins over AWS_DEFAULT_REGION', () => {
    const o = bedrockClientOptions(cfg({ AWS_REGION: 'eu-west-1', AWS_DEFAULT_REGION: 'us-east-2' }));
    expect(o.region).toBe('eu-west-1');
  });

  test('defers to the provider when explicit keys are in the environment', () => {
    // Layering a chain on top would only obscure which credential won.
    const o = bedrockClientOptions(cfg({
      AWS_REGION: 'us-east-2',
      AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'secret',
    }));
    expect(o.credentialProvider).toBeUndefined();
  });

  test('supplies a credential provider when no explicit keys are set', () => {
    // The instance-role path: nothing in the environment, credentials resolved
    // from the chain at call time.
    const o = bedrockClientOptions(cfg({ AWS_REGION: 'us-east-2' }));
    expect(typeof o.credentialProvider).toBe('function');
  });
});

describe('bedrock embedding provider options', () => {
  const opts = (model: string, dims: number, t?: 'query' | 'document') =>
    dimsProviderOptions('native-bedrock', model, dims, t) as any;

  // THE LOAD-BEARING ASSERTION.
  //
  // @ai-sdk/amazon-bedrock defaults an unset inputType to `search_query`. With
  // no case in dimsProviderOptions, every indexed document would be embedded as
  // a query — the request succeeds, nothing errors, and the whole index is
  // quietly built on the wrong side of an asymmetric encoder.
  test('an unspecified input type embeds as a DOCUMENT, not a query', () => {
    expect(opts('us.cohere.embed-v4:0', 1536).bedrock.inputType).toBe('search_document');
  });

  test('an explicit query embeds as a query', () => {
    expect(opts('us.cohere.embed-v4:0', 1536, 'query').bedrock.inputType).toBe('search_query');
    expect(opts('us.cohere.embed-v4:0', 1536, 'document').bedrock.inputType).toBe('search_document');
  });

  test('cohere takes outputDimension; titan takes dimensions', () => {
    // Different field names for the same idea, which is why the case branches
    // on the family rather than emitting one shape.
    expect(opts('us.cohere.embed-v4:0', 1536).bedrock.outputDimension).toBe(1536);
    expect(opts('amazon.titan-embed-text-v2:0', 1024).bedrock.dimensions).toBe(1024);
    expect(opts('amazon.titan-embed-text-v2:0', 1024).bedrock.inputType).toBeUndefined();
  });

  test('a width the model cannot serve fails loudly at config time', () => {
    // Titan tops out at 1024, so the recipe-wide dims_options is wider than any
    // single model. Without this the only signal is an upstream 400 that reads
    // as a transient network error.
    expect(() => opts('amazon.titan-embed-text-v2:0', 1536)).toThrow(/1536/);
    expect(() => opts('us.cohere.embed-v4:0', 999)).toThrow(/999/);
  });

  test('the us. inference-profile prefix is still recognised as cohere', () => {
    // The provider detects family with modelId.includes("cohere.embed-"), and
    // the recipe's default model carries a us. prefix.
    expect(opts('us.cohere.embed-v4:0', 1024).bedrock.inputType).toBeDefined();
  });
});

describe('recipe: bedrock pricing', () => {
  // Without a canonical entry the budget meter disables itself with
  // BUDGET_METER_NO_PRICING and every chat-lane spend ceiling stops applying —
  // silently, because a missing price throws nothing. The recipe's own
  // cost fields are not what the meter reads.
  test('every chat and expansion model resolves to canonical pricing', () => {
    const tp = getRecipe('bedrock')!.touchpoints;
    const ids = [...(tp.chat?.models ?? []), ...(tp.expansion?.models ?? [])];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const pricing = canonicalLookup(`bedrock:${id}`);
      expect(pricing, `no canonical pricing for bedrock:${id}`).toBeDefined();
      expect(pricing!.input).toBeGreaterThan(0);
      expect(pricing!.output).toBeGreaterThan(0);
    }
  });

  // Bedrock is NOT the first-party rate, and assuming it was over-estimated
  // this deployment's chat model by 50%. Pinned against a future edit that
  // "tidies" the fork rows to match the Anthropic table above.
  test('sonnet-5 carries the Bedrock rate, which is below Anthropic list', () => {
    const bedrock = canonicalLookup('bedrock:us.anthropic.claude-sonnet-5')!;
    expect(bedrock.input).toBe(2.0);
    expect(bedrock.output).toBe(10.0);
    expect(bedrock.input).toBeLessThan(canonicalLookup('anthropic:claude-sonnet-5')!.input);
    // Omitted deliberately; see the table comment. Consumers fall back to the
    // input rate, which is conservative for a spend gate.
    expect(bedrock.cache_read).toBeUndefined();
  });
});

describe('recipe: bedrock transient errors', () => {
  // The observed failure carried no status code — `undefined:` where the error
  // name belongs — so none of the 429/502/503/504 patterns matched and 47
  // chunks failed on the first attempt against a message that says to retry.
  test('the codeless server error is retriable', () => {
    const msg = '[embed(bedrock:us.cohere.embed-v4:0)] undefined: The system '
      + 'encountered an unexpected error during processing. Try your request again.';
    expect(isEmbedRetriableError(new Error(msg))).toBe(true);
  });

  // AWS spells these without spaces, so `service unavailable` never matched.
  test('AWS exception names are retriable', () => {
    for (const name of ['InternalServerException', 'ServiceUnavailableException', 'ModelNotReadyException']) {
      expect(isEmbedRetriableError(new Error(`[embed(bedrock:x)] ${name}: boom`)), name).toBe(true);
    }
  });

  // Retrying a marketplace-agreement or validation error five times only
  // delays the report; these must keep failing fast.
  test('permanent errors stay permanent', () => {
    for (const name of ['ValidationException', 'AccessDeniedException', 'ResourceNotFoundException']) {
      expect(isEmbedRetriableError(new Error(`[embed(bedrock:x)] ${name}: nope`)), name).toBe(false);
    }
  });
});

describe('bedrock inference-profile ids and output caps', () => {
  // Bedrock inference-profile ids are DOTTED (`us.anthropic.claude-sonnet-5`)
  // where every other spelling is colon/slash delimited. Both output-cap
  // predicates keyed on a separator class that omitted `.`, so every Bedrock
  // Claude id fell through to the conservative default while the identical
  // first-party id got the raised one. Claude 5 spends output budget on
  // reasoning, so `gbrain think` truncated its JSON envelope mid-answer and
  // reported LLM_OUTPUT_TRUNCATED + SALVAGED_ANSWER_FROM_MALFORMED_JSON.
  const profileIds = [
    'bedrock:us.anthropic.claude-sonnet-5',
    'bedrock:us.anthropic.claude-opus-5',
    'bedrock:eu.anthropic.claude-sonnet-5',
    'bedrock:global.anthropic.claude-fable-5',
    'us.anthropic.claude-sonnet-5',
  ];

  test.each(profileIds)('%s is a thinking model', (id) => {
    expect(isThinkingByDefaultModel(id)).toBe(true);
  });

  test.each(profileIds)('%s gets the raised think cap', (id) => {
    expect(maxOutputTokensFor(id)).toBeGreaterThan(maxOutputTokensFor('openai:gpt-4o'));
  });

  test('the raised cap matches what the first-party spelling already got', () => {
    expect(maxOutputTokensFor('bedrock:us.anthropic.claude-sonnet-5'))
      .toBe(maxOutputTokensFor('anthropic:claude-sonnet-5'));
  });

  test('Bedrock 4.x profile ids get it too', () => {
    expect(maxOutputTokensFor('bedrock:us.anthropic.claude-sonnet-4-6'))
      .toBe(maxOutputTokensFor('anthropic:claude-sonnet-4-6'));
  });

  // The guard that must survive the widened separator class. The 3.5 family is
  // capped at 8192 upstream and raising it 400s, so the letters-only family
  // segment has to keep excluding `claude-3-5-*` on the dotted spelling too —
  // `3` is not `[a-z]`.
  test.each([
    'anthropic:claude-3-5-sonnet-20241022',
    'bedrock:us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  ])('%s is NOT treated as a thinking model', (id) => {
    expect(isThinkingByDefaultModel(id)).toBe(false);
  });
});
