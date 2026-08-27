import { ProjectConfig, RoleKey, AgentMessage, MessageType } from '../types';
import { chat } from '../core/llm';
import { Logger, KnowledgeBase } from '../utils/file';

export abstract class BaseAgent {
  protected role: RoleKey;
  protected config: ProjectConfig;
  protected logger: Logger;
  protected knowledge: KnowledgeBase;

  constructor(role: RoleKey, config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    this.role = role;
    this.config = config;
    this.logger = logger;
    this.knowledge = knowledge;
  }

  protected log(action: string, content: string, metadata?: Record<string, unknown>): void {
    this.logger.log(this.role, action, content, metadata);
  }

  protected async askLLM(systemPrompt: string, userMessage: string): Promise<string> {
    const knowledge = this.getRelevantKnowledge(userMessage);
    const enhancedPrompt = knowledge
      ? `${systemPrompt}\n\n## 相关知识库\n${knowledge}`
      : systemPrompt;

    this.log('llm_call', `调用LLM，用户消息: ${userMessage.slice(0, 100)}...`);
    const response = await chat(this.config, {
      systemPrompt: enhancedPrompt,
      userMessage,
    });
    this.log('llm_response', `LLM响应: ${response.slice(0, 100)}...`);
    this.extractKnowledge(response);
    return response;
  }

  protected getRelevantKnowledge(query: string): string {
    const entries = this.knowledge.getEntries(this.role);
    if (entries.length === 0) return '';

    const queryTokens = new Set(
      query
        .toLowerCase()
        .split(/[\s，。、；：""''（）()\[\]{}]+/)
        .filter((t) => t.length >= 2)
    );

    const relevant = entries
      .filter((e) => {
        if (query.includes(e.category)) return true;
        const contentTokens = e.content.toLowerCase().split(/[\s，。、]+/);
        return contentTokens.some((t) => t.length >= 2 && queryTokens.has(t));
      })
      .slice(0, 3);

    if (relevant.length === 0) return '';

    return relevant.map((e) => `- [${e.category}] ${e.content}`).join('\n');
  }

  protected extractKnowledge(content: string): void {
    const patterns = [
      /发现[:：](.+)/g,
      /学到[:：](.+)/g,
      /注意[:：](.+)/g,
      /经验[:：](.+)/g,
      /新知识[:：](.+)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        this.knowledge.addEntry(this.role, 'extracted', match[1].trim(), 'auto_extract');
      }
    }
  }

  abstract getSystemPrompt(): string;
  abstract processMessage(message: AgentMessage): Promise<AgentMessage[]>;

  createMessage(to: RoleKey, type: MessageType, content: string, metadata?: Record<string, unknown>): AgentMessage {
    return {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from: this.role,
      to,
      type,
      content,
      timestamp: new Date(),
      metadata,
    };
  }
}
