import { BaseAgent } from './base';
import {
  ProjectConfig,
  Role,
  RoleDefinition,
  CapabilityGap,
  AgentMessage,
  MessageType,
  IssueLevel,
  ReviewFeedback,
  ReviewType,
  WorkScope,
  TaskComplexity,
} from '../types';
import { Logger, KnowledgeBase, Artifacts } from '../utils/file';
import { resolveRevisionTargets } from '../utils/review-target';
import { RoleRegistry } from '../utils/role-registry';
import { createRoleDefinition } from '../utils/role-creator';
import { buildScopedTaskContent } from '../utils/message-content';
import { classifyTaskComplexity } from '../utils/task-complexity';

export interface ManagerDeps {
  roleRegistry: RoleRegistry;
  onRoleCreated: (def: RoleDefinition) => void;
}

type SideBuffer = { code?: string; test?: string };

/**
 * 项目经理：统筹分发。
 * simple：产品 → 前端(+用例并行) → 合并审查
 * standard：完整关卡 + 并行侧工作 + 合并审查
 * full：完整关卡 + 并行侧工作 + 分审代码/用例
 */
export class ManagerAgent extends BaseAgent {
  private artifacts: Artifacts;
  private deps: ManagerDeps;
  private requirementContent = '';
  private apiDocContent = '';
  private skipBackend = false;
  private complexity: TaskComplexity = 'standard';
  private mergeReviews = true;

  private backendCodeApproved = false;
  private backendTestApproved = false;
  private frontendCodeApproved = false;
  private frontendTestApproved = false;

  private sideBuffers: Record<'backend' | 'frontend', SideBuffer> = {
    backend: {},
    frontend: {},
  };

  private resumeAfterArchitectSys: AgentMessage | null = null;
  private pendingContinuation: (() => Promise<AgentMessage[]>) | null = null;

  constructor(
    config: ProjectConfig,
    logger: Logger,
    knowledge: KnowledgeBase,
    deps: ManagerDeps
  ) {
    super(Role.MANAGER, config, logger, knowledge);
    this.artifacts = new Artifacts(config.project.path);
    this.deps = deps;
  }

  getSystemPrompt(): string {
    return `你是项目经理，负责统筹分发与问题分级：

1. 按任务复杂度选择快路径/标准/完整关卡
2. 同侧开发与测试可并行；标准路径合并代码与用例审查
3. 低级问题自行处理，中级查知识库，高级交用户决策
4. 非业务/基建改动转交架构角色
5. 现有角色无法处理时，自动匹配或创建自定义角色

实际分发由程序按关卡执行；你的回复用于分析与建议用户决策。

请用中文回复。`;
  }

  getComplexity(): TaskComplexity {
    return this.complexity;
  }

  async processMessage(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('receive_message', `收到来自 ${message.from} 的消息: ${message.type}`);

    const gap = message.metadata?.needsNewRole as CapabilityGap | undefined;
    if (gap && message.from !== Role.MANAGER) {
      return this.handleCapabilityGap(message, gap);
    }

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
    if (message.metadata?.resumeAfterUser) {
      return this.handleResult(message);
    }

    this.requirementContent = message.content;
    this.artifacts.saveRequirement(message.content);
    this.resetGates();

    const classified = classifyTaskComplexity(
      message.content,
      this.config.workflow?.taskComplexity
    );
    this.complexity = classified.complexity;
    this.mergeReviews =
      this.complexity === 'full'
        ? false
        : this.config.workflow?.mergeCodeTestReview !== false;
    if (classified.skipBackendHint) this.skipBackend = true;

    this.log(
      'complexity',
      `任务分级=${this.complexity}；${classified.reason}；mergeReview=${this.mergeReviews}`
    );

    const skipAnalysis = this.config.workflow?.skipManagerAnalysis !== false;
    let managerAnalysis = '';

    if (!skipAnalysis) {
      managerAnalysis = await this.askLLM(
        this.getSystemPrompt(),
        `用户提出了新需求：\n${message.content}\n\n请分析此需求。如果需求不清晰，列出需要向用户确认的问题。`
      );
    }

    this.log('dispatch', '将需求分发给产品角色进行整理');

    const taskContent = managerAnalysis
      ? `请整理以下需求：\n${message.content}\n\n项目经理分析：${managerAnalysis}`
      : `请整理以下需求：\n${message.content}`;

    return [
      this.createMessage(Role.PRODUCT, MessageType.TASK, taskContent, {
        originalRequirement: message.content,
        managerAnalysis: managerAnalysis || undefined,
        complexity: this.complexity,
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
    this.pendingContinuation = null;
    this.sideBuffers = { backend: {}, frontend: {} };
    this.complexity = 'standard';
    this.mergeReviews = this.config.workflow?.mergeCodeTestReview !== false;
  }

  private isCustomRole(role: string): boolean {
    return role.startsWith('custom:');
  }

  private async handleCapabilityGap(message: AgentMessage, gap: CapabilityGap): Promise<AgentMessage[]> {
    this.log('capability_gap', `检测到能力缺口: ${gap.capability}`);

    if (!this.pendingContinuation) {
      this.pendingContinuation = async () => this.handleResult(message);
    }

    const matched = this.deps.roleRegistry.matchRole(
      `${gap.capability}\n${gap.reason}\n${message.content}`,
      gap
    );

    if (matched) {
      this.log('role_match', `匹配到已有自定义角色: ${matched.displayName}`);
      return this.dispatchToCustomRole(matched, gap, message.content);
    }

    if (gap.sensitive) {
      return [
        this.createMessage(
          Role.MANAGER,
          MessageType.QUESTION,
          `需要创建新角色「${gap.capability}」来处理：\n${gap.reason}\n\n该能力涉及敏感操作，是否允许自动创建并执行？`,
          { level: IssueLevel.HIGH, needsUserDecision: true, pendingGap: gap, gapContext: message.content }
        ),
      ];
    }

    return this.createAndDispatchRole(gap, message.content);
  }

  private async createAndDispatchRole(gap: CapabilityGap, context: string): Promise<AgentMessage[]> {
    const existingNames = this.deps.roleRegistry.listRoles().map((r) => r.name);
    const def = await createRoleDefinition(this.config, gap, existingNames);
    this.deps.roleRegistry.saveRole(def);
    this.deps.onRoleCreated(def);
    this.log('role_created', `自动创建自定义角色: ${def.displayName} (${def.name})`);
    return this.dispatchToCustomRole(def, gap, context);
  }

  private dispatchToCustomRole(def: RoleDefinition, gap: CapabilityGap, context: string): AgentMessage[] {
    const excerpt = context.length > 2000 ? `${context.slice(0, 2000)}\n...(已截断)` : context;
    return [
      this.createMessage(
        def.name,
        MessageType.TASK,
        `## 能力缺口\n${gap.capability}\n\n## 原因\n${gap.reason}\n\n## 上下文\n${excerpt}`,
        { customRole: def.name, capabilityGap: gap }
      ),
    ];
  }

  private async handleResult(message: AgentMessage): Promise<AgentMessage[]> {
    if (this.isCustomRole(String(message.from))) {
      this.log('custom_role_done', `自定义角色 ${message.from} 完成`);
      if (this.pendingContinuation) {
        const cont = this.pendingContinuation;
        this.pendingContinuation = null;
        return await cont();
      }
      return [];
    }

    if (message.from === Role.PRODUCT) {
      this.requirementContent = message.content;
      this.artifacts.saveRequirement(message.content);

      if (this.complexity === 'simple') {
        this.log('dispatch', '快路径：跳过需求审查与架构，直接进入前端');
        this.skipBackend = true;
        const minimalDoc = '## 接口列表\n无需后端接口\n\n[SKIP_BACKEND]';
        this.artifacts.saveApiDoc(minimalDoc);
        this.apiDocContent = minimalDoc;
        return this.dispatchSide('frontend');
      }

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
        return this.handleResult(resume);
      }

      this.apiDocContent =
        (message.metadata?.apiDoc as string) || this.artifacts.readApiDoc() || message.content;
      this.skipBackend = Boolean(message.metadata?.skipBackend);

      if (this.complexity === 'simple') {
        return this.afterApiDocReady();
      }

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
      return this.onSideDeliverable('backend', 'code', message.content);
    }

    if (message.from === Role.ARCHITECT) {
      return this.onSideDeliverable('frontend', 'code', message.content);
    }

    if (message.from === Role.TESTER) {
      const scope = ((message.metadata?.scope as WorkScope) || 'frontend') as 'backend' | 'frontend';
      return this.onSideDeliverable(scope, 'test', message.content);
    }

    return [];
  }

  private onSideDeliverable(
    scope: 'backend' | 'frontend',
    kind: 'code' | 'test',
    content: string
  ): AgentMessage[] {
    if (this.mergeReviews) {
      this.sideBuffers[scope][kind] = content;
      const buf = this.sideBuffers[scope];
      if (!buf.code || !buf.test) {
        this.log('gate', `等待${scope === 'backend' ? '后端' : '前端'}另一半交付：code=${!!buf.code} test=${!!buf.test}`);
        return [];
      }
      const code = buf.code;
      const test = buf.test;
      this.sideBuffers[scope] = {};
      this.log('dispatch', `合并审查${scope === 'backend' ? '后端' : '前端'}代码与用例`);
      return [
        this.createMessage(
          Role.REVIEWER,
          MessageType.TASK,
          `请合并审查以下${scope === 'backend' ? '后端' : '前端'}代码与测试用例：\n\n## 代码\n${code}\n\n## 测试用例\n${test}`,
          { reviewType: 'code_and_test' satisfies ReviewType, scope }
        ),
      ];
    }

    if (kind === 'code') {
      this.log('dispatch', `将${scope === 'backend' ? '后端' : '前端'}代码发给审查员审查`);
      return [
        this.createMessage(Role.REVIEWER, MessageType.TASK, `请审查以下代码：\n${content}`, {
          reviewType: 'code' satisfies ReviewType,
          scope,
        }),
      ];
    }

    this.log('dispatch', `将${scope === 'backend' ? '后端' : '前端'}测试用例发给审查员审查`);
    return [
      this.createMessage(Role.REVIEWER, MessageType.TASK, `请审查以下测试用例：\n${content}`, {
        reviewType: 'test' satisfies ReviewType,
        scope,
      }),
    ];
  }

  private isReviewPassed(message: AgentMessage, feedbacks: ReviewFeedback[]): boolean {
    const highest = (message.metadata?.highestLevel as IssueLevel) || IssueLevel.LOW;
    if (highest === IssueLevel.HIGH || highest === IssueLevel.MEDIUM) return false;
    const text = message.content;
    if (/审查通过|无严重问题|可以继续|无问题/.test(text)) return true;
    if (feedbacks.length === 1 && feedbacks[0].content.includes('审查通过')) return true;
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
        this.createMessage(
          Role.MANAGER,
          MessageType.QUESTION,
          `需要用户决定的审查反馈：\n${message.content}\n\n项目经理建议：${response}`,
          { level: IssueLevel.HIGH, needsUserDecision: true, reviewType, scope }
        ),
      ];
    }

    const targets = resolveRevisionTargets(reviewType, scope);

    if (highest === IssueLevel.MEDIUM) {
      const pastKnowledge = this.knowledge.searchEntries(this.role, message.content.slice(0, 50));
      if (pastKnowledge.length === 0) {
        return [
          this.createMessage(
            Role.MANAGER,
            MessageType.QUESTION,
            `中级审查反馈，无历史记录，需要确认：\n${message.content}`,
            { level: IssueLevel.MEDIUM, needsUserDecision: true, reviewType, scope }
          ),
        ];
      }
      this.log('knowledge_lookup', '从知识库中找到相关历史记录');
      return this.buildRevisionMessages(
        targets,
        `请根据审查反馈整改：\n${message.content}\n\n参考历史处理：${pastKnowledge.map((k) => k.content).join('\n')}`,
        { feedbacks, reviewType, scope, apiDoc: this.apiDocContent }
      );
    }

    return this.buildRevisionMessages(
      targets,
      `请根据审查反馈整改：\n${message.content}`,
      { feedbacks, reviewType, scope, apiDoc: this.apiDocContent }
    );
  }

  private buildRevisionMessages(
    targets: Role[],
    content: string,
    metadata: Record<string, unknown>
  ): AgentMessage[] {
    const scope = metadata.scope as WorkScope | undefined;
    const parallel =
      this.config.workflow?.parallelSideWork !== false &&
      targets.length > 1 &&
      (scope === 'backend' || scope === 'frontend');

    if (scope === 'backend' || scope === 'frontend') {
      this.sideBuffers[scope] = {};
      if (scope === 'backend') {
        this.backendCodeApproved = false;
        this.backendTestApproved = false;
      } else {
        this.frontendCodeApproved = false;
        this.frontendTestApproved = false;
      }
    }

    return targets.map((to) =>
      this.createMessage(to, MessageType.REVIEW_FEEDBACK, content, {
        ...metadata,
        scope: metadata.scope || (to === Role.TESTER ? undefined : metadata.scope),
        ...(parallel
          ? {
              parallelGroup: `revise-${scope}`,
              parallelLabel: `${scope === 'backend' ? '后端' : '前端'}整改`,
            }
          : {}),
      })
    );
  }

  private advanceAfterApprovedReview(reviewType: ReviewType, scope?: WorkScope): AgentMessage[] {
    if (reviewType === 'requirement') {
      const proactiveRole = this.deps.roleRegistry.matchRole(this.requirementContent);
      if (proactiveRole) {
        this.log('role_match', `需求审查后匹配自定义角色: ${proactiveRole.displayName}`);
        this.pendingContinuation = async () => this.continueAfterRequirementReview();
        return this.dispatchToCustomRole(
          proactiveRole,
          {
            capability: proactiveRole.displayName,
            reason: proactiveRole.description,
            suggestedTags: proactiveRole.tags,
          },
          this.requirementContent
        );
      }

      return this.continueAfterRequirementReview();
    }

    if (reviewType === 'api_doc') {
      return this.afterApiDocReady();
    }

    if (reviewType === 'code_and_test' && scope === 'backend') {
      this.backendCodeApproved = true;
      this.backendTestApproved = true;
      return this.maybeDispatchFrontend();
    }

    if (reviewType === 'code_and_test' && (scope === 'frontend' || !scope)) {
      this.frontendCodeApproved = true;
      this.frontendTestApproved = true;
      return this.maybeComplete();
    }

    if (reviewType === 'code' && scope === 'backend') {
      this.backendCodeApproved = true;
      return this.maybeDispatchFrontend();
    }

    if (reviewType === 'test' && scope === 'backend') {
      this.backendTestApproved = true;
      return this.maybeDispatchFrontend();
    }

    if (reviewType === 'code' && (scope === 'frontend' || !scope)) {
      this.frontendCodeApproved = true;
      return this.maybeComplete();
    }

    if (reviewType === 'test' && (scope === 'frontend' || !scope)) {
      this.frontendTestApproved = true;
      return this.maybeComplete();
    }

    return [];
  }

  private afterApiDocReady(): AgentMessage[] {
    this.apiDocContent = this.artifacts.readApiDoc() || this.apiDocContent;
    if (this.skipBackend) {
      this.log('dispatch', '无需后端，进入前端');
      return this.dispatchSide('frontend');
    }
    this.log('dispatch', '接口文档就绪，分发后端开发与后端测试');
    return this.dispatchSide('backend');
  }

  private continueAfterRequirementReview(): AgentMessage[] {
    this.log('dispatch', '需求审查通过，分发给系统架构评估并产出接口文档');
    return [
      this.createMessage(
        Role.ARCHITECT_SYS,
        MessageType.TASK,
        `需求已审查通过，请评估是否需要基建改动，并产出接口文档。\n\n## 需求\n${this.requirementContent}`
      ),
    ];
  }

  private dispatchSide(scope: WorkScope): AgentMessage[] {
    const apiDoc = this.apiDocContent || this.artifacts.readApiDoc() || '';
    const side = scope === 'backend' ? '后端' : '前端';
    const devRole = scope === 'backend' ? Role.BACKEND : Role.ARCHITECT;
    const useArtifacts = this.config.workflow?.useArtifactRefs !== false;
    const parallel = this.config.workflow?.parallelSideWork !== false;

    if (scope === 'backend' || scope === 'frontend') {
      this.sideBuffers[scope] = {};
    }

    const taskBody = buildScopedTaskContent(this.artifacts, side, {
      useArtifacts,
      requirement: this.requirementContent,
      apiDoc,
    });

    const parallelMeta = parallel
      ? { parallelGroup: `side-${scope}`, parallelLabel: `${side}开发与测试` }
      : {};

    return [
      this.createMessage(devRole, MessageType.TASK, taskBody, {
        apiDoc,
        scope,
        useArtifacts,
        ...parallelMeta,
      }),
      this.createMessage(Role.TESTER, MessageType.TASK, taskBody, {
        apiDoc,
        scope,
        useArtifacts,
        ...parallelMeta,
      }),
    ];
  }

  private maybeDispatchFrontend(): AgentMessage[] {
    if (!this.backendCodeApproved || !this.backendTestApproved) {
      this.log('gate', `等待后端关卡：code=${this.backendCodeApproved} test=${this.backendTestApproved}`);
      return [];
    }
    this.log('dispatch', '后端关卡通过，分发前端开发与前端测试');
    return this.dispatchSide('frontend');
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
    const pendingGap = message.metadata?.pendingGap as CapabilityGap | undefined;
    const gapContext = message.metadata?.gapContext as string | undefined;
    const userAnswer = message.metadata?.userAnswer as string | undefined;

    if (pendingGap && userAnswer) {
      if (/^(yes|y|是|同意|允许|ok)$/i.test(userAnswer.trim())) {
        return this.createAndDispatchRole(pendingGap, gapContext || '');
      }
      this.pendingContinuation = null;
      return [
        this.createMessage(Role.MANAGER, MessageType.RESULT, '用户拒绝创建新角色，已跳过该能力缺口。', {}),
      ];
    }

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
