import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import {
  ProjectConfig,
  Role,
  RoleName,
  AgentMessage,
  MessageType,
  WorkflowStage,
  WorkflowState,
  IssueLevel,
  ReviewFeedback,
  ReviewType,
  WorkScope,
} from '../types';
import { Logger, KnowledgeBase, Artifacts } from '../utils/file';
import { ManagerAgent } from '../agents/manager';
import { ProductAgent } from '../agents/product';
import { ArchitectSysAgent } from '../agents/architect-sys';
import { BackendAgent } from '../agents/backend';
import { ArchitectAgent } from '../agents/architect';
import { TesterAgent } from '../agents/tester';
import { ReviewerAgent } from '../agents/reviewer';
import { BaseAgent } from '../agents/base';

export class Orchestrator {
  private config: ProjectConfig;
  private logger: Logger;
  private knowledge: KnowledgeBase;
  private artifacts: Artifacts;
  private agents: Map<Role, BaseAgent>;
  private state: WorkflowState;

  constructor(config: ProjectConfig) {
    this.config = config;
    this.logger = new Logger(config.project.path);
    this.knowledge = new KnowledgeBase(config.project.path);
    this.artifacts = new Artifacts(config.project.path);

    this.agents = new Map<Role, BaseAgent>();
    this.agents.set(Role.MANAGER, new ManagerAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.PRODUCT, new ProductAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.ARCHITECT_SYS, new ArchitectSysAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.BACKEND, new BackendAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.ARCHITECT, new ArchitectAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.TESTER, new TesterAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.REVIEWER, new ReviewerAgent(config, this.logger, this.knowledge));

    this.state = {
      stage: WorkflowStage.REQUIREMENT_INPUT,
      reviewFeedbacks: [],
      history: [],
    };
  }

  async start(requirement: string): Promise<void> {
    console.log(chalk.cyan('\n🚀 全栈智能体启动\n'));
    console.log(chalk.dim(`项目: ${this.config.project.name}`));
    console.log(chalk.dim(`阶段: ${this.getStageLabel(this.state.stage)}\n`));

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

    const targetAgent = this.agents.get(message.to);
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
        // 用户确认后让经理重新处理审查/分发
        if (message.type === MessageType.QUESTION || message.type === MessageType.REVIEW_FEEDBACK) {
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

    const roleName = RoleName[message.to as Role];
    const spinner = ora(`${roleName} 处理中...`).start();

    try {
      const responses = await targetAgent.processMessage(message);
      spinner.succeed(`${roleName} 处理完成`);

      for (const response of responses) {
        this.displayAgentOutput(response);
        this.updateWorkflowState(response);
        await this.processMessage(response);
        if (this.state.stage === WorkflowStage.COMPLETE) return;
      }
    } catch (error) {
      spinner.fail(`${roleName} 处理失败`);
      console.error(chalk.red(`错误: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private displayAgentOutput(message: AgentMessage): void {
    const fromName = RoleName[message.from];
    const toName = RoleName[message.to];

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
      else if (reviewType === 'code' || reviewType === 'test') {
        this.state.stage =
          scope === 'backend' ? WorkflowStage.REVIEW_BACKEND : WorkflowStage.REVIEW_FRONTEND;
      }
    }

    if (message.metadata?.workflowComplete) {
      this.state.stage = WorkflowStage.COMPLETE;
    }

    if (message.from === Role.REVIEWER && message.to === Role.MANAGER) {
      const feedbacks = message.metadata?.feedbacks as ReviewFeedback[] | undefined;
      if (feedbacks) this.state.reviewFeedbacks.push(...feedbacks);
    }

    console.log(chalk.dim(`\n📍 当前阶段: ${this.getStageLabel(this.state.stage)}`));
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
}
