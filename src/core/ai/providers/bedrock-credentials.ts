import type { AIGatewayConfig } from '../types.ts';
import { AIConfigError } from '../errors.ts';

/**
 * Client options for `@ai-sdk/amazon-bedrock`.
 *
 * Bedrock authenticates with SigV4 rather than an API key, so unlike every
 * other native provider there is no `cfg.env.*_API_KEY` to read. Credentials
 * come from the AWS chain, which is what makes a deployment inside AWS need no
 * secret at all: on EC2/ECS/EKS the chain resolves to the instance or task role
 * and refreshes itself.
 *
 * `@aws-sdk/credential-providers` is required lazily, matching how the
 * claude-cli language model is pulled in below. It is only needed when a Bedrock
 * model is actually selected, and it is by far the heaviest dependency here — a
 * user on OpenAI or Anthropic should never pay to load it.
 *
 */
export function bedrockClientOptions(cfg: AIGatewayConfig): {
  region: string;
  credentialProvider?: () => PromiseLike<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  }>;
} {
  const region = cfg.env.AWS_REGION?.trim() || cfg.env.AWS_DEFAULT_REGION?.trim();
  if (!region) {
    throw new AIConfigError(
      `Bedrock requires a region. Set AWS_REGION (or AWS_DEFAULT_REGION).`,
      `export AWS_REGION=us-east-2`,
    );
  }

  // Explicit keys in the environment are handled by the provider itself; adding
  // a chain on top would only obscure which credential actually won.
  if (cfg.env.AWS_ACCESS_KEY_ID && cfg.env.AWS_SECRET_ACCESS_KEY) {
    return { region };
  }

  const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
  const chain = fromNodeProviderChain();
  return {
    region,
    credentialProvider: async () => {
      const c = await chain();
      return {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
        ...(c.sessionToken ? { sessionToken: c.sessionToken } : {}),
      };
    },
  };
}
