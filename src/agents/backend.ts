import * as fs from 'fs';
import * as path from 'path';
import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType } from '../types';
import { Logger, KnowledgeBase, Artifacts, listFiles } from '../utils/file';
import { getProjectStructure, ensureSkillsFile } from '../utils/project';
import { CODE_OUTPUT_HINT } from '../utils/constants';
import { enrichResultMetadata } from '../utils/capability-gap';

export class BackendAgent extends BaseAgent {
  private artifacts: Artifacts;
  private projectStructure = '';
  private existingModules = '';

  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.BACKEND, config, logger, knowledge);
    this.artifacts = new Artifacts(config.project.path);
  }

  getSystemPrompt(): string {
    return `你是一个后端架构角色，你的职责是：

1. 严格按已审核接口文档实现后端，完成后交项目经理送审
2. 先查看/生成 backend skills，优先复用已有模块与约定
3. 路径、入参、出参、错误码必须与接口文档一致

${CODE_OUTPUT_HINT}

请用中文注释和回复。`;
  }

  async processMessage(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('receive_message', `收到来自 ${message.from} 的消息: ${message.type}`);

    switch (message.type) {
      case MessageType.TASK:
        return this.handleDevelop(message);
      case MessageType.REVIEW_FEEDBACK:
        return this.handleReviewFeedback(message);
      default:
        return [];
    }
  }

  private analyzeProject(): void {
    if (this.projectStructure) return;
    this.log('analyze_project', '开始分析后端相关项目结构');
    this.projectStructure = getProjectStructure(this.config.project.path);
    this.existingModules = this.getExistingModules(this.config.project.path);
    this.log('analyze_project', '项目结构分析完成');
  }

  private getExistingModules(projectPath: string): string {
    const modules: string[] = [];
    const candidateDirs = [
      path.join(projectPath, 'src'),
      path.join(projectPath, 'server'),
      path.join(projectPath, 'api'),
      path.join(projectPath, 'backend'),
      path.join(projectPath, 'app'),
      path.join(projectPath, 'packages'),
    ];

    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const file of listFiles(dir, /\.(ts|js|go|py|java)$/).slice(0, 40)) {
        modules.push(`- ${path.relative(projectPath, file)}`);
      }
    }
    return modules.join('\n');
  }

  private async ensureSkills(): Promise<string> {
    const { content, created } = await ensureSkillsFile(
      this.config.project.path,
      'backend.md',
      () =>
        this.askLLM(
          `你是后端架构专家，根据项目结构生成 backend skills。

格式：
# 后端 Skills
## 技术栈
## 目录规范
## 编码规范
## 模块复用约定
## API 实现模板`,
          `项目结构：\n${this.projectStructure}\n\n已有模块：\n${this.existingModules || '未识别'}`
        )
    );
    if (created) {
      this.knowledge.addEntry(this.role, 'skills', '后端 skills 已生成', 'auto_generated');
      this.log('skills_generated', '后端 skills 生成并保存完成');
    }
    return content;
  }

  private async handleDevelop(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('develop_start', '开始后端开发');
    this.analyzeProject();
    const skills = await this.ensureSkills();
    const apiDoc = (message.metadata?.apiDoc as string) || this.artifacts.readApiDoc() || '';
    const useArtifacts = Boolean(message.metadata?.useArtifacts);
    const requirement = useArtifacts
      ? this.artifacts.readRequirement() || message.content
      : message.content;

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `请根据接口文档与需求实现后端代码：

## 项目结构
${this.projectStructure}

## 已有模块
${this.existingModules || '未找到'}

## 后端 Skills
${skills || '暂无'}

## 接口文档
${apiDoc || '无'}

## 需求与指示
${requirement}

## 要求
1. 严格按接口文档实现
2. 优先复用已有模块
3. 每个文件用代码块输出并标注路径`
    );

    this.log('develop_complete', '后端开发完成');

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, enrichResultMetadata(response, {
        codeDelivered: true,
        scope: 'backend',
      })),
    ];
  }

  private async handleReviewFeedback(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('handle_review', '处理审查反馈，整改后端代码');
    this.analyzeProject();
    const apiDoc = this.artifacts.readApiDoc() || '';

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `审查员对后端代码提出了以下反馈，请据此整改：\n\n${message.content}\n\n## 接口文档\n${apiDoc}\n\n## 项目结构\n${this.projectStructure}\n\n请输出整改后的完整代码。`
    );

    this.log('code_revised', '后端代码整改完成');

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, enrichResultMetadata(response, {
        codeRevised: true,
        scope: 'backend',
      })),
    ];
  }
}
