#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { initLLM } from './core/llm';
import { Orchestrator } from './core/orchestrator';
import { loadConfig, validateConfig, initConfig } from './utils/config';
import { Logger, KnowledgeBase } from './utils/file';
import { Role } from './types';

const VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
).version as string;

const program = new Command();

program
  .name('fe-agent')
  .description('全栈智能体 - 多角色协作的全栈开发 AI 助手')
  .version(VERSION);

program
  .command('start')
  .description('启动全栈智能体')
  .option('-r, --requirement <text>', '直接传入需求文本')
  .option('-f, --file <path>', '从文件读取需求')
  .option('-u, --url <url>', '传入需求网址（无法抓取时请用户粘贴正文）')
  .action(async (options) => {
    const projectPath = process.cwd();

    initConfig(projectPath);
    const config = loadConfig(projectPath);

    const { valid, errors } = validateConfig(config);
    if (!valid) {
      console.error(chalk.red('\n配置错误：'));
      errors.forEach((e) => console.error(chalk.red(`  - ${e}`)));
      console.log(chalk.dim('\n请创建 .env 文件并填入配置，参考 .env.example'));
      process.exit(1);
    }

    initLLM(config);

    let requirement = '';

    if (options.requirement) {
      requirement = options.requirement;
    } else if (options.file) {
      const filePath = path.resolve(options.file);
      if (!fs.existsSync(filePath)) {
        console.error(chalk.red(`文件不存在: ${filePath}`));
        process.exit(1);
      }
      requirement = fs.readFileSync(filePath, 'utf-8');
    } else if (options.url) {
      requirement = `请基于以下网址整理需求（无法抓取网页时请用户粘贴正文）：${options.url}`;
    } else {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'requirement',
          message: '请输入您的需求（支持文本/网址/文件路径）：',
          validate: (input: string) => (input.trim() ? true : '需求不能为空'),
        },
      ]);
      requirement = answers.requirement;

      const possiblePath = path.resolve(requirement);
      if (fs.existsSync(possiblePath)) {
        requirement = fs.readFileSync(possiblePath, 'utf-8');
      }
    }

    if (!requirement.trim()) {
      console.error(chalk.red('需求不能为空'));
      process.exit(1);
    }

    const orchestrator = new Orchestrator(config);
    await orchestrator.start(requirement);
  });

program
  .command('init')
  .description('初始化项目配置')
  .action(async () => {
    const projectPath = process.cwd();

    console.log(chalk.cyan('\n🔧 初始化全栈智能体配置\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'apiKey',
        message: '请输入 LLM API Key：',
      },
      {
        type: 'input',
        name: 'baseUrl',
        message: '请输入 LLM Base URL：',
        default: 'https://api.openai.com/v1',
      },
      {
        type: 'input',
        name: 'model',
        message: '请输入模型名称：',
        default: 'gpt-4o',
      },
      {
        type: 'input',
        name: 'projectName',
        message: '请输入项目名称：',
        default: path.basename(projectPath),
      },
    ]);

    const envContent = `# 全栈智能体配置
LLM_API_KEY=${answers.apiKey}
LLM_BASE_URL=${answers.baseUrl}
LLM_MODEL=${answers.model}
`;

    fs.writeFileSync(path.join(projectPath, '.env'), envContent, 'utf-8');

    fs.writeFileSync(
      path.join(projectPath, 'fe-agent.config.json'),
      JSON.stringify(
        {
          project: {
            name: answers.projectName,
            path: projectPath,
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    console.log(chalk.green('\n✅ 配置初始化完成！'));
    console.log(chalk.dim('  - .env 文件已创建'));
    console.log(chalk.dim('  - fe-agent.config.json 已创建'));
    console.log(chalk.dim('\n使用 fe-agent start 开始使用'));
  });

function parseLogDate(dateStr?: string): Date | undefined {
  if (!dateStr) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    console.error(chalk.red('日期格式应为 YYYY-MM-DD'));
    process.exit(1);
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

program
  .command('logs')
  .description('查看角色日志')
  .option('-r, --role <role>', '查看指定角色日志 (manager/product/architect_sys/backend/architect/tester/reviewer)')
  .option('-d, --date <date>', '查看指定日期日志 (YYYY-MM-DD)')
  .action((options) => {
    const projectPath = process.cwd();
    const config = loadConfig(projectPath);
    const logger = new Logger(config.project.path);
    const date = parseLogDate(options.date);

    if (options.role) {
      if (!Object.values(Role).includes(options.role)) {
        console.error(chalk.red(`未知角色: ${options.role}`));
        process.exit(1);
      }
      const logs = logger.getLogs(options.role as Role, date);
      if (logs.length === 0) {
        console.log(chalk.dim('暂无日志'));
      } else {
        console.log(chalk.cyan(`\n📋 ${options.role} 日志：\n`));
        logs.forEach((log) => console.log(log));
      }
    } else {
      const allLogs = logger.getAllLogs(date);
      console.log(chalk.cyan('\n📋 所有角色日志：\n'));
      for (const [role, logs] of Object.entries(allLogs)) {
        if (logs.length > 0) {
          console.log(chalk.yellow(`\n--- ${role} ---`));
          logs.forEach((log) => console.log(log));
        }
      }
    }
  });

program
  .command('knowledge')
  .description('查看知识库')
  .option('-r, --role <role>', '查看指定角色知识库')
  .option('-s, --search <keyword>', '搜索关键词')
  .action((options) => {
    const projectPath = process.cwd();
    const config = loadConfig(projectPath);
    const knowledge = new KnowledgeBase(config.project.path);

    if (options.role && options.search) {
      const results = knowledge.searchEntries(options.role as Role, options.search);
      console.log(chalk.cyan(`\n🔍 ${options.role} 知识库搜索 "${options.search}"：\n`));
      results.forEach((r) => console.log(`- [${r.category}] ${r.content}`));
    } else if (options.role) {
      const entries = knowledge.getEntries(options.role as Role);
      console.log(chalk.cyan(`\n📚 ${options.role} 知识库：\n`));
      entries.forEach((e) => console.log(`- [${e.category}] ${e.content} (来源: ${e.source})`));
    } else {
      console.log(chalk.cyan('\n📚 所有知识库：\n'));
      for (const role of Object.values(Role)) {
        const entries = knowledge.getEntries(role);
        if (entries.length > 0) {
          console.log(chalk.yellow(`\n--- ${role} (${entries.length}条) ---`));
          entries.slice(0, 10).forEach((e) => console.log(`  - [${e.category}] ${e.content}`));
        }
      }
    }
  });

program
  .command('status')
  .description('查看项目状态')
  .action(() => {
    const projectPath = process.cwd();
    const agentDir = path.join(projectPath, '.fe-agent');

    console.log(chalk.cyan('\n📊 项目状态：\n'));

    if (!fs.existsSync(agentDir)) {
      console.log(chalk.dim('全栈智能体尚未在此项目中运行过'));
      return;
    }

    const dirs = ['logs', 'knowledge', 'skills', 'artifacts'];
    for (const dir of dirs) {
      const dirPath = path.join(agentDir, dir);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath, { recursive: true });
        console.log(chalk.green(`  ${dir}/: ${Array.isArray(files) ? files.length : 0} 个文件`));
      } else {
        console.log(chalk.dim(`  ${dir}/: 暂无`));
      }
    }

    if (fs.existsSync(path.join(projectPath, '.env'))) {
      console.log(chalk.green('  配置: 已配置'));
    } else {
      console.log(chalk.yellow('  配置: 未配置'));
    }
  });

program.parse();
