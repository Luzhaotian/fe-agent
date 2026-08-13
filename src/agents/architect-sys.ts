import * as fs from 'fs';
import * as path from 'path';
import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType } from '../types';
import { Logger, KnowledgeBase, Artifacts, readFile, fileExists } from '../utils/file';

export class ArchitectSysAgent extends BaseAgent {
  private artifacts: Artifacts;
  private projectStructure: string = '';

  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.ARCHITECT_SYS, config, logger, knowledge);
    this.artifacts = new Artifacts(config.project.path);
  }

  getSystemPrompt(): string {
    return `你是一个系统架构角色，你的职责是：

1. 评估需求是否需要改动业务之外的内容（目录结构、依赖、基建、工程配置等），需要则给出改动方案和代码
2. 根据已审核需求产出接口文档（API 契约），供后端实现、前端对接、测试编写用例
3. 过程中若被分派非业务改动任务，只处理基建/结构问题，除非必要不要改业务接口约定

接口文档格式（必须遵守）：
## 接口列表
### [METHOD] /path
- 说明：
- 请求参数：
- 响应：
- 错误码：

若无需后端接口，在文档中明确写「无需后端接口」，并在结论中标注 [SKIP_BACKEND]。
若有基建改动，用代码块输出文件，格式：\`\`\`language:filepath

输出结构：
## 架构评估
[是否需要基建改动、原因]

## 基建改动（如有）
[代码块]

## 接口文档
[完整接口文档 Markdown]

## 结论
[SKIP_BACKEND] 或 [NEED_BACKEND]
如有非业务后续建议，可标注 [NEEDS_ARCHITECT_SYS]

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

  private async analyzeProject(): Promise<void> {
    if (this.projectStructure) return;
    this.log('analyze_project', '开始分析项目结构');
    this.projectStructure = this.getProjectStructure(this.config.project.path);
    this.log('analyze_project', '项目结构分析完成');
  }

  private getProjectStructure(projectPath: string): string {
    const structure: string[] = [];
    const scan = (dir: string, depth: number = 0): void => {
      if (depth > 3) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const indent = '  '.repeat(depth);
          if (entry.isDirectory()) {
            structure.push(`${indent}${entry.name}/`);
            scan(path.join(dir, entry.name), depth + 1);
          } else {
            structure.push(`${indent}${entry.name}`);
          }
        }
      } catch {
        // skip
      }
    };
    scan(projectPath);
    return structure.join('\n');
  }

  private async ensureSkills(): Promise<string> {
    const skillsPath = path.join(this.config.project.path, '.fe-agent', 'skills', 'architect_sys.md');
    if (fileExists(skillsPath)) {
      return readFile(skillsPath) || '';
    }

    const skills = await this.askLLM(
      `你是系统架构专家，根据项目结构生成 skills，指导基建与接口文档约定。

格式：
# 系统架构 Skills
## 技术栈
## 目录与模块边界
## 接口文档约定
## 基建改动原则`,
      `项目结构：\n${this.projectStructure}`
    );

    const skillsDir = path.dirname(skillsPath);
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(skillsPath, skills, 'utf-8');
    this.knowledge.addEntry(this.role, 'skills', '系统架构 skills 已生成', 'auto_generated');
    return skills;
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

    await this.analyzeProject();
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

    await this.analyzeProject();
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
