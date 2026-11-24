import * as path from 'path';
import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType, ReviewType, WorkScope } from '../types';
import { Logger, KnowledgeBase, Artifacts, readFile, fileExists } from '../utils/file';
import { REVIEW_PASSED } from '../utils/review-target';
import { parseReviewResponse } from '../utils/review-parse';

export class ReviewerAgent extends BaseAgent {
  private artifacts: Artifacts;

  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.REVIEWER, config, logger, knowledge);
    this.artifacts = new Artifacts(config.project.path);
  }

  getSystemPrompt(): string {
    return `你是审查员，对需求、接口文档、代码、用例给出分级反馈给项目经理。

- 需求：检查前后端能力与数据实体是否完整
- 接口文档（轻量）：只查路径、请求参数、响应、错误码
- 代码：是否符合项目习惯、是否按需求与接口文档实现
- 用例：是否可执行、是否与需求/接口一致
- 代码+用例合并审查：同时覆盖实现与用例，问题需标注目标角色（后端架构/前端架构/测试员）

请优先输出一个 JSON 代码块（不要其它包裹说明），格式：
\`\`\`json
{
  "passed": true/false,
  "issues": [
    {
      "level": "高|中|低",
      "description": "问题描述",
      "suggestion": "修改建议",
      "targetRole": "产品|架构|后端架构|前端架构|测试员"
    }
  ],
  "summary": "一句话总结"
}
\`\`\`

无问题时 passed=true 且 issues=[]，并可在 summary 写「${REVIEW_PASSED}」。
等级：高=必须改，中=建议改，低=可选改。

请用中文。`;
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

  private resolveReviewBody(message: AgentMessage): string {
    const useArtifacts = Boolean(message.metadata?.useArtifacts);
    if (!useArtifacts) return message.content;

    const projectRoot = this.config.project.path;
    const pathMatches = [...message.content.matchAll(/\.fe-agent\/artifacts\/[^\s)）]+/g)].map(
      (m) => m[0]
    );

    if (pathMatches.length === 0) return message.content;

    const parts = [message.content, '', '## 产物内容'];
    for (const rel of pathMatches) {
      const abs = path.join(projectRoot, rel);
      const content = readFile(abs);
      if (content) {
        const truncated =
          content.length > 12000
            ? `${content.slice(0, 12000)}\n\n...(已截断，共 ${content.length} 字)`
            : content;
        parts.push(`\n### ${rel}\n${truncated}`);
      } else if (!fileExists(abs)) {
        parts.push(`\n### ${rel}\n（文件不存在）`);
      }
    }
    return parts.join('\n');
  }

  private async handleReview(message: AgentMessage): Promise<AgentMessage[]> {
    const reviewType = (message.metadata?.reviewType as ReviewType) || 'code';
    const scope = message.metadata?.scope as WorkScope | undefined;

    this.log('review_start', `开始审查，类型: ${reviewType}, scope: ${scope || '-'}`);

    const body = this.resolveReviewBody(message);
    let reviewPrompt = '';
    switch (reviewType) {
      case 'requirement':
        reviewPrompt = this.getRequirementReviewPrompt(body);
        break;
      case 'api_doc':
        reviewPrompt = this.getApiDocReviewPrompt(body);
        break;
      case 'code':
        reviewPrompt = this.getCodeReviewPrompt(body, scope);
        break;
      case 'test':
        reviewPrompt = this.getTestReviewPrompt(body, scope);
        break;
      case 'code_and_test':
        reviewPrompt = this.getMergedReviewPrompt(body, scope);
        break;
      default:
        reviewPrompt = this.getCodeReviewPrompt(body, scope);
    }

    const response = await this.askLLM(this.getSystemPrompt(), reviewPrompt);
    this.log('review_complete', '审查完成');

    const parsed = parseReviewResponse(response, reviewType, scope);

    return [
      this.createMessage(Role.MANAGER, MessageType.REVIEW_FEEDBACK, response, {
        reviewType,
        scope,
        feedbacks: parsed.feedbacks,
        highestLevel: parsed.highestLevel,
        reviewPassed: parsed.passed,
        parseUncertain: parsed.parseUncertain,
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

请按系统要求输出 JSON 审查报告。`;
  }

  private getApiDocReviewPrompt(content: string): string {
    return `请轻量审查以下接口文档（只关注路径、入参、出参、错误码）：

${content}

请按系统要求输出 JSON 审查报告。`;
  }

  private getCodeReviewPrompt(content: string, scope?: WorkScope): string {
    const side = scope === 'backend' ? '后端' : '前端';
    return `请审查以下${side}代码：

${content}

审查要点：是否按需求与接口文档实现、是否符合项目习惯、有无明显 bug/安全问题。
请按系统要求输出 JSON 审查报告。`;
  }

  private getTestReviewPrompt(content: string, scope?: WorkScope): string {
    const side = scope === 'backend' ? '后端' : '前端';
    return `请审查以下${side}测试用例：

${content}

审查要点：是否可执行、与需求/接口一致、边界是否覆盖。
请按系统要求输出 JSON 审查报告。`;
  }

  private getMergedReviewPrompt(content: string, scope?: WorkScope): string {
    const side = scope === 'backend' ? '后端' : '前端';
    const codeRole = scope === 'backend' ? '后端架构' : '前端架构';
    return `请合并审查以下${side}代码与测试用例（一次给出结论）：

${content}

问题请标注目标角色（${codeRole} 或 测试员）。
请按系统要求输出 JSON 审查报告；若均无明显问题，passed=true。`;
  }
}
