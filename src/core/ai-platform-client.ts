/**
 * AI Platform Client — webwaka-fintech
 * Blueprint Reference: WEBWAKA_AI_PLATFORM_ARCHITECTURE.md — "Vertical Consumer Migration"
 *
 * Task: FIN-6 — Migrate fintech AI calls to webwaka-ai-platform
 *
 * This module replaces the local `src/core/ai.ts` with a thin client
 * that delegates all AI calls to the centralised webwaka-ai-platform service.
 *
 * Benefits:
 * - Entitlement enforcement (tenant must have capability enabled)
 * - BYOK support (tenant's own OpenRouter key used if registered)
 * - Automatic CF Workers AI fallback
 * - Centralised usage billing via ai.usage.recorded events
 *
 * MIGRATION NOTE: Replace all imports of `getAICompletion` from `./ai` with
 * `getAICompletion` from `./ai-platform-client`. The function signature is
 * backward-compatible.
 */

export interface AICompletionParams {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** AI capability identifier — required for entitlement enforcement */
  capabilityId?: string;
}

export interface AICompletionResponse {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  provider?: 'openrouter' | 'cloudflare-workers-ai';
  usedByok?: boolean;
}

export interface AIPlatformEnv {
  /** URL of the webwaka-ai-platform worker */
  AI_PLATFORM_URL: string;
  /** Inter-service secret for authenticating calls to webwaka-ai-platform */
  INTER_SERVICE_SECRET: string;
  /** Tenant ID (extracted from JWT or request context) */
  TENANT_ID?: string;
  /** JWT token for user-scoped calls (alternative to inter-service auth) */
  AUTH_TOKEN?: string;
}

/**
 * Call the webwaka-ai-platform completions API.
 *
 * @param env          Environment bindings containing AI_PLATFORM_URL and auth
 * @param params       Completion parameters
 * @param tenantId     The tenant making the request
 * @returns            AI completion response
 */
export async function getAICompletion(
  env: AIPlatformEnv,
  params: AICompletionParams,
  tenantId?: string,
): Promise<AICompletionResponse> {
  const resolvedTenantId = tenantId ?? env.TENANT_ID;
  if (!resolvedTenantId) {
    throw new Error('tenantId is required for AI platform calls');
  }

  const capabilityId = params.capabilityId ?? 'ai.fintech.general';

  const messages = [];
  if (params.systemPrompt) {
    messages.push({ role: 'system' as const, content: params.systemPrompt });
  }
  messages.push({ role: 'user' as const, content: params.prompt });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Tenant-Id': resolvedTenantId,
  };

  // Use inter-service secret if available, otherwise fall back to JWT
  if (env.INTER_SERVICE_SECRET) {
    headers['X-Inter-Service-Secret'] = env.INTER_SERVICE_SECRET;
    headers['X-User-Id'] = 'system';
  } else if (env.AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${env.AUTH_TOKEN}`;
  }

  const response = await fetch(`${env.AI_PLATFORM_URL}/v1/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      capabilityId,
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 1024,
    }),
    signal: AbortSignal.timeout(35000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
    throw new Error(`AI Platform error ${response.status}: ${error.error ?? 'Unknown'}`);
  }

  const data = await response.json() as {
    content: string;
    model: string;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    provider: 'openrouter' | 'cloudflare-workers-ai';
    usedByok: boolean;
  };

  return {
    content: data.content,
    model: data.model,
    usage: data.usage,
    provider: data.provider,
    usedByok: data.usedByok,
  };
}
