# Why this fork exists

Upstream is [garrytan/gbrain](https://github.com/garrytan/gbrain). This fork
carries one patch: a native Amazon Bedrock provider, in two halves that are
easy to separate by accident — the recipe, and its rows in the canonical
pricing table.

Designs for Health runs gbrain on an EC2 host inside AWS. Every provider gbrain
ships needs an API key; Bedrock signs with SigV4, so the host authenticates from
its instance role and stores no model-provider credential at all. That is the
whole reason for the fork — not a preference for Bedrock, but removing a secret
from a deployment that would otherwise have to hold, rotate and protect one.

There is no upstream PR. An earlier community attempt at Bedrock support
([#1826](https://github.com/garrytan/gbrain/pull/1826), and
[#2842](https://github.com/garrytan/gbrain/pull/2842) via a LiteLLM proxy) was
declined with "Bedrock is the strongest case here and may be revisited". Assume
the fork is permanent until told otherwise.

## Branch layout

`feat/bedrock-provider` branches off the **`v0.48.5.0` tag**, not `master`.

That is deliberate. The consumer pins an exact commit, so the deployed tree
should be a released upstream tag plus this patch and nothing else — `master`
carries unreleased work that has never been through an upstream release.

## Who consumes this

[`designsforhealth/brain`](https://github.com/designsforhealth/brain) pins the
tip of this branch as `dfh.brain.gbrain.rev` in `hosts/brain/default.nix`, and
installs it with `bun install --global github:dfh-foundation/gbrain#<rev>`.

A bump is: rebase here, verify, push, then update that one field and redeploy.
Nothing else references this fork.

## Rebasing onto a newer upstream tag

```sh
git fetch upstream --tags
git rebase --onto v0.<new> v0.48.5.0 feat/bedrock-provider
```

Then re-verify. All of these must pass before the tip is pinned:

```sh
bun install
bun run typecheck
bun test test/ai/
bun run check:module-size
bun run check:gateway-routed
bun run check:exports-count
```

### What tends to need attention on a rebase

**The `@ai-sdk/amazon-bedrock` pin.** `^4.0.172` is the newest release built on
`@ai-sdk/provider@3.x`, which is the generation gbrain's anthropic/openai/google
providers are on. The 5.x line moved to `provider@4.x`. If upstream ever bumps
its providers to the 4.x generation, this pin must move with them — mixing
provider-spec majors in one process does not work. Check with:

```sh
# @ai-sdk/provider is transitive, so `bun pm ls` does not show it — read the
# resolved versions directly. The major must match across both.
for p in provider amazon-bedrock anthropic; do
  printf '%-16s %s\n' "$p" "$(jq -r .version "node_modules/@ai-sdk/$p/package.json")"
done
```

**The module-size ratchet.** `scripts/module-size-limits.tsv` carries a raised
ceiling for `src/core/ai/gateway.ts` with the reason appended. Upstream edits
that file too, so it conflicts often; keep both sides' entries and re-derive the
number rather than taking either side wholesale.

**`test/ai/gateway-chat.test.ts`.** The patch adds `bedrock` to the
`ALWAYS_CACHES` set in the "recipes declaring supports_prompt_cache" invariant.
A conflict here means upstream changed which providers may claim caching —
re-read that test before resolving.

**The Bedrock rows in `src/core/model-pricing.ts`.** `budget-meter.ts` reads
`CANONICAL_PRICING`, never the recipe, so a recipe carrying `cost_per_1m_*`
fields is not enough. With no `bedrock:` key, `canonicalLookup` misses at every
fallback and the budget gate disables itself with `BUDGET_METER_NO_PRICING` —
no error, no failing test, just every chat-lane spend ceiling silently gone.
That is what the fork shipped with until 2026-09-09.

**Do not assume Bedrock matches Anthropic list pricing.** It does not: Sonnet 5
is $2/$10 on Bedrock against Anthropic's $3/$15, and mirroring the first-party
table over-estimated the deployed chat model by 50%. Every other Claude tier
happens to match, which makes the one exception easy to miss. Read the rates off
<https://aws.amazon.com/bedrock/pricing/> rather than inferring them, and note
that upstream's Anthropic row carries list rates with launch discounts
deliberately unmodelled — so the two tables disagree by design.

The rows omit `cache_read`/`cache_write` even though Bedrock publishes both. The
table-integrity test requires non-Anthropic rows to omit them, and patching a
shared upstream test is fork surface that conflicts on every rebase. Consumers
fall back to the full input rate, which over-estimates a cached read — the safe
direction for a gate, if a coarse one. The published figures are recorded in a
comment beside the rows should that ever need revisiting.

`test/ai/recipe-bedrock.test.ts` asserts every chat and expansion model in the
recipe resolves to pricing, and pins Sonnet 5 below Anthropic list, so both a
missing rate and a well-meaning "tidy these to match the table above" now fail.

**`dimsProviderOptions` in `src/core/ai/dims.ts`.** The `native-bedrock` case is
load-bearing in a way that is easy to lose in a conflict: without it neither the
dimension request nor the query/document signal reaches the provider, and
`@ai-sdk/amazon-bedrock` defaults an unset `inputType` to `search_query` — so
every *indexed document* gets embedded as a query. The index is then quietly
built on the wrong side of an asymmetric encoder, with no error anywhere.
`test/ai/recipe-bedrock.test.ts` asserts the document-side default; if that test
is what conflicts, fix the code rather than the assertion.

## Model ids

Chat and expansion take Bedrock **inference-profile** ids (`us.`/`eu.`/`global.`
prefix) — the bare `anthropic.claude-*` form is rejected for current models. The
Claude 4.6+ generation is dateless (`us.anthropic.claude-sonnet-5`), matching the
first-party convention; older models keep a date and version suffix. Embeddings
accept both the profile and on-demand forms.

Model access is granted per AWS account, and inference authorizes against the
profile named in the request rather than the foundation model it routes to.
Confirm what an account can actually reach with:

```sh
aws bedrock list-inference-profiles --region <region>
```
