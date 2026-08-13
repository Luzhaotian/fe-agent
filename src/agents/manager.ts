import { BaseAgent } from './base';
import {
  ProjectConfig,
  Role,
  AgentMessage,
  MessageType,
  IssueLevel,
  ReviewFeedback,
  ReviewType,
  WorkScope,
} from '../types';
import { Logger, KnowledgeBase, Artifacts } from '../utils/file';

/**
 * 项目经理：统筹分发。维护关卡状态，保证：
 * 需求审过 → 架构评估+接口文档 → 轻量审文档 → 后端(+用例) → 前端(+用例)
 */
export class ManagerAgent extends BaseAgent {
  private artifacts: Artifacts;
  private requirementContent = '';
  private apiDocContent = '';
  private skipBackend = false;

  private backendCodeApproved = false;
  private backendTestApproved = false;
  private frontendCodeApproved = false;
  private frontendTestApproved = false;

  private resumeAfterArchitectSys: AgentMessage | null = null;

  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.MANAGER, config, logger, knowledge);
    this.artifacts = new Artifacts(config.project.path);
  }

  getSystemPrompt(): string {
    return `你是一个项目经理（统筹员）角色，你的职责是：

1. 接收需求并分发给产品角色
2. 需求审查通过后分发给系统架构角色做评估并产出接口文档
3. 接口文档轻量审查通过后：先分发后端架构与测试员（后端用例）；后端通过后再分发前端架构与测试员（前端用例）
4. 收集提问并分级：低级自己处理，中级查知识库，高级交用户
5. 若消息标记需要系统架构介入非业务改动，分发给架构角色

输出可用标记：
- [QUESTION:level] level 为 low/medium/high
- [DISPATCH:role] role 为 product/architect_sys/backend/architect/tester/reviewer
- [REVIEW:type] type 为 requirement/api_doc/code/test
- [CONCLUSION]

请用中文回复。`;
  }

  async processMessage(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('receive_message', `收到来自 ${message.from} 的消息: ${message.type}`);

    if (message.metadata?.needsArchitectSys && message.from !== Role.ARCHITECT_SYS) {
      return this.routeToArchitectSys(message);
    }

    switch (message.type) {
      case MessageType.TASK:
        return this.handleNewRequirement(message);
      case MessageType.RESULT:
        return this.handleResult(message);
      case MessageType.REVIEW_FEEDBACK:
        return this.handleReviewFeedback(message);
      case MessageType.QUESTION:
        return this.handleQuestion(message);
      default:
        return [];
    }
  }

  private async handleNewRequirement(message: AgentMessage): Promise<AgentMessage[]> {
    // 用户回答后的继续任务：可能仍指向经理自己
    if (message.metadata?.resumeAfterUser) {
      return this.handleResult(message);
    }

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `用户提出了新需求：\n${message.content}\n\n请分析此需求，决定下一步操作。如果需求不清晰，列出需要向用户确认的问题。`
    );

    this.requirementContent = message.content;
    this.resetGates();
    this.log('dispatch', '将需求分发给产品角色进行整理');

    return [
      this.createMessage(Role.PRODUCT, MessageType.TASK, `请整理以下需求：\n${message.content}\n\n项目经理分析：${response}`, {
        originalRequirement: message.content,
        managerAnalysis: response,
      }),
    ];
  }

  private resetGates(): void {
    this.skipBackend = false;
    this.backendCodeApproved = false;
    this.backendTestApproved = false;
    this.frontendCodeApproved = false;
    this.frontendTestApproved = false;
    this.apiDocContent = '';
    this.resumeAfterArchitectSys = null;
  }

  private async handleResult(message: AgentMessage): Promise<AgentMessage[]> {
    if (message.metadata?.needsArchitectSys && message.from !== Role.ARCHITECT_SYS) {
      return this.routeToArchitectSys(message);
    }

    if (message.from === Role.PRODUCT) {
      this.requirementContent = message.content;
      this.log('dispatch', '将产品需求发给审查员审查');
      return [
        this.createMessage(Role.REVIEWER, MessageType.TASK, `请审查以下产品需求：\n${message.content}`, {
          reviewType: 'requirement' satisfies ReviewType,
        }),
      ];
    }

    if (message.from === Role.ARCHITECT_SYS) {
      if (message.metadata?.infraOnly && this.resumeAfterArchitectSys) {
        const resume = this.resumeAfterArchitectSys;
        this.resumeAfterArchitectSys = null;
        this.log('dispatch', '基建处理完成，恢复原流程');
        return this.handleResult(resume);
      }

      this.apiDocContent = (message.metadata?.apiDoc as string) || this.artifacts.readApiDoc() || message.content;
      this.skipBackend = Boolean(message.metadata?.skipBackend);
      this.log('dispatch', '将接口文档发给审查员轻量审查');
      return [
        this.createMessage(
          Role.REVIEWER,
          MessageType.TASK,
          `请轻量审查以下接口文档（只关注路径、入参、出参、错误码）：\n${this.apiDocContent}`,
          { reviewType: 'api_doc' satisfies ReviewType }
        ),
      ];
    }

    if (message.from === Role.BACKEND) {
      this.log('dispatch', '将后端代码发给审查员审查');
      return [
        this.createMessage(Role.REVIEWER, MessageType.TASK, `请审查以下后端代码：\n${message.content}`, {
          reviewType: 'code' satisfies ReviewType,
          scope: 'backend' satisfies WorkScope,
        }),
      ];
    }

    if (message.from === Role.ARCHITECT) {
      this.log('dispatch', '将前端代码发给审查员审查');
      return [
        this.createMessage(Role.REVIEWER, MessageType.TASK, `请审查以下前端代码：\n${message.content}`, {
          reviewType: 'code' satisfies ReviewType,
          scope: 'frontend' satisfies WorkScope,
        }),
      ];
    }

    if (message.from === Role.TESTER) {
      const scope = (message.metadata?.scope as WorkScope) || 'frontend';
      this.log('dispatch', `将${scope === 'backend' ? '后端' : '前端'}测试用例发给审查员审查`);
      return [
        this.createMessage(Role.REVIEWER, MessageType.TASK, `请审查以下测试用例：\n${message.content}`, {
          reviewType: 'test' satisfies ReviewType,
          scope,
        }),
      ];
    }

    return [];
  }

  private isReviewPassed(message: AgentMessage, feedbacks: ReviewFeedback[]): boolean {
    const highest = (message.metadata?.highestLevel as IssueLevel) || IssueLevel.LOW;
    if (highest === IssueLevel.HIGH || highest === IssueLevel.MEDIUM) return false;
    // 仅低级：若明确是“通过”或无真实问题描述，视为通过
    const text = message.content;
    if (/审查通过|无严重问题|可以继续|无问题/.test(text)) return true;
    if (feedbacks.length === 1 && feedbacks[0].content.includes('审查通过')) return true;
    // 有低级优化建议也允许继续，避免卡住流水线
    return highest === IssueLevel.LOW;
  }

  private async handleReviewFeedback(message: AgentMessage): Promise<AgentMessage[]> {
    const feedbacks = (message.metadata?.feedbacks as ReviewFeedback[]) || [];
    const highest = (message.metadata?.highestLevel as IssueLevel) || IssueLevel.LOW;
    const reviewType = (message.metadata?.reviewType as ReviewType) || 'code';
    const scope = message.metadata?.scope as WorkScope | undefined;

    this.log('review_feedback', `收到审查反馈，类型=${reviewType} scope=${scope || '-'} 等级=${highest}`);

    if (this.isReviewPassed(message, feedbacks)) {
      return this.advanceAfterApprovedReview(reviewType, scope);
    }

    if (highest === IssueLevel.HIGH) {
      const response = await this.askLLM(
        this.getSystemPrompt(),
        `收到高级审查反馈：\n${message.content}\n\n请给出给用户的决策建议。`
      );
      return [
        this.createMessage(Role.MANAGER, MessageType.QUESTION, `需要用户决定的审查反馈：\n${message.content}\n\n项目经理建议：${response}`, {
          level: IssueLevel.HIGH,
          needsUserDecision: true,
          reviewType,
          scope,
        }),
      ];
    }

    // 中/低但未通过：分发整改
    const targetRole = this.resolveFixTarget(reviewType, scope, feedbacks);
    if (highest === IssueLevel.MEDIUM) {
      const pastKnowledge = this.knowledge.searchEntries(this.role, message.content.slice(0, 50));
      if (pastKnowledge.length === 0) {
        return [
          this.createMessage(Role.MANAGER, MessageType.QUESTION, `中级审查反馈，无历史记录，需要确认：\n${message.content}`, {
            level: IssueLevel.MEDIUM,
            needsUserDecision: true,
            reviewType,
            scope,
          }),
        ];
      }
      this.log('knowledge_lookup', '从知识库中找到相关历史记录');
      return [
        this.createMessage(
          targetRole,
          MessageType.REVIEW_FEEDBACK,
          `请根据审查反馈整改：\n${message.content}\n\n参考历史处理：${pastKnowledge.map((k) => k.content).join('\n')}`,
          { feedbacks, reviewType, scope, apiDoc: this.apiDocContent }
        ),
      ];
    }

    return [
      this.createMessage(targetRole, MessageType.REVIEW_FEEDBACK, `请根据审查反馈整改：\n${message.content}`, {
        feedbacks,
        reviewType,
        scope,
        apiDoc: this.apiDocContent,
      }),
    ];
  }

  private resolveFixTarget(reviewType: ReviewType, scope: WorkScope | undefined, feedbacks: ReviewFeedback[]): Role {
    if (feedbacks[0]?.targetRole && Object.values(Role).includes(feedbacks[0].targetRole)) {
      return feedbacks[0].targetRole;
    }
    switch (reviewType) {
      case 'requirement':
        return Role.PRODUCT;
      case 'api_doc':
        return Role.ARCHITECT_SYS;
      case 'test':
        return Role.TESTER;
      case 'code':
        return scope === 'backend' ? Role.BACKEND : Role.ARCHITECT;
      default:
        return Role.ARCHITECT;
    }
  }

  private advanceAfterApprovedReview(reviewType: ReviewType, scope?: WorkScope): AgentMessage[] {
    if (reviewType === 'requirement') {
      this.log('dispatch', '需求审查通过，分发给系统架构评估并产出接口文档');
      return [
        this.createMessage(
          Role.ARCHITECT_SYS,
          MessageType.TASK,
          `需求已审查通过，请评估是否需要基建改动，并产出接口文档。\n\n## 需求\n${this.requirementContent}`
        ),
      ];
    }

    if (reviewType === 'api_doc') {
      this.apiDocContent = this.artifacts.readApiDoc() || this.apiDocContent;
      if (this.skipBackend) {
        this.log('dispatch', '接口文档确认无需后端，跳过后端阶段，进入前端');
        return this.dispatchFrontend();
      }
      this.log('dispatch', '接口文档审查通过，分发后端开发与后端测试');
      return this.dispatchBackend();
    }

    if (reviewType === 'code' && scope === 'backend') {
      this.backendCodeApproved = true;
      return this.maybeDispatchFrontend();
    }

    if (reviewType === 'test' && scope === 'backend') {
      this.backendTestApproved = true;
      return this.maybeDispatchFrontend();
    }

    if (reviewType === 'code' && scope === 'frontend') {
      this.frontendCodeApproved = true;
      return this.maybeComplete();
    }

    if (reviewType === 'test' && scope === 'frontend') {
      this.frontendTestApproved = true;
      return this.maybeComplete();
    }

    // 兼容未带 scope 的旧审查：按前端处理
    if (reviewType === 'code') {
      this.frontendCodeApproved = true;
      return this.maybeComplete();
    }
    if (reviewType === 'test') {
      this.frontendTestApproved = true;
      return this.maybeComplete();
    }

    return [];
  }

  private dispatchBackend(): AgentMessage[] {
    const apiDoc = this.apiDocContent || this.artifacts.readApiDoc() || '';
    return [
      this.createMessage(
        Role.BACKEND,
        MessageType.TASK,
        `请根据以下需求与接口文档开发后端代码：\n\n## 需求\n${this.requirementContent}\n\n## 接口文档\n${apiDoc}`,
        { apiDoc, scope: 'backend' satisfies WorkScope }
      ),
      this.createMessage(
        Role.TESTER,
        MessageType.TASK,
        `请根据以下需求与接口文档编写后端测试用例：\n\n## 需求\n${this.requirementContent}\n\n## 接口文档\n${apiDoc}`,
        { apiDoc, scope: 'backend' satisfies WorkScope }
      ),
    ];
  }

  private maybeDispatchFrontend(): AgentMessage[] {
    if (!this.backendCodeApproved || !this.backendTestApproved) {
      this.log('gate', `等待后端关卡：code=${this.backendCodeApproved} test=${this.backendTestApproved}`);
      return [];
    }
    this.log('dispatch', '后端关卡通过，分发前端开发与前端测试');
    return this.dispatchFrontend();
  }

  private dispatchFrontend(): AgentMessage[] {
    const apiDoc = this.apiDocContent || this.artifacts.readApiDoc() || '';
    return [
      this.createMessage(
        Role.ARCHITECT,
        MessageType.TASK,
        `请根据以下需求与接口文档开发前端代码：\n\n## 需求\n${this.requirementContent}\n\n## 接口文档\n${apiDoc}`,
        { apiDoc, scope: 'frontend' satisfies WorkScope }
      ),
      this.createMessage(
        Role.TESTER,
        MessageType.TASK,
        `请根据以下需求与接口文档编写前端测试用例：\n\n## 需求\n${this.requirementContent}\n\n## 接口文档\n${apiDoc}`,
        { apiDoc, scope: 'frontend' satisfies WorkScope }
      ),
    ];
  }

  private maybeComplete(): AgentMessage[] {
    if (!this.frontendCodeApproved || !this.frontendTestApproved) {
      this.log('gate', `等待前端关卡：code=${this.frontendCodeApproved} test=${this.frontendTestApproved}`);
      return [];
    }
    this.log('complete', '前后端与测试均已通过，交付完成');
    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, '全部审查通过，任务交付完成。', {
        workflowComplete: true,
      }),
    ];
  }

  private routeToArchitectSys(message: AgentMessage): AgentMessage[] {
    this.resumeAfterArchitectSys = {
      ...message,
      metadata: { ...message.metadata, needsArchitectSys: false },
    };
    this.log('dispatch', '发现非业务改动需求，分发给系统架构');
    return [
      this.createMessage(
        Role.ARCHITECT_SYS,
        MessageType.TASK,
        `请处理以下非业务/基建相关改动：\n${message.content}`,
        { infraOnly: true }
      ),
    ];
  }

  private async handleQuestion(message: AgentMessage): Promise<AgentMessage[]> {
    const level = (message.metadata?.level as IssueLevel) || IssueLevel.LOW;

    if (level === IssueLevel.HIGH) {
      return [
        this.createMessage(Role.MANAGER, MessageType.QUESTION, message.content, {
          level: IssueLevel.HIGH,
          needsUserDecision: true,
        }),
      ];
    }

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `角色 ${message.from} 提出问题：\n${message.content}\n\n问题等级: ${level}\n请给出处理建议。`
    );

    this.knowledge.addEntry(this.role, 'question_handling', response, message.content);

    return [this.createMessage(message.from, MessageType.RESULT, response, { questionResolved: true })];
  }
}
