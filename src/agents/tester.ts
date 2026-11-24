import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType, WorkScope } from '../types';
import { Logger, KnowledgeBase, Artifacts } from '../utils/file';

export class TesterAgent extends BaseAgent {
  private artifacts: Artifacts;

  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.TESTER, config, logger, knowledge);
    this.artifacts = new Artifacts(config.project.path);
  }

  getSystemPrompt(): string {
    return `你是测试员，按任务 scope 编写后端接口用例或前端交互用例，完成后交项目经理送审。

测试用例格式：
## 测试用例集
### TC-001: [用例标题]
- **优先级**: 高/中/低
- **前置条件**:
- **测试步骤**:
- **预期结果**:
- **实际结果**: [待填写]
- **状态**: 待执行/通过/失败

请用中文回复。`;
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
    const side = scope === 'backend' ? '后端' : '前端';
    this.log('write_testcase', `开始编写${side}测试用例`);

    const useArtifacts = Boolean(message.metadata?.useArtifacts);
    const apiDoc = useArtifacts
      ? this.artifacts.readApiDoc() || ''
      : (message.metadata?.apiDoc as string) || this.artifacts.readApiDoc() || '';
    const requirement = useArtifacts
      ? this.artifacts.readRequirement() || message.content
      : message.content;

    const focus =
      scope === 'backend'
        ? '重点覆盖接口路径、入参校验、响应与错误码、鉴权与边界条件'
        : '重点覆盖页面交互、前后端联调调用、异常提示与边界条件';

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
      `请根据以下内容编写完整的${side}测试用例：

${docSection}

## 任务指示
${message.content}

要求：
1. 覆盖所有相关功能点
2. 包含正常流程和异常流程
3. 考虑边界条件
4. 每个用例有明确的预期结果
5. 标注优先级
6. ${focus}`
    );

    this.log('testcase_written', `${side}测试用例编写完成`);
    if (scope === 'backend' || scope === 'frontend') {
      this.artifacts.saveTests(scope, response);
    }

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, {
        testCasesDelivered: true,
        scope,
      }),
    ];
  }

  private async handleReviewFeedback(message: AgentMessage): Promise<AgentMessage[]> {
    const scope = ((message.metadata?.scope as WorkScope) || 'frontend') as WorkScope;
    this.log('handle_review', '处理审查反馈，整改测试用例');
    const prev =
      scope === 'backend' || scope === 'frontend' ? this.artifacts.readTests(scope) || '' : '';

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `审查员对测试用例提出了以下反馈，请据此整改：\n\n${message.content}\n\n## 当前用例摘要\n${prev.slice(0, 3000)}\n\n请输出整改后的完整测试用例。`
    );

    this.log('testcase_revised', '测试用例整改完成');
    if (scope === 'backend' || scope === 'frontend') {
      this.artifacts.saveTests(scope, response);
    }

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, {
        testCasesRevised: true,
        scope,
      }),
    ];
  }
}
