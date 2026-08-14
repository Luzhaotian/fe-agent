import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType } from '../types';
import { Logger, KnowledgeBase, Artifacts } from '../utils/file';
import { getProjectStructure, ensureSkillsFile } from '../utils/project';

export class ArchitectSysAgent extends BaseAgent {
  private artifacts: Artifacts;
  private projectStructure = '';

  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.ARCHITECT_SYS, config, logger, knowledge);
    this.artifacts = new Artifacts(config.project.path);
  }

  getSystemPrompt(): string {
    return `你是一个系统架构角色，你的职责是：

1. 评估需求是否需要改动业务之外的内容（目录/依赖/基建/工程配置），需要则给出方案和代码
2. 根据已审核需求产出接口文档，供后端实现、前端对接、测试编写用例
3. 按需处理非业务改动时，只动基建/结构，除非必要不要改业务接口约定

接口文档格式：
## 接口列表
### [METHOD] /path
- 说明：
- 请求参数：
- 响应：
- 错误码：

若无需后端接口，文档中写「无需后端接口」，结论标注 [SKIP_BACKEND]。
基建改动用代码块输出：\`\`\`language:filepath

输出结构：
## 架构评估
## 基建改动（如有）
## 接口文档
## 结论
[SKIP_BACKEND] 或 [NEED_BACKEND]

请用中文回复。`;
  }

  async processMessage(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('receive_message', `收到来自 ${message.from} 的消息: ${message.type}`);

    switch (message.type) {
      case MessageType.TASK:
        return this.handleEvaluate(message);
      case MessageType.REVIEW_FEEDBACK:
        return this.handleReviewFeedback(message);
      default:
        return [];
    }
  }

  private analyzeProject(): void {
    if (this.projectStructure) return;
    this.log('analyze_project', '开始分析项目结构');
    this.projectStructure = getProjectStructure(this.config.project.path);
    this.log('analyze_project', '项目结构分析完成');
  }

  private async ensureSkills(): Promise<string> {
    const { content, created } = await ensureSkillsFile(
      this.config.project.path,
      'architect_sys.md',
      () =>
        this.askLLM(
          `你是系统架构专家，根据项目结构生成 skills，指导基建与接口文档约定。

格式：
# 系统架构 Skills
## 技术栈
## 目录与模块边界
## 接口文档约定
## 基建改动原则`,
          `项目结构：\n${this.projectStructure}`
        )
    );
    if (created) {
      this.knowledge.addEntry(this.role, 'skills', '系统架构 skills 已生成', 'auto_generated');
    }
    return content;
  }

  private extractApiDoc(response: string): string {
    const match = response.match(/##\s*接口文档\s*\n([\s\S]*?)(?=\n##\s*结论|$)/);
    if (match) return match[1].trim();
    if (response.includes('## 接口列表') || response.includes('### [')) {
      return response;
    }
    return response;
  }

  private async handleEvaluate(message: AgentMessage): Promise<AgentMessage[]> {
    const infraOnly = Boolean(message.metadata?.infraOnly);
    this.log('arch_evaluate', infraOnly ? '处理按需基建任务' : '开始架构评估与接口文档产出');

    this.analyzeProject();
    const skills = await this.ensureSkills();

    const prompt = infraOnly
      ? `这是过程中的非业务/基建改动任务，请只处理基建相关内容，必要时可微调接口文档。

## 项目结构
${this.projectStructure}

## Skills
${skills}

## 任务
${message.content}`
      : `请根据已审核需求进行架构评估，必要时给出基建改动，并产出接口文档。

## 项目结构
${this.projectStructure}

## Skills
${skills}

## 需求
${message.content}

## 已有接口文档（如有）
${this.artifacts.readApiDoc() || '无'}`;

    const response = await this.askLLM(this.getSystemPrompt(), prompt);
    const apiDoc = this.extractApiDoc(response);
    this.artifacts.saveApiDoc(apiDoc);

    const skipBackend =
      response.includes('[SKIP_BACKEND]') ||
      /无需后端接口/.test(apiDoc) ||
      Boolean(message.metadata?.infraOnly && !/##\s*接口列表/.test(apiDoc));

    this.log('arch_evaluate_done', '架构评估完成', { skipBackend, apiDocLength: apiDoc.length });

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, {
        apiDocDelivered: !infraOnly,
        apiDoc,
        skipBackend,
        infraOnly,
        needsArchitectSys: response.includes('[NEEDS_ARCHITECT_SYS]'),
      }),
    ];
  }

  private async handleReviewFeedback(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('handle_review', '根据审查反馈修订接口文档/基建');

    this.analyzeProject();
    const response = await this.askLLM(
      this.getSystemPrompt(),
      `审查反馈如下，请修订接口文档或基建改动：\n\n${message.content}\n\n## 当前接口文档\n${this.artifacts.readApiDoc() || '无'}\n\n## 项目结构\n${this.projectStructure}`
    );

    const apiDoc = this.extractApiDoc(response);
    this.artifacts.saveApiDoc(apiDoc);
    const skipBackend = response.includes('[SKIP_BACKEND]') || /无需后端接口/.test(apiDoc);

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, {
        apiDocRevised: true,
        apiDoc,
        skipBackend,
      }),
    ];
  }
}
