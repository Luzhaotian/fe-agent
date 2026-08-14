import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType } from '../types';
import { Logger, KnowledgeBase } from '../utils/file';

export class ProductAgent extends BaseAgent {
  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.PRODUCT, config, logger, knowledge);
  }

  getSystemPrompt(): string {
    return `你是产品角色，负责整理与拓展需求，完成后交项目经理送审，并按审查反馈整改。

若需求过少请合理拓展并列出待确认问题。
若输入含网址：你无法真正抓取网页；请基于 URL 文本推断，并在「待确认问题」中请用户粘贴页面正文。

需求整理格式：
## 需求概述
## 功能列表（描述 + 验收标准）
## 后端能力 / API 相关功能点（纯前端请明确说明）
## 数据实体（如有）
## 交互说明
## 边界条件
## 待确认问题

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
      userMessage = `用户提供了一个网址：${urlMatch[0]}\n你无法抓取该网页。请基于 URL 文本尽量整理需求，并在「待确认问题」中请用户粘贴页面正文或补充说明。`;
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
