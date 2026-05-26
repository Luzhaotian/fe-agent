import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType } from '../types';
import { Logger, KnowledgeBase } from '../utils/file';

export class TesterAgent extends BaseAgent {
  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.TESTER, config, logger, knowledge);
  }

  getSystemPrompt(): string {
    return `你是一个测试员角色，你的职责是：

1. 编写测试用例，根据用例执行
2. 写好的用例交给项目经理，由项目经理分发给审查员进行审查

测试用例格式：
## 测试用例集

### TC-001: [用例标题]
- **优先级**: 高/中/低
- **前置条件**: [测试前需要满足的条件]
- **测试步骤**:
  1. [步骤1]
  2. [步骤2]
  3. ...
- **预期结果**: [预期看到的结果]
- **实际结果**: [待填写]
- **状态**: 待执行/通过/失败

### TC-002: [用例标题]
...

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
    this.log('write_testcase', '开始编写测试用例');

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `请根据以下需求编写完整的测试用例：\n\n${message.content}\n\n要求：
1. 覆盖所有功能点
2. 包含正常流程和异常流程
3. 考虑边界条件
4. 每个用例有明确的预期结果
5. 标注优先级`
    );

    this.log('testcase_written', '测试用例编写完成');

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, {
        testCasesDelivered: true,
      }),
    ];
  }

  private async handleReviewFeedback(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('handle_review', '处理审查反馈，整改测试用例');

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `审查员对测试用例提出了以下反馈，请据此整改：\n\n${message.content}\n\n请输出整改后的完整测试用例。`
    );

    this.log('testcase_revised', '测试用例整改完成');

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, {
        testCasesRevised: true,
      }),
    ];
  }
}
