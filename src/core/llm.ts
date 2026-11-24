import { ProjectConfig } from '../types';
import OpenAI from 'openai';

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export interface ChatOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 覆盖默认重试次数 */
  maxRetries?: number;
}

export interface ChatResult {
  content: string;
  truncated: boolean;
  finishReason?: string | null;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

let client: OpenAI | null = null;

export function initLLM(config: ProjectConfig): OpenAI {
  client = new OpenAI({
    apiKey: config.llm.apiKey,
    baseURL: config.llm.baseUrl,
    timeout: config.llm.timeoutMs ?? 120_000,
    maxRetries: 0, // 由 chat 层统一重试
  });
  return client;
}

export function getLLM(): OpenAI {
  if (!client) {
    throw new Error('LLM 未初始化，请先调用 initLLM()');
  }
  return client;
}

/** 测试或自定义注入时可替换客户端。 */
export function setLLM(instance: OpenAI | null): void {
  client = instance;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; code?: string; message?: string };
  if (e.status === 429 || e.status === 500 || e.status === 502 || e.status === 503 || e.status === 504) {
    return true;
  }
  const msg = String(e.message || e.code || '').toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  );
}

/**
 * 带超时语义（由 SDK timeout）、指数退避重试、空响应与截断检测的 chat。
 */
export async function chat(config: ProjectConfig, options: ChatOptions): Promise<string> {
  const result = await chatDetailed(config, options);
  return result.content;
}

export async function chatDetailed(config: ProjectConfig, options: ChatOptions): Promise<ChatResult> {
  const llm = getLLM();
  const maxRetries = options.maxRetries ?? config.llm.maxRetries ?? 3;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await llm.chat.completions.create({
        model: options.model || config.llm.model,
        temperature: options.temperature ?? config.llm.temperature,
        max_tokens: options.maxTokens ?? config.llm.maxTokens,
        messages: [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: options.userMessage },
        ],
      });

      const choice = response.choices[0];
      const content = choice?.message?.content?.trim() || '';
      const finishReason = choice?.finish_reason;

      if (!content) {
        throw new LLMError('LLM 返回空内容', undefined, attempt < maxRetries);
      }

      return {
        content,
        truncated: finishReason === 'length',
        finishReason,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof LLMError ? err.retryable : isRetryableError(err);
      if (!retryable || attempt >= maxRetries) break;
      const delay = Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 200);
      await sleep(delay);
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : `LLM 调用失败: ${String(lastError)}`;
  throw new LLMError(message, lastError, false);
}
