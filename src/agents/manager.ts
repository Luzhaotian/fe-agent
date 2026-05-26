import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType, IssueLevel, ReviewFeedback } from '../types';
import { Logger, KnowledgeBase } from '../utils/file';

export class ManagerAgent extends BaseAgent {
  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.MANAGER, config, logger, knowledge);
  }

  getSystemPrompt(): string {
    return `你是一个项目经理（统筹员）角色，你的职责是：

1. 接收需求并分发给产品角色，协助产品整理需求和问题，决定是否需要向用户确认
2. 把产品需求、前端代码、测试用例发给审查员进行审查
3. 产品整理好的需求无误之后，分发给前端架构（主要代码开发者）、测试员（主要功能测试）
4. 收集各个角色的提问，进行等级排序：
   - 低级问题：交给你处理
   - 中级问题：查询过往处理过的经历酌情处理
   - 高级问题：全部交由用户决定
5. 把审查结果整理，低级问题直接分发给相关角色处理，中级问题查询过往经历，高级问题交由用户决定

你的输出格式要求：
- 当需要向用户提问时，使用 [QUESTION:level] 格式，level 为 low/medium/high
- 当需要分发给角色时，使用 [DISPATCH:role] 格式
- 当需要审查时，使用 [REVIEW:type] 格式，type 为 requirement/code/test
- 总结和结论使用 [CONCLUSION] 格式

请用中文回复。`;
  }

  async processMessage(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('receive_message', `收到来自 ${message.from} 的消息: ${message.type}`);

    const results: AgentMessage[] = [];

    switch (message.type) {
      case MessageType.TASK:
        // 新需求，分发给产品
        results.push(...(await this.handleNewRequirement(message)));
        break;

      case MessageType.RESULT:
        // 处理各角色的结果
        results.push(...(await this.handleResult(message)));
        break;

      case MessageType.REVIEW_FEEDBACK:
        // 处理审查反馈
        results.push(...(await this.handleReviewFeedback(message)));
        break;

      case MessageType.QUESTION:
        // 处理问题
        results.push(...(await this.handleQuestion(message)));
        break;

      default:
        break;
    }

    return results;
  }

  private async handleNewRequirement(message: AgentMessage): Promise<AgentMessage[]> {
    const response = await this.askLLM(
      this.getSystemPrompt(),
      `用户提出了新需求：\n${message.content}\n\n请分析此需求，决定下一步操作。如果需求不清晰，列出需要向用户确认的问题。`
    );

    this.log('dispatch', '将需求分发给产品角色进行整理');

    return [
      this.createMessage(Role.PRODUCT, MessageType.TASK, `请整理以下需求：\n${message.content}\n\n项目经理分析：${response}`, {
        originalRequirement: message.content,
        managerAnalysis: response,
      }),
    ];
  }

  private async handleResult(message: AgentMessage): Promise<AgentMessage[]> {
    const results: AgentMessage[] = [];

    if (message.from === Role.PRODUCT) {
      // 产品整理好需求，发给审查员审查
      this.log('dispatch', '将产品需求发给审查员审查');
      results.push(
        this.createMessage(
          Role.REVIEWER,
          MessageType.TASK,
          `请审查以下产品需求：\n${message.content}`,
          { reviewType: 'requirement' }
        )
      );
    } else if (message.from === Role.ARCHITECT) {
      // 前端架构开发完成，发给审查员审查
      this.log('dispatch', '将代码发给审查员审查');
      results.push(
        this.createMessage(
          Role.REVIEWER,
          MessageType.TASK,
          `请审查以下前端代码：\n${message.content}`,
          { reviewType: 'code' }
        )
      );
    } else if (message.from === Role.TESTER) {
      // 测试用例写好，发给审查员审查
      this.log('dispatch', '将测试用例发给审查员审查');
      results.push(
        this.createMessage(
          Role.REVIEWER,
          MessageType.TASK,
          `请审查以下测试用例：\n${message.content}`,
          { reviewType: 'test' }
        )
      );
    }

    return results;
  }

  private async handleReviewFeedback(message: AgentMessage): Promise<AgentMessage[]> {
    const feedback = message.metadata?.feedback as ReviewFeedback | undefined;
    const level = feedback?.level || IssueLevel.LOW;

    this.log('review_feedback', `收到审查反馈，等级: ${level}`, { feedback });

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `收到审查反馈：\n${message.content}\n\n反馈等级: ${level}\n\n请决定如何处理此反馈。`
    );

    const results: AgentMessage[] = [];

    if (level === IssueLevel.HIGH) {
      // 高级问题，交由用户决定
      results.push(
        this.createMessage(
          Role.MANAGER,
          MessageType.QUESTION,
          `需要用户决定的审查反馈：\n${message.content}\n\n项目经理建议：${response}`,
          { level: IssueLevel.HIGH, needsUserDecision: true }
        )
      );
    } else if (level === IssueLevel.MEDIUM) {
      // 中级问题，查询过往经历
      const pastKnowledge = this.knowledge.searchEntries(this.role, message.content.slice(0, 50));
      if (pastKnowledge.length > 0) {
        this.log('knowledge_lookup', '从知识库中找到相关历史记录');
        const targetRole = feedback?.targetRole || Role.ARCHITECT;
        results.push(
          this.createMessage(
            targetRole,
            MessageType.TASK,
            `请根据审查反馈整改：\n${message.content}\n\n参考历史处理：${pastKnowledge.map((k) => k.content).join('\n')}`,
            { feedback }
          )
        );
      } else {
        results.push(
          this.createMessage(
            Role.MANAGER,
            MessageType.QUESTION,
            `中级审查反馈，无历史记录，需要确认：\n${message.content}`,
            { level: IssueLevel.MEDIUM }
          )
        );
      }
    } else {
      // 低级问题，直接分发给相关角色处理
      const targetRole = feedback?.targetRole || Role.ARCHITECT;
      results.push(
        this.createMessage(
          targetRole,
          MessageType.TASK,
          `请根据审查反馈整改：\n${message.content}\n\n项目经理指示：${response}`,
          { feedback }
        )
      );
    }

    return results;
  }

  private async handleQuestion(message: AgentMessage): Promise<AgentMessage[]> {
    const level = (message.metadata?.level as IssueLevel) || IssueLevel.LOW;

    if (level === IssueLevel.HIGH) {
      // 高级问题交给用户
      return [
        this.createMessage(
          Role.MANAGER,
          MessageType.QUESTION,
          message.content,
          { level: IssueLevel.HIGH, needsUserDecision: true }
        ),
      ];
    }

    // 低级/中级问题自己处理
    const response = await this.askLLM(
      this.getSystemPrompt(),
      `角色 ${message.from} 提出问题：\n${message.content}\n\n问题等级: ${level}\n请给出处理建议。`
    );

    this.knowledge.addEntry(this.role, 'question_handling', response, message.content);

    return [
      this.createMessage(message.from, MessageType.RESULT, response, { questionResolved: true }),
    ];
  }

  // 分发需求给开发和测试
  async dispatchToDevAndTest(requirementContent: string): Promise<AgentMessage[]> {
    this.log('dispatch', '将审核通过的需求分发给前端架构和测试员');

    return [
      this.createMessage(
        Role.ARCHITECT,
        MessageType.TASK,
        `请根据以下需求开发前端代码：\n${requirementContent}`
      ),
      this.createMessage(
        Role.TESTER,
        MessageType.TASK,
        `请根据以下需求编写测试用例：\n${requirementContent}`
      ),
    ];
  }
}
