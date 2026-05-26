import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType, IssueLevel, ReviewFeedback } from '../types';
import { Logger, KnowledgeBase } from '../utils/file';

export class ReviewerAgent extends BaseAgent {
  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.REVIEWER, config, logger, knowledge);
  }

  getSystemPrompt(): string {
    return `你是一个审查员角色，你的职责是：

1. 对代码、用例、需求进行审查，并给出反馈，列出等级，反馈给项目经理
2. 对整理后的需求和原需求进行对比，如发现有误，反馈给项目经理
3. 查看代码是否按照当前项目习惯写的，查看代码是否有优化点，严格查看代码是否根据需求编写，如有误，反馈
4. 查看测试用例能否执行，是否和需求一致，如发现有误，反馈

审查反馈格式：
## 审查报告

### 审查类型：[需求/代码/测试用例]

### 问题列表

#### 问题1 [等级：高/中/低]
- **描述**: [问题描述]
- **位置**: [具体位置]
- **建议**: [修改建议]
- **目标角色**: [产品/前端架构/测试员]

#### 问题2 [等级：高/中/低]
...

### 总体评价
[对审查内容的总体评价和建议]

等级说明：
- 高：严重问题，必须修改，可能导致功能错误或安全问题
- 中：一般问题，建议修改，影响代码质量或可维护性
- 低：轻微问题，可选修改，属于优化建议

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
    const reviewType = (message.metadata?.reviewType as string) || 'code';

    this.log('review_start', `开始审查，类型: ${reviewType}`);

    let reviewPrompt = '';

    switch (reviewType) {
      case 'requirement':
        reviewPrompt = this.getRequirementReviewPrompt(message.content);
        break;
      case 'code':
        reviewPrompt = this.getCodeReviewPrompt(message.content);
        break;
      case 'test':
        reviewPrompt = this.getTestReviewPrompt(message.content);
        break;
      default:
        reviewPrompt = this.getCodeReviewPrompt(message.content);
    }

    const response = await this.askLLM(this.getSystemPrompt(), reviewPrompt);

    this.log('review_complete', '审查完成');

    // 解析问题等级
    const feedbacks = this.parseFeedbacks(response);

    return [
      this.createMessage(Role.MANAGER, MessageType.REVIEW_FEEDBACK, response, {
        reviewType,
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
2. 是否有遗漏的功能点
3. 是否有矛盾的描述
4. 验收标准是否明确
5. 边界条件是否考虑
6. 与原需求对比是否有偏差

请给出审查报告，标注问题等级和建议。`;
  }

  private getCodeReviewPrompt(content: string): string {
    return `请审查以下前端代码：

${content}

审查要点：
1. 代码是否按照需求编写
2. 代码是否符合项目习惯和规范
3. 是否有明显的 bug 或逻辑错误
4. 代码质量和可维护性
5. 是否有优化空间
6. 是否正确使用了项目通用组件
7. 安全性问题

请给出审查报告，标注问题等级和建议。`;
  }

  private getTestReviewPrompt(content: string): string {
    return `请审查以下测试用例：

${content}

审查要点：
1. 测试用例是否可执行
2. 测试用例是否与需求一致
3. 是否覆盖了所有功能点
4. 边界条件是否覆盖
5. 预期结果是否明确
6. 是否有遗漏的测试场景

请给出审查报告，标注问题等级和建议。`;
  }

  private parseFeedbacks(reviewContent: string): ReviewFeedback[] {
    const feedbacks: ReviewFeedback[] = [];

    // 解析问题等级
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
        targetRole: Role.ARCHITECT, // 默认目标，后续由项目经理决定
        level,
        content: match[0],
        suggestion: '',
        timestamp: new Date(),
      });
    }

    // 如果没有解析到等级，默认为低级
    if (feedbacks.length === 0) {
      feedbacks.push({
        id: `fb_${Date.now()}_default`,
        reviewerRole: Role.REVIEWER,
        targetRole: Role.ARCHITECT,
        level: IssueLevel.LOW,
        content: '审查通过，无严重问题',
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
