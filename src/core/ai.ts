/**
 * AI Abstraction — WebWaka Fintech Suite
 *
 * Invariant 7: Vendor Neutral AI
 * ALL AI calls go through OpenRouter. NEVER call OpenAI, Anthropic, or Google
 * APIs directly. This ensures vendor neutrality and cost optimisation.
 *
 * Use cases: Credit scoring, fraud detection, investment recommendations
 */

export interface AICompletionParams {
  prompt: string;
  model?: string; // OpenRouter model string
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AICompletionResponse {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// Default model — can be overridden per request
const DEFAULT_MODEL = 'anthropic/claude-3-haiku';

/**
 * Call the OpenRouter API for AI completions.
 * @param apiKey — OPENROUTER_API_KEY from environment
 * @param params — completion parameters
 */
export async function getAICompletion(
  apiKey: string,
  params: AICompletionParams
): Promise<AICompletionResponse> {
  const messages = [];
  if (params.systemPrompt) {
    messages.push({ role: 'system', content: params.systemPrompt });
  }
  messages.push({ role: 'user', content: params.prompt });

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://webwaka.com',
      'X-Title': 'WebWaka Fintech Suite',
    },
    body: JSON.stringify({
      model: params.model ?? DEFAULT_MODEL,
      messages,
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter AI call failed: ${response.status}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  return {
    content: data.choices[0]?.message.content ?? '',
    model: data.model,
    usage: {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    },
  };
}
