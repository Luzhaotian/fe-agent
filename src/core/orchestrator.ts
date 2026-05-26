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
} from '../types';
import { Logger, KnowledgeBase } from '../utils/file';
import { ManagerAgent } from '../agents/manager';
import { ProductAgent } from '../agents/product';
import { ArchitectAgent } from '../agents/architect';
import { TesterAgent } from '../agents/tester';
import { ReviewerAgent } from '../agents/reviewer';
import { BaseAgent } from '../agents/base';

export class Orchestrator {
  private config: ProjectConfig;
  private logger: Logger;
  private knowledge: KnowledgeBase;
  private agents: Map<Role, BaseAgent>;
  private state: WorkflowState;

  constructor(config: ProjectConfig) {
    this.config = config;
    this.logger = new Logger(config.project.path);
    this.knowledge = new KnowledgeBase(config.project.path);

    // 初始化各角色
    this.agents = new Map<Role, BaseAgent>();
    this.agents.set(Role.MANAGER, new ManagerAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.PRODUCT, new ProductAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.ARCHITECT, new ArchitectAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.TESTER, new TesterAgent(config, this.logger, this.knowledge));
    this.agents.set(Role.REVIEWER, new ReviewerAgent(config, this.logger, this.knowledge));

    // 初始化工作流状态
    this.state = {
      stage: WorkflowStage.REQUIREMENT_INPUT,
      codeArtifacts: [],
      testCases: [],
      reviewFeedbacks: [],
      pendingQuestions: [],
      history: [],
    };
  }

  async start(requirement: string): Promise<void> {
    console.log(chalk.cyan('\n🚀 前端智能体启动\n'));
    console.log(chalk.dim(`项目: ${this.config.project.name}`));
    console.log(chalk.dim(`阶段: ${this.getStageLabel(this.state.stage)}\n`));

    // 创建初始消息
    const initialMessage: AgentMessage = {
      id: `msg_init_${Date.now()}`,
      from: Role.MANAGER, // 用户消息通过经理角色进入
      to: Role.MANAGER,
      type: MessageType.TASK,
      content: requirement,
      timestamp: new Date(),
    };

    await this.processMessage(initialMessage);
  }

  private async processMessage(message: AgentMessage): Promise<void> {
    this.state.history.push(message);

    const targetAgent = this.agents.get(message.to);
    if (!targetAgent) {
      console.error(chalk.red(`未知角色: ${message.to}`));
      return;
    }

    // 检查是否需要用户决策
    if (message.metadata?.needsUserDecision) {
      const answer = await this.askUser(message.content);
      if (answer) {
        // 用户回答后继续流程
        const userMessage: AgentMessage = {
          id: `msg_user_${Date.now()}`,
          from: Role.MANAGER,
          to: message.to,
          type: MessageType.TASK,
          content: `用户回复：${answer}\n原始问题：${message.content}`,
          timestamp: new Date(),
        };
        await this.processMessage(userMessage);
      }
      return;
    }

    // 显示角色信息
    const roleName = RoleName[message.to as Role];
    const spinner = ora(`${roleName} 处理中...`).start();

    try {
      const responses = await targetAgent.processMessage(message);
      spinner.succeed(`${roleName} 处理完成`);

      // 显示角色输出
      for (const response of responses) {
        this.displayAgentOutput(response);
        this.updateWorkflowState(response);
        await this.processMessage(response);
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

    // 简化显示
    const content = message.content;
    if (content.length > 500) {
      console.log(content.slice(0, 500) + chalk.dim('...'));
      console.log(chalk.dim(`(完整内容共 ${content.length} 字符)`));
    } else {
      console.log(content);
    }
  }

  private updateWorkflowState(message: AgentMessage): void {
    // 根据消息更新工作流阶段
    if (message.from === Role.MANAGER && message.to === Role.PRODUCT) {
      this.state.stage = WorkflowStage.PRODUCT_ORGANIZE;
    } else if (message.from === Role.PRODUCT && message.to === Role.MANAGER) {
      this.state.stage = WorkflowStage.REVIEW_REQUIREMENT;
    } else if (message.from === Role.MANAGER && message.to === Role.REVIEWER && message.metadata?.reviewType === 'requirement') {
      this.state.stage = WorkflowStage.REVIEW_REQUIREMENT;
    } else if (message.from === Role.MANAGER && message.to === Role.ARCHITECT) {
      this.state.stage = WorkflowStage.DEVELOP_CODE;
    } else if (message.from === Role.MANAGER && message.to === Role.TESTER) {
      this.state.stage = WorkflowStage.WRITE_TEST;
    } else if (message.from === Role.MANAGER && message.to === Role.REVIEWER) {
      this.state.stage = WorkflowStage.REVIEW_CODE_AND_TEST;
    }

    // 审查通过后分发到开发和测试
    if (message.from === Role.REVIEWER && message.to === Role.MANAGER) {
      const feedbacks = message.metadata?.feedbacks as ReviewFeedback[] | undefined;
      const highestLevel = message.metadata?.highestLevel as IssueLevel | undefined;

      if (highestLevel === IssueLevel.LOW && (!feedbacks || feedbacks.every((f) => f.level === IssueLevel.LOW))) {
        // 审查通过，继续下一阶段
        this.state.stage = WorkflowStage.DEVELOP_CODE;
      }
    }

    console.log(chalk.dim(`\n📍 当前阶段: ${this.getStageLabel(this.state.stage)}`));
  }

  private getStageLabel(stage: WorkflowStage): string {
    const labels: Record<WorkflowStage, string> = {
      [WorkflowStage.REQUIREMENT_INPUT]: '需求输入',
      [WorkflowStage.PRODUCT_ORGANIZE]: '产品整理需求',
      [WorkflowStage.REVIEW_REQUIREMENT]: '审查需求',
      [WorkflowStage.DEVELOP_CODE]: '前端开发',
      [WorkflowStage.WRITE_TEST]: '编写测试用例',
      [WorkflowStage.REVIEW_CODE_AND_TEST]: '审查代码和测试',
      [WorkflowStage.FIX_ISSUES]: '整改问题',
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
