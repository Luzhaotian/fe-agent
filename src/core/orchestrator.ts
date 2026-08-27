import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import {
  ProjectConfig,
  Role,
  RoleDefinition,
  AgentMessage,
  MessageType,
  WorkflowStage,
  WorkflowState,
  IssueLevel,
  ReviewFeedback,
  ReviewType,
  WorkScope,
  getRoleDisplayName,
} from '../types';
import { Logger, KnowledgeBase, Artifacts } from '../utils/file';
import { ManagerAgent } from '../agents/manager';
import { ProductAgent } from '../agents/product';
import { ArchitectSysAgent } from '../agents/architect-sys';
import { BackendAgent } from '../agents/backend';
import { ArchitectAgent } from '../agents/architect';
import { TesterAgent } from '../agents/tester';
import { ReviewerAgent } from '../agents/reviewer';
import { DynamicRoleAgent } from '../agents/dynamic';
import { BaseAgent } from '../agents/base';
import { RoleRegistry } from '../utils/role-registry';

export class Orchestrator {
  private config: ProjectConfig;
  private logger: Logger;
  private knowledge: KnowledgeBase;
  private artifacts: Artifacts;
  private roleRegistry: RoleRegistry;
  private agents: Map<string, BaseAgent>;
  private state: WorkflowState;
  private manager: ManagerAgent;

  constructor(config: ProjectConfig) {
    this.config = config;
    this.logger = new Logger(config.project.path);
    this.knowledge = new KnowledgeBase(config.project.path);
    this.artifacts = new Artifacts(config.project.path);
    this.roleRegistry = new RoleRegistry(config.project.path);

    this.manager = new ManagerAgent(config, this.logger, this.knowledge, {
      roleRegistry: this.roleRegistry,
      onRoleCreated: (def) => this.registerDynamicRole(def),
    });

    this.agents = new Map<string, BaseAgent>();
    this.agents.set(Role.MANAGER, this.manager);
    this.agents.set(Role.PRODUCT, new ProductAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.ARCHITECT_SYS, new ArchitectSysAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.BACKEND, new BackendAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.ARCHITECT, new ArchitectAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.TESTER, new TesterAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.REVIEWER, new ReviewerAgent(config, this.logger, this.knowledge));

    for (const def of this.roleRegistry.listRoles()) {
      this.registerDynamicRole(def);
    }

    this.state = {
      stage: WorkflowStage.REQUIREMENT_INPUT,
      reviewFeedbacks: [],
      history: [],
    };
  }

  registerDynamicRole(def: RoleDefinition): void {
    this.agents.set(def.name, new DynamicRoleAgent(def, this.config, this.logger, this.knowledge));
    this.logRoleRegistration(def);
  }

  private logRoleRegistration(def: RoleDefinition): void {
    console.log(chalk.dim(`  ↳ 已加载自定义角色: ${def.displayName} (${def.name})`));
  }

  async start(requirement: string): Promise<void> {
    console.log(chalk.cyan('\n🚀 全栈智能体启动\n'));
    console.log(chalk.dim(`项目: ${this.config.project.name}`));
    console.log(chalk.dim(`阶段: ${this.getStageLabel(this.state.stage)}`));

    const customRoles = this.roleRegistry.listRoles();
    if (customRoles.length > 0) {
      console.log(chalk.dim(`自定义角色: ${customRoles.length} 个`));
    }
    console.log('');

    const initialMessage: AgentMessage = {
      id: `msg_init_${Date.now()}`,
      from: Role.MANAGER,
      to: Role.MANAGER,
      type: MessageType.TASK,
      content: requirement,
      timestamp: new Date(),
    };

    await this.processMessage(initialMessage);

    if (this.state.stage === WorkflowStage.COMPLETE) {
      console.log(chalk.green('\n✅ 任务交付完成\n'));
    }
  }

  private async processMessage(message: AgentMessage): Promise<void> {
    this.state.history.push(message);

    if (message.metadata?.workflowComplete) {
      this.state.stage = WorkflowStage.COMPLETE;
      this.displayAgentOutput(message);
      return;
    }

    const targetAgent = this.agents.get(String(message.to));
    if (!targetAgent) {
      console.error(chalk.red(`未知角色: ${message.to}`));
      return;
    }

    if (message.metadata?.needsUserDecision) {
      const answer = await this.askUser(message.content);
      if (answer) {
        const userMessage: AgentMessage = {
          id: `msg_user_${Date.now()}`,
          from: Role.MANAGER,
          to: message.metadata?.reviewType ? Role.MANAGER : message.to,
          type: MessageType.TASK,
          content: `用户回复：${answer}\n原始问题：${message.content}`,
          timestamp: new Date(),
          metadata: { resumeAfterUser: true },
        };
        if (message.metadata?.pendingGap) {
          userMessage.to = Role.MANAGER;
          userMessage.type = MessageType.QUESTION;
          userMessage.metadata = {
            ...message.metadata,
            needsUserDecision: false,
            userAnswer: answer,
          };
        } else if (message.type === MessageType.QUESTION || message.type === MessageType.REVIEW_FEEDBACK) {
          userMessage.to = Role.MANAGER;
          userMessage.type = MessageType.REVIEW_FEEDBACK;
          userMessage.metadata = {
            ...message.metadata,
            needsUserDecision: false,
            userAnswer: answer,
            highestLevel: IssueLevel.LOW,
            feedbacks: [
              {
                id: `fb_user_${Date.now()}`,
                reviewerRole: Role.REVIEWER,
                targetRole: Role.MANAGER,
                level: IssueLevel.LOW,
                content: `用户决定：${answer}`,
                suggestion: answer,
                timestamp: new Date(),
              },
            ],
          };
        }
        await this.processMessage(userMessage);
      }
      return;
    }

    const roleName = getRoleDisplayName(
      message.to,
      message.metadata?.customRoleDisplayName as string | undefined
    );
    const spinner = ora(`${roleName} 处理中...`).start();

    try {
      const responses = await targetAgent.processMessage(message);
      spinner.succeed(`${roleName} 处理完成`);

      if (message.to === Role.MANAGER) {
        this.state.complexity = this.manager.getComplexity();
      }

      await this.dispatchResponses(responses);
    } catch (error) {
      spinner.fail(`${roleName} 处理失败`);
      console.error(chalk.red(`错误: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  /** 同 parallelGroup 的消息并行执行，其余串行。 */
  private async dispatchResponses(responses: AgentMessage[]): Promise<void> {
    let i = 0;
    while (i < responses.length) {
      if (this.state.stage === WorkflowStage.COMPLETE) return;

      const current = responses[i];
      const groupId = current.metadata?.parallelGroup as string | undefined;

      if (groupId && this.config.workflow?.parallelSideWork !== false) {
        const group: AgentMessage[] = [];
        while (i < responses.length && responses[i].metadata?.parallelGroup === groupId) {
          group.push(responses[i]);
          i += 1;
        }
        if (group.length > 1) {
          await this.processParallelGroup(group);
        } else {
          this.displayAgentOutput(group[0]);
          this.updateWorkflowState(group[0]);
          await this.processMessage(group[0]);
        }
        continue;
      }

      this.displayAgentOutput(current);
      this.updateWorkflowState(current);
      await this.processMessage(current);
      i += 1;
    }
  }

  private async processParallelGroup(messages: AgentMessage[]): Promise<void> {
    const label =
      (messages[0].metadata?.parallelLabel as string) ||
      messages.map((m) => getRoleDisplayName(m.to)).join(' + ');
    const spinner = ora(`并行执行：${label}`).start();

    try {
      const settled = await Promise.all(
        messages.map(async (msg) => {
          this.state.history.push(msg);
          this.updateWorkflowState(msg);

          const agent = this.agents.get(String(msg.to));
          if (!agent) {
            throw new Error(`未知角色: ${msg.to}`);
          }

          const roleName = getRoleDisplayName(msg.to);
          const outs = await agent.processMessage(msg);
          return { msg, roleName, outs };
        })
      );

      spinner.succeed(`并行完成：${label}`);

      for (const item of settled) {
        console.log(chalk.dim(`\n── ${getRoleDisplayName(item.msg.to)} 已完成 ──`));
        for (const out of item.outs) {
          this.displayAgentOutput(out);
          this.updateWorkflowState(out);
          await this.processMessage(out);
          if (this.state.stage === WorkflowStage.COMPLETE) return;
        }
      }
    } catch (error) {
      spinner.fail(`并行失败：${label}`);
      console.error(chalk.red(`错误: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private displayAgentOutput(message: AgentMessage): void {
    const fromName = getRoleDisplayName(
      message.from,
      message.metadata?.customRoleDisplayName as string | undefined
    );
    const toName = getRoleDisplayName(
      message.to,
      message.metadata?.customRoleDisplayName as string | undefined
    );

    console.log(chalk.dim(`\n── ${fromName} → ${toName} [${message.type}] ──`));

    const content = message.content;
    if (content.length > 500) {
      console.log(content.slice(0, 500) + chalk.dim('...'));
      console.log(chalk.dim(`(完整内容共 ${content.length} 字符)`));
    } else {
      console.log(content);
    }
  }

  private updateWorkflowState(message: AgentMessage): void {
    if (message.metadata?.apiDoc) {
      this.state.apiDoc = message.metadata.apiDoc as string;
    } else {
      const doc = this.artifacts.readApiDoc();
      if (doc) this.state.apiDoc = doc;
    }

    if (message.metadata?.skipBackend !== undefined) {
      this.state.skipBackend = Boolean(message.metadata.skipBackend);
    }

    if (message.metadata?.complexity) {
      this.state.complexity = message.metadata.complexity as WorkflowState['complexity'];
    }

    if (message.from === Role.MANAGER && message.to === Role.PRODUCT) {
      this.state.stage = WorkflowStage.PRODUCT_ORGANIZE;
    } else if (message.from === Role.MANAGER && message.to === Role.ARCHITECT_SYS) {
      this.state.stage = WorkflowStage.ARCH_EVALUATE;
    } else if (message.from === Role.MANAGER && message.to === Role.BACKEND) {
      this.state.stage = WorkflowStage.DEVELOP_BACKEND;
    } else if (message.from === Role.MANAGER && message.to === Role.ARCHITECT) {
      this.state.stage = WorkflowStage.DEVELOP_FRONTEND;
    } else if (message.from === Role.MANAGER && message.to === Role.TESTER) {
      const scope = message.metadata?.scope as WorkScope | undefined;
      this.state.stage =
        scope === 'backend' ? WorkflowStage.WRITE_BACKEND_TEST : WorkflowStage.WRITE_FRONTEND_TEST;
    } else if (message.from === Role.MANAGER && message.to === Role.REVIEWER) {
      const reviewType = message.metadata?.reviewType as ReviewType | undefined;
      const scope = message.metadata?.scope as WorkScope | undefined;
      if (reviewType === 'requirement') this.state.stage = WorkflowStage.REVIEW_REQUIREMENT;
      else if (reviewType === 'api_doc') this.state.stage = WorkflowStage.REVIEW_API_DOC;
      else if (reviewType === 'code' || reviewType === 'test' || reviewType === 'code_and_test') {
        this.state.stage =
          scope === 'backend' ? WorkflowStage.REVIEW_BACKEND : WorkflowStage.REVIEW_FRONTEND;
      }
    } else if (
      message.from === Role.MANAGER &&
      typeof message.to === 'string' &&
      message.to.startsWith('custom:')
    ) {
      this.state.stage = WorkflowStage.CUSTOM_ROLE;
    }

    if (message.metadata?.workflowComplete) {
      this.state.stage = WorkflowStage.COMPLETE;
    }

    if (message.from === Role.REVIEWER && message.to === Role.MANAGER) {
      const feedbacks = message.metadata?.feedbacks as ReviewFeedback[] | undefined;
      if (feedbacks) this.state.reviewFeedbacks.push(...feedbacks);
    }

    const complexityHint = this.state.complexity ? ` | 分级=${this.state.complexity}` : '';
    console.log(chalk.dim(`\n📍 当前阶段: ${this.getStageLabel(this.state.stage)}${complexityHint}`));
  }

  private getStageLabel(stage: WorkflowStage): string {
    const labels: Record<WorkflowStage, string> = {
      [WorkflowStage.REQUIREMENT_INPUT]: '需求输入',
      [WorkflowStage.PRODUCT_ORGANIZE]: '产品整理需求',
      [WorkflowStage.REVIEW_REQUIREMENT]: '审查需求',
      [WorkflowStage.ARCH_EVALUATE]: '架构评估与接口文档',
      [WorkflowStage.REVIEW_API_DOC]: '轻量审查接口文档',
      [WorkflowStage.DEVELOP_BACKEND]: '后端开发',
      [WorkflowStage.WRITE_BACKEND_TEST]: '编写后端测试',
      [WorkflowStage.REVIEW_BACKEND]: '审查后端',
      [WorkflowStage.DEVELOP_FRONTEND]: '前端开发',
      [WorkflowStage.WRITE_FRONTEND_TEST]: '编写前端测试',
      [WorkflowStage.REVIEW_FRONTEND]: '审查前端',
      [WorkflowStage.CUSTOM_ROLE]: '自定义角色执行',
      [WorkflowStage.COMPLETE]: '完成',
    };
    return labels[stage];
  }

  private async askUser(question: string): Promise<string | null> {
    console.log(chalk.yellow('\n❓ 需要您确认：'));
    console.log(question);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(chalk.cyan('\n请输入您的回复 (输入 skip 跳过): '), (answer) => {
        rl.close();
        if (answer.trim().toLowerCase() === 'skip') {
          resolve(null);
        } else {
          resolve(answer.trim());
        }
      });
    });
  }

  getState(): WorkflowState {
    return this.state;
  }

  listCustomRoles(): RoleDefinition[] {
    return this.roleRegistry.listRoles();
  }
}
