import { BaseAgent } from './base';
import { ProjectConfig, RoleDefinition, AgentMessage, MessageType, Role } from '../types';
import { Logger, KnowledgeBase } from '../utils/file';
import { enrichResultMetadata } from '../utils/capability-gap';

/** 由 .fe-agent/roles/*.json 定义的通用执行角色。 */
export class DynamicRoleAgent extends BaseAgent {
  private definition: RoleDefinition;

  constructor(
    definition: RoleDefinition,
    config: ProjectConfig,
    logger: Logger,
    knowledge: KnowledgeBase
  ) {
    super(definition.name, config, logger, knowledge);
    this.definition = definition;
  }

  getDefinition(): RoleDefinition {
    return this.definition;
  }

  getSystemPrompt(): string {
    return `${this.definition.systemPrompt}

若发现需要非业务/基建改动，标注 [NEEDS_ARCHITECT_SYS]。
若发现需要其他现有角色无法提供的能力，标注：
[NEEDS_NEW_ROLE]
capability: <所需能力>
reason: <原因>
tags: <标签，逗号分隔>
sensitive: yes/no

请用中文回复。`;
  }

  async processMessage(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('receive_message', `收到来自 ${message.from} 的消息: ${message.type}`);

    switch (message.type) {
      case MessageType.TASK:
      case MessageType.REVIEW_FEEDBACK:
        return this.handleTask(message);
      default:
        return [];
    }
  }

  private async handleTask(message: AgentMessage): Promise<AgentMessage[]> {
    const isRevision = message.type === MessageType.REVIEW_FEEDBACK;
    this.log(isRevision ? 'revise' : 'execute', `${this.definition.displayName} 开始处理`);

    const prompt = isRevision
      ? `请根据审查反馈整改：\n\n${message.content}`
      : `请处理以下任务：\n\n${message.content}`;

    const response = await this.askLLM(this.getSystemPrompt(), prompt);

    this.log('complete', `${this.definition.displayName} 处理完成`);

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, enrichResultMetadata(response, {
        customRole: this.definition.name,
        customRoleDisplayName: this.definition.displayName,
      })),
    ];
  }
}
