import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType, WorkScope } from '../types';
import { Logger, KnowledgeBase, Artifacts } from '../utils/file';
import { PLAYWRIGHT_TEST_HINT } from '../utils/constants';
import { enrichResultMetadata } from '../utils/capability-gap';

export class TesterAgent extends BaseAgent {
  private artifacts: Artifacts;

  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.TESTER, config, logger, knowledge);
    this.artifacts = new Artifacts(config.project.path);
  }

  getSystemPrompt(): string {
    return `你是测试员，按任务 scope 编写可执行的 Playwright 测试，完成后交项目经理送审。

- 前端：页面交互 E2E（page / locator）
- 后端：接口 API 测试（request fixture）
- 禁止只写 Markdown「步骤/预期」文档用例；必须输出可运行的 .spec.ts 代码块

${PLAYWRIGHT_TEST_HINT}

请用中文回复说明，代码与断言保持可执行。`;
  }

  async processMessage(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('receive_message', `收到来自 ${message.from} 的消息: ${message.type}`);

    switch (message.type) {
      case MessageType.TASK:
        return this.handleWriteTestCase(message);
      case MessageType.REVIEW_FEEDBACK:
        return this.handleReviewFeedback(message);
      default:
        return [];
    }
  }

  private async handleWriteTestCase(message: AgentMessage): Promise<AgentMessage[]> {
    const scope = ((message.metadata?.scope as WorkScope) || 'frontend') as WorkScope;
    const side = scope === 'backend' ? '后端 API' : '前端 E2E';
    this.log('write_testcase', `开始编写${side} Playwright 用例`);

    const useArtifacts = Boolean(message.metadata?.useArtifacts);
    const apiDoc = useArtifacts
      ? this.artifacts.readApiDoc() || ''
      : (message.metadata?.apiDoc as string) || this.artifacts.readApiDoc() || '';
    const requirement = useArtifacts
      ? this.artifacts.readRequirement() || message.content
      : message.content;

    const focus =
      scope === 'backend'
        ? `使用 Playwright request 覆盖：
- 接口路径、方法与接口文档一致
- 入参校验、成功响应、错误码
- 鉴权与边界（缺参、非法值、未授权）
建议路径：e2e/api/*.spec.ts`
        : `使用 Playwright page 覆盖：
- 主流程交互与页面断言
- 与接口联调相关的前端表现
- 异常提示与边界
建议路径：e2e/*.spec.ts
选择器优先 getByRole / getByLabel / getByTestId`;

    const docSection = useArtifacts
      ? `## 产物
- 需求：.fe-agent/artifacts/requirement.md（约 ${(requirement || '').length} 字）
- 接口：.fe-agent/artifacts/api-doc.md（约 ${apiDoc.length} 字）
- 需求摘要：${(requirement || '').slice(0, 800)}
- 接口摘要：${apiDoc.slice(0, 1200)}`
      : `## 需求
${requirement}

## 接口文档
${apiDoc || '无'}`;

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `请根据以下内容编写完整的${side} Playwright 测试（可执行代码，不要 Markdown 步骤清单）：

${docSection}

## 任务指示
${message.content}

要求：
1. 覆盖相关功能点（正常 + 异常/边界）
2. 每个文件用 \`\`\`ts:路径 代码块输出
3. import { test, expect } from '@playwright/test'
4. ${focus}
5. 文首可用简短中文说明用例意图；主体必须是可运行代码`,
      { maxTokens: this.codeMaxTokens() }
    );

    this.log('testcase_written', `${side} Playwright 用例编写完成`);
    if (scope === 'backend' || scope === 'frontend') {
      this.artifacts.saveTests(scope, response);
    }

    return [
      this.createMessage(
        Role.MANAGER,
        MessageType.RESULT,
        response,
        enrichResultMetadata(response, {
          testCasesDelivered: true,
          testFramework: 'playwright',
          scope,
        })
      ),
    ];
  }

  private async handleReviewFeedback(message: AgentMessage): Promise<AgentMessage[]> {
    const scope = ((message.metadata?.scope as WorkScope) || 'frontend') as WorkScope;
    this.log('handle_review', '处理审查反馈，整改 Playwright 用例');
    const prev =
      scope === 'backend' || scope === 'frontend' ? this.artifacts.readTests(scope) || '' : '';

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `审查员对 Playwright 测试提出了以下反馈，请据此整改并输出完整可运行的 .spec.ts 代码块：

${message.content}

## 当前交付物摘要
${prev.slice(0, 3000)}

要求：保持 Playwright 风格；不要退回 Markdown 步骤清单。`,
      { maxTokens: this.codeMaxTokens() }
    );

    this.log('testcase_revised', 'Playwright 用例整改完成');
    if (scope === 'backend' || scope === 'frontend') {
      this.artifacts.saveTests(scope, response);
    }

    return [
      this.createMessage(
        Role.MANAGER,
        MessageType.RESULT,
        response,
        enrichResultMetadata(response, {
          testCasesRevised: true,
          testFramework: 'playwright',
          scope,
        })
      ),
    ];
  }
}
