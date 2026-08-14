import { ProjectConfig } from '../types';
import OpenAI from 'openai';

let client: OpenAI | null = null;

export function initLLM(config: ProjectConfig): OpenAI {
  client = new OpenAI({
    apiKey: config.llm.apiKey,
    baseURL: config.llm.baseUrl,
  });
  return client;
}

export function getLLM(): OpenAI {
  if (!client) {
    throw new Error('LLM 未初始化，请先调用 initLLM()');
  }
  return client;
}

export interface ChatOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function chat(config: ProjectConfig, options: ChatOptions): Promise<string> {
  const llm = getLLM();
  const response = await llm.chat.completions.create({
    model: options.model || config.llm.model,
    temperature: options.temperature ?? config.llm.temperature,
    max_tokens: options.maxTokens ?? config.llm.maxTokens,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userMessage },
    ],
  });
  return response.choices[0]?.message?.content || '';
}
