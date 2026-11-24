import { ProjectConfig, RoleKey, AgentMessage, MessageType } from '../types';
import { chatDetailed } from '../core/llm';
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

  protected async askLLM(
    systemPrompt: string,
    userMessage: string,
    options?: { maxTokens?: number; skipKnowledge?: boolean }
  ): Promise<string> {
    const knowledge = options?.skipKnowledge ? '' : this.getRelevantKnowledge(userMessage);
    const enhancedPrompt = knowledge
      ? `${systemPrompt}\n\n## 相关知识库\n${knowledge}`
      : systemPrompt;

    this.log('llm_call', `调用LLM，用户消息: ${userMessage.slice(0, 100)}...`);
    const result = await chatDetailed(this.config, {
      systemPrompt: enhancedPrompt,
      userMessage,
      maxTokens: options?.maxTokens,
    });

    if (result.truncated) {
      this.log('llm_truncated', '响应因 max_tokens 被截断，将追加续写提示标记');
    }

    let content = result.content;
    if (result.truncated) {
      content += '\n\n[OUTPUT_TRUNCATED] 输出可能不完整，请在后续整改中补全被截断的文件。';
    }

    if (result.usage?.totalTokens) {
      this.log('llm_usage', `tokens=${result.usage.totalTokens}`, result.usage as Record<string, unknown>);
    }

    this.log('llm_response', `LLM响应: ${content.slice(0, 100)}...`);
    this.extractKnowledge(content);
    return content;
  }

  protected codeMaxTokens(): number {
    return this.config.llm.codeMaxTokens ?? Math.max(this.config.llm.maxTokens, 8192);
  }

  protected getRelevantKnowledge(query: string): string {
    const entries = this.knowledge.searchEntries(this.role, query, 3);
    if (entries.length === 0) return '';
    return entries.map((e) => `- [${e.category}] ${e.content}`).join('\n');
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
        const text = match[1].trim().slice(0, 500);
        if (text.length >= 4) {
          this.knowledge.addEntry(this.role, 'extracted', text, 'auto_extract');
        }
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
