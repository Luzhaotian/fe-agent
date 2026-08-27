import * as fs from 'fs';
import * as path from 'path';
import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType } from '../types';
import { Logger, KnowledgeBase, Artifacts, listFiles, readFile } from '../utils/file';
import { getProjectStructure, ensureSkillsFile } from '../utils/project';
import { CODE_OUTPUT_HINT } from '../utils/constants';
import { enrichResultMetadata } from '../utils/capability-gap';

export class ArchitectAgent extends BaseAgent {
  private artifacts: Artifacts;
  private projectStructure = '';
  private existingComponents = '';

  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.ARCHITECT, config, logger, knowledge);
    this.artifacts = new Artifacts(config.project.path);
  }

  getSystemPrompt(): string {
    return `你是一个前端架构角色，你的职责是：

1. 按已审核需求与接口文档开发前端代码，完成后交项目经理送审
2. 先查看/生成项目 skills，优先复用已有通用组件与页面结构
3. 不得自创样式体系，严格按项目已有结构编写

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
    this.log('analyze_project', '开始分析项目结构');
    this.projectStructure = getProjectStructure(this.config.project.path);
    this.existingComponents = this.getExistingComponents(this.config.project.path);
    this.log('analyze_project', '项目结构分析完成', {
      structureLength: this.projectStructure.length,
      componentsCount: this.existingComponents.split('\n').filter(Boolean).length,
    });
  }

  private getExistingComponents(projectPath: string): string {
    const components: string[] = [];
    const componentDirs = [
      path.join(projectPath, 'src/components'),
      path.join(projectPath, 'src/component'),
      path.join(projectPath, 'components'),
      path.join(projectPath, 'src/shared/components'),
      path.join(projectPath, 'src/common/components'),
    ];

    for (const dir of componentDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const file of listFiles(dir, /\.(tsx|jsx|vue|svelte)$/)) {
        const content = readFile(file);
        if (!content) continue;
        const relativePath = path.relative(projectPath, file);
        const nameMatch = content.match(
          /(?:export\s+(?:default\s+)?(?:function|const)\s+(\w+)|defineComponent\(\s*\{\s*name:\s*['"](\w+)['"])/
        );
        const name = nameMatch?.[1] || nameMatch?.[2] || path.basename(file, path.extname(file));
        components.push(`- ${relativePath} (组件名: ${name})`);
      }
    }

    return components.join('\n');
  }

  private async ensureSkills(): Promise<string> {
    const { content, created } = await ensureSkillsFile(
      this.config.project.path,
      'architect.md',
      () =>
        this.askLLM(
          `你是一个前端架构专家，需要根据项目结构生成 skills 文档，指导后续代码开发。

格式：
# 项目 Skills
## 技术栈
## 目录规范
## 编码规范
## 通用组件使用
## 页面开发模板`,
          `请根据以下项目结构生成 skills 文档：\n\n${this.projectStructure}\n\n已有组件：\n${this.existingComponents}`
        )
    );
    if (created) {
      this.knowledge.addEntry(this.role, 'skills', '项目 skills 已生成', 'auto_generated');
      this.log('skills_generated', '项目 skills 生成并保存完成');
    } else {
      this.log('skills_found', '找到项目 skills 文件');
    }
    return content;
  }

  private async handleDevelop(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('develop_start', '开始开发代码');
    this.analyzeProject();
    const skillsContent = await this.ensureSkills();
    const apiDoc = (message.metadata?.apiDoc as string) || this.artifacts.readApiDoc() || '';
    const useArtifacts = Boolean(message.metadata?.useArtifacts);
    const requirement = useArtifacts
      ? this.artifacts.readRequirement() || message.content
      : message.content;

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `请根据以下需求与接口文档开发前端代码：

## 项目结构
${this.projectStructure}

## 已有通用组件
${this.existingComponents || '未找到通用组件'}

## 项目 Skills
${skillsContent || '暂无'}

## 接口文档
${apiDoc || '无（纯前端或未提供）'}

## 需求
${requirement}

## 要求
1. 严格按照项目已有的结构来写代码
2. 优先使用已有通用组件
3. 参考已有页面或功能的写法
4. 对接接口文档中的契约
5. 每个文件用代码块输出，标注文件路径
6. 按照项目使用的语言和框架编写`
    );

    this.log('develop_complete', '代码开发完成');

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, enrichResultMetadata(response, {
        codeDelivered: true,
        scope: 'frontend',
      })),
    ];
  }

  private async handleReviewFeedback(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('handle_review', '处理审查反馈，整改代码');
    this.analyzeProject();

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `审查员对代码提出了以下反馈，请据此整改：\n\n${message.content}\n\n## 项目结构\n${this.projectStructure}\n\n## 已有通用组件\n${this.existingComponents}\n\n请输出整改后的完整代码，每个文件用代码块输出。`
    );

    this.log('code_revised', '代码整改完成');

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, enrichResultMetadata(response, {
        codeRevised: true,
        scope: 'frontend',
      })),
    ];
  }
}
