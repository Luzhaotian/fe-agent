import * as fs from 'fs';
import * as path from 'path';
import { BaseAgent } from './base';
import { ProjectConfig, Role, AgentMessage, MessageType } from '../types';
import { Logger, KnowledgeBase, listFiles, readFile, fileExists } from '../utils/file';

export class ArchitectAgent extends BaseAgent {
  private projectStructure: string = '';
  private existingComponents: string = '';

  constructor(config: ProjectConfig, logger: Logger, knowledge: KnowledgeBase) {
    super(Role.ARCHITECT, config, logger, knowledge);
  }

  getSystemPrompt(): string {
    return `你是一个前端架构角色，你的职责是：

1. 把产品整理好的需求按照需求进行代码开发，开发完成后发给项目经理，由项目经理分发给审查员审查
2. 在任何项目中，先查看是否有根据项目习惯、框架、语言生成的 skills
3. 如果没有 skills，先根据项目生成一个 skills，这个 skills 要求按照项目架构生成，查看项目的构成，是否有通用组件，生成的代码优先使用通用组件。严格按照项目语言开发
4. 不得自己设计样式和结构，严格按照项目已有的结构来，优先参考已写好的页面或者功能

代码输出格式：
\`\`\`language:filepath
// 代码内容
\`\`\`

每个文件用一个代码块输出，并说明文件路径。

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

  private async analyzeProject(): Promise<void> {
    const projectPath = this.config.project.path;

    // 分析项目结构
    if (!this.projectStructure) {
      this.log('analyze_project', '开始分析项目结构');
      this.projectStructure = await this.getProjectStructure(projectPath);
      this.existingComponents = await this.getExistingComponents(projectPath);
      this.log('analyze_project', '项目结构分析完成', {
        structureLength: this.projectStructure.length,
        componentsCount: this.existingComponents.split('\n').length,
      });
    }
  }

  private async getProjectStructure(projectPath: string): Promise<string> {
    const structure: string[] = [];

    const scan = (dir: string, depth: number = 0): void => {
      if (depth > 3) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const fullPath = path.join(dir, entry.name);
          const indent = '  '.repeat(depth);
          if (entry.isDirectory()) {
            structure.push(`${indent}${entry.name}/`);
            scan(fullPath, depth + 1);
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

  private async getExistingComponents(projectPath: string): Promise<string> {
    const components: string[] = [];

    // 常见组件目录
    const componentDirs = [
      path.join(projectPath, 'src/components'),
      path.join(projectPath, 'src/component'),
      path.join(projectPath, 'components'),
      path.join(projectPath, 'src/shared/components'),
      path.join(projectPath, 'src/common/components'),
    ];

    for (const dir of componentDirs) {
      if (fs.existsSync(dir)) {
        const files = listFiles(dir, /\.(tsx|jsx|vue|svelte)$/);
        for (const file of files) {
          const content = readFile(file);
          if (content) {
            const relativePath = path.relative(projectPath, file);
            // 提取组件名称和 props
            const nameMatch = content.match(/(?:export\s+(?:default\s+)?(?:function|const)\s+(\w+)|defineComponent\(\s*\{\s*name:\s*['"](\w+)['"])/);
            const name = nameMatch?.[1] || nameMatch?.[2] || path.basename(file, path.extname(file));
            components.push(`- ${relativePath} (组件名: ${name})`);
          }
        }
      }
    }

    return components.join('\n');
  }

  private async handleDevelop(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('develop_start', '开始开发代码');

    // 分析项目
    await this.analyzeProject();

    // 检查 skills
    const skillsPath = path.join(this.config.project.path, '.fe-agent', 'skills', 'architect.md');
    let skillsContent = '';

    if (fileExists(skillsPath)) {
      skillsContent = readFile(skillsPath) || '';
      this.log('skills_found', '找到项目 skills 文件');
    } else {
      this.log('skills_not_found', '未找到 skills，将自动生成');
      skillsContent = await this.generateSkills();
    }

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `请根据以下需求开发前端代码：

## 项目结构
${this.projectStructure}

## 已有通用组件
${this.existingComponents || '未找到通用组件'}

## 项目 Skills
${skillsContent || '暂无'}

## 需求
${message.content}

## 要求
1. 严格按照项目已有的结构来写代码
2. 优先使用已有通用组件
3. 参考已有页面或功能的写法
4. 每个文件用代码块输出，标注文件路径
5. 按照项目使用的语言和框架编写`
    );

    this.log('develop_complete', '代码开发完成');

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, {
        codeDelivered: true,
      }),
    ];
  }

  private async handleReviewFeedback(message: AgentMessage): Promise<AgentMessage[]> {
    this.log('handle_review', '处理审查反馈，整改代码');

    await this.analyzeProject();

    const response = await this.askLLM(
      this.getSystemPrompt(),
      `审查员对代码提出了以下反馈，请据此整改：\n\n${message.content}\n\n## 项目结构\n${this.projectStructure}\n\n## 已有通用组件\n${this.existingComponents}\n\n请输出整改后的完整代码，每个文件用代码块输出。`
    );

    this.log('code_revised', '代码整改完成');

    return [
      this.createMessage(Role.MANAGER, MessageType.RESULT, response, {
        codeRevised: true,
      }),
    ];
  }

  private async generateSkills(): Promise<string> {
    this.log('generate_skills', '开始生成项目 skills');

    const skills = await this.askLLM(
      `你是一个前端架构专家，需要根据项目结构生成一个 skills 文档，这个文档将指导后续的代码开发。

格式要求：
# 项目 Skills

## 技术栈
- 框架：
- 语言：
- UI库：
- 状态管理：

## 目录规范
[描述项目的目录结构规范]

## 编码规范
[描述编码规范]

## 通用组件使用
[描述通用组件的使用方式]

## 页面开发模板
[描述页面开发的模板和步骤]`,

      `请根据以下项目结构生成 skills 文档：\n\n${this.projectStructure}\n\n已有组件：\n${this.existingComponents}`
    );

    // 保存 skills
    const skillsDir = path.join(this.config.project.path, '.fe-agent', 'skills');
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }
    fs.writeFileSync(path.join(skillsDir, 'architect.md'), skills, 'utf-8');

    this.knowledge.addEntry(this.role, 'skills', '项目 skills 已生成', 'auto_generated');
    this.log('skills_generated', '项目 skills 生成并保存完成');

    return skills;
  }
}
