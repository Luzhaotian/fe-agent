import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType } from '../types';
import { Logger, KnowledgeBase } from '../utils/file';

export class ProductAgent extends BaseAgent {
  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.PRODUCT, config, logger, knowledge);
  }

  getSystemPrompt(): string {
    return `你是一个产品角色，你的职责是：

1. 编写需求，并整理需求，把需求发给项目经理
2. 如果给的需求很少，你需要拓展，可以向上直接提问相关问题并整理
3. 如果给的是网址，可以直接访问地址把网址上的需求整理，如遇到需要登录，等待5-10秒后再次访问，如果还是没有登录成功，停止并通知用户登录，成功后继续整理
4. 把整理好的需求交给项目经理，由项目经理分发给审查员进行审查，根据审查员的反馈进行整改

需求整理格式：
## 需求概述
[简要描述需求]

## 功能列表
1. [功能1]
   - 描述：[详细描述]
   - 验收标准：[如何验证]
2. [功能2]
   ...

## 交互说明
[描述页面交互流程]

## 边界条件
[需要考虑的边界情况]

## 待确认问题
[需要向用户确认的问题]

请用中文回复。`;
  }

  async processMessage(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('receive_message', `收到来自 ${message.from} 的消息: ${message.type}`);

    switch (message.type) {
      case MessageType.TASK:
        return this.handleOrganizeRequirement(message);
      case MessageType.REVIEW_FEEDBACK:
        return this.handleReviewFeedback(message);
      default:
        return [];
    }
  }

  private async handleOrganizeRequirement(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('organize_requirement', '开始整理需求');

    const content = message.content;

    // 检测是否为网址
    const urlPattern = /https?:\/\/[^\s]+/;
    const urlMatch = content.match(urlPattern);

    let userMessage = content;
    if (urlMatch) {
      userMessage = `用户提供了一个网址：${urlMatch[0]}\n请基于此网址整理需求。注意：如果你无法访问此网址，请告知项目经理需要用户协助。`;
    }

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `请整理以下需求，如果需求描述不够详细，请拓展并标注待确认问题：\n\n${userMessage}`
    );

    this.log('requirement_organized', '需求整理完成');

    // 检查是否有待确认问题
    const hasQuestions = response.includes('待确认问题') || response.includes('？') || response.includes('?');

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, {
        hasQuestions,
        requirementType: urlMatch ? 'url' : 'text',
        url: urlMatch?.[0],
      }),
    ];
  }

  private async handleReviewFeedback(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('handle_review', '处理审查反馈，整改需求');

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `审查员对需求提出了以下反馈，请据此整改需求：\n\n${message.content}\n\n请输出整改后的完整需求文档。`
    );

    this.log('requirement_revised', '需求整改完成');

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, {
        revised: true,
      }),
    ];
  }
}
