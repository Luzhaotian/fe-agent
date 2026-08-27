import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType, IssueLevel, ReviewFeedback, ReviewType, WorkScope } from '../types';
import { Logger, KnowledgeBase } from '../utils/file';
import { resolveReviewTarget, REVIEW_PASSED } from '../utils/review-target';

export class ReviewerAgent extends BaseAgent {
  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.REVIEWER, config, logger, knowledge);
  }

  getSystemPrompt(): string {
    return `你是审查员，对需求、接口文档、代码、用例给出分级反馈给项目经理。

- 需求：检查前后端能力与数据实体是否完整
- 接口文档（轻量）：只查路径、请求参数、响应、错误码
- 代码：是否符合项目习惯、是否按需求与接口文档实现
- 用例：是否可执行、是否与需求/接口一致
- 代码+用例合并审查：同时覆盖实现与用例，问题需标注目标角色（后端架构/前端架构/测试员）

审查反馈格式：
## 审查报告
### 审查类型：[需求/接口文档/代码/测试用例/代码与测试]
### 问题列表
#### 问题1 [等级：高/中/低]
- **描述** / **位置** / **建议** / **目标角色**
### 总体评价

若无明显问题，请明确写「${REVIEW_PASSED}」。
等级：高=必须改，中=建议改，低=可选改。

请用中文回复。`;
  }

  async processMessage(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('receive_message', `收到来自 ${message.from} 的消息: ${message.type}`);

    switch (message.type) {
      case MessageType.TASK:
        return this.handleReview(message);
      default:
        return [];
    }
  }

  private async handleReview(message: AgentMessage): Promise<AgentMessage[]> {
    const reviewType = (message.metadata?.reviewType as ReviewType) || 'code';
    const scope = message.metadata?.scope as WorkScope | undefined;

    this.log('review_start', `开始审查，类型: ${reviewType}, scope: ${scope || '-'}`);

    let reviewPrompt = '';
    switch (reviewType) {
      case 'requirement':
        reviewPrompt = this.getRequirementReviewPrompt(message.content);
        break;
      case 'api_doc':
        reviewPrompt = this.getApiDocReviewPrompt(message.content);
        break;
      case 'code':
        reviewPrompt = this.getCodeReviewPrompt(message.content, scope);
        break;
      case 'test':
        reviewPrompt = this.getTestReviewPrompt(message.content, scope);
        break;
      case 'code_and_test':
        reviewPrompt = this.getMergedReviewPrompt(message.content, scope);
        break;
      default:
        reviewPrompt = this.getCodeReviewPrompt(message.content, scope);
    }

    const response = await this.askLLM(this.getSystemPrompt(), reviewPrompt);
    this.log('review_complete', '审查完成');

    const feedbacks = this.parseFeedbacks(response, reviewType, scope);

    return [
      this.createMessage(Role.MANAGER, MessageType.REVIEW_FEEDBACK, response, {
        reviewType,
        scope,
        feedbacks,
        highestLevel: this.getHighestLevel(feedbacks),
      }),
    ];
  }

  private getRequirementReviewPrompt(content: string): string {
    return `请审查以下产品需求：

${content}

审查要点：
1. 需求描述是否清晰、完整
2. 前端功能与后端能力是否覆盖
3. 数据实体是否合理（如有）
4. 是否有遗漏或矛盾
5. 验收标准与边界条件是否明确

请给出审查报告，标注问题等级和建议。`;
  }

  private getApiDocReviewPrompt(content: string): string {
    return `请对以下接口文档做轻量审查（只关注契约，不审实现）：

${content}

审查要点（仅此四项）：
1. 路径是否清晰完整
2. 请求参数是否完整、类型是否明确
3. 响应结构是否明确
4. 错误码是否列出

不要展开实现细节或代码风格。若契约完整可写「${REVIEW_PASSED}」。`;
  }

  private getCodeReviewPrompt(content: string, scope?: WorkScope): string {
    const side = scope === 'backend' ? '后端' : '前端';
    return `请审查以下${side}代码：

${content}

审查要点：
1. 是否按需求编写
2. 是否符合项目习惯和规范
3. 是否与接口文档一致（路径/入参/出参/错误码）
4. 是否有明显 bug
5. 是否合理复用已有模块/组件
6. 安全性问题

请给出审查报告，标注问题等级和建议。`;
  }

  private getTestReviewPrompt(content: string, scope?: WorkScope): string {
    const side = scope === 'backend' ? '后端' : '前端';
    return `请审查以下${side}测试用例：

${content}

审查要点：
1. 是否可执行
2. 是否与需求/接口一致
3. 功能点与边界是否覆盖
4. 预期结果是否明确

请给出审查报告，标注问题等级和建议。`;
  }

  private getMergedReviewPrompt(content: string, scope?: WorkScope): string {
    const side = scope === 'backend' ? '后端' : '前端';
    const codeRole = scope === 'backend' ? '后端架构' : '前端架构';
    return `请合并审查以下${side}代码与测试用例（一次给出结论）：

${content}

审查要点：
【代码】
1. 是否按需求与接口文档实现
2. 是否符合项目习惯，有无明显 bug/安全问题
【测试用例】
3. 是否可执行、与需求/接口一致
4. 功能点与边界是否覆盖

问题请标注目标角色（${codeRole} 或 测试员）。
若代码与用例均无明显问题，请明确写「${REVIEW_PASSED}」。`;
  }

  private parseFeedbacks(reviewContent: string, reviewType: ReviewType, scope?: WorkScope): ReviewFeedback[] {
    const feedbacks: ReviewFeedback[] = [];
    const defaultTarget = resolveReviewTarget(reviewType, scope);

    const levelPattern = /\[等级[：:](高|中|低)\]/g;
    let match;
    while ((match = levelPattern.exec(reviewContent)) !== null) {
      let level: IssueLevel;
      switch (match[1]) {
        case '高':
          level = IssueLevel.HIGH;
          break;
        case '中':
          level = IssueLevel.MEDIUM;
          break;
        default:
          level = IssueLevel.LOW;
      }

      feedbacks.push({
        id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        reviewerRole: Role.REVIEWER,
        targetRole: defaultTarget,
        level,
        content: match[0],
        suggestion: '',
        timestamp: new Date(),
      });
    }

    if (feedbacks.length === 0) {
      feedbacks.push({
        id: `fb_${Date.now()}_default`,
        reviewerRole: Role.REVIEWER,
        targetRole: defaultTarget,
        level: IssueLevel.LOW,
        content: REVIEW_PASSED,
        suggestion: '可以继续下一步',
        timestamp: new Date(),
      });
    }

    return feedbacks;
  }

  private getHighestLevel(feedbacks: ReviewFeedback[]): IssueLevel {
    const levels = feedbacks.map((f) => f.level);
    if (levels.includes(IssueLevel.HIGH)) return IssueLevel.HIGH;
    if (levels.includes(IssueLevel.MEDIUM)) return IssueLevel.MEDIUM;
    return IssueLevel.LOW;
  }
}
