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

const VERSION = '1.0.0';

const program = new Command();

program
  .name('fe-agent')
  .description('前端智能体 - 多角色协作的前端开发AI助手')
  .version(VERSION);

// 启动命令
program
  .command('start')
  .description('启动前端智能体')
  .option('-r, --requirement <text>', '直接传入需求文本')
  .option('-f, --file <path>', '从文件读取需求')
  .option('-u, --url <url>', '从网址获取需求')
  .action(async (options) => {
    const projectPath = process.cwd();

    // 初始化配置
    initConfig(projectPath);
    const config = loadConfig(projectPath);

    // 验证配置
    const { valid, errors } = validateConfig(config);
    if (!valid) {
      console.error(chalk.red('\n配置错误：'));
      errors.forEach((e) => console.error(chalk.red(`  - ${e}`)));
      console.log(chalk.dim('\n请创建 .env 文件并填入配置，参考 .env.example'));
      process.exit(1);
    }

    // 初始化 LLM
    initLLM(config);

    // 获取需求
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
      requirement = `请访问以下网址获取需求：${options.url}`;
    } else {
      // 交互式输入
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'requirement',
          message: '请输入您的需求（支持文本/网址/文件路径）：',
          validate: (input: string) => input.trim() ? true : '需求不能为空',
        },
      ]);
      requirement = answers.requirement;

      // 检查是否为文件路径
      const possiblePath = path.resolve(requirement);
      if (fs.existsSync(possiblePath)) {
        requirement = fs.readFileSync(possiblePath, 'utf-8');
      }
    }

    if (!requirement.trim()) {
      console.error(chalk.red('需求不能为空'));
      process.exit(1);
    }

    // 启动编排器
    const orchestrator = new Orchestrator(config);
    await orchestrator.start(requirement);
  });

// 初始化配置
program
  .command('init')
  .description('初始化项目配置')
  .action(async () => {
    const projectPath = process.cwd();

    console.log(chalk.cyan('\n🔧 初始化前端智能体配置\n'));

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

    // 写入 .env
    const envContent = `# 前端智能体配置
LLM_API_KEY=${answers.apiKey}
LLM_BASE_URL=${answers.baseUrl}
LLM_MODEL=${answers.model}
`;

    fs.writeFileSync(path.join(projectPath, '.env'), envContent, 'utf-8');

    // 写入配置文件
    const configContent = {
      project: {
        name: answers.projectName,
        path: projectPath,
      },
    };

    fs.writeFileSync(
      path.join(projectPath, 'fe-agent.config.json'),
      JSON.stringify(configContent, null, 2),
      'utf-8'
    );

    console.log(chalk.green('\n✅ 配置初始化完成！'));
    console.log(chalk.dim('  - .env 文件已创建'));
    console.log(chalk.dim('  - fe-agent.config.json 已创建'));
    console.log(chalk.dim('\n使用 fe-agent start 开始使用'));
  });

// 查看日志
program
  .command('logs')
  .description('查看角色日志')
  .option('-r, --role <role>', '查看指定角色日志 (manager/product/architect/tester/reviewer)')
  .option('-d, --date <date>', '查看指定日期日志 (YYYY-MM-DD)')
  .action((options) => {
    const projectPath = process.cwd();
    const config = loadConfig(projectPath);
    const logger = new Logger(config.project.path);

    if (options.role) {
      const logs = logger.getLogs(options.role as any);
      if (logs.length === 0) {
        console.log(chalk.dim('暂无日志'));
      } else {
        console.log(chalk.cyan(`\n📋 ${options.role} 日志：\n`));
        logs.forEach((log) => console.log(log));
      }
    } else {
      const allLogs = logger.getAllLogs();
      console.log(chalk.cyan('\n📋 所有角色日志：\n'));
      for (const [role, logs] of Object.entries(allLogs)) {
        if (logs.length > 0) {
          console.log(chalk.yellow(`\n--- ${role} ---`));
          logs.forEach((log) => console.log(log));
        }
      }
    }
  });

// 查看知识库
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
      const results = knowledge.searchEntries(options.role as any, options.search);
      console.log(chalk.cyan(`\n🔍 ${options.role} 知识库搜索 "${options.search}"：\n`));
      results.forEach((r) => console.log(`- [${r.category}] ${r.content}`));
    } else if (options.role) {
      const entries = knowledge.getEntries(options.role as any);
      console.log(chalk.cyan(`\n📚 ${options.role} 知识库：\n`));
      entries.forEach((e) => console.log(`- [${e.category}] ${e.content} (来源: ${e.source})`));
    } else {
      console.log(chalk.cyan('\n📚 所有知识库：\n'));
      for (const role of ['manager', 'product', 'architect', 'tester', 'reviewer']) {
        const entries = knowledge.getEntries(role as any);
        if (entries.length > 0) {
          console.log(chalk.yellow(`\n--- ${role} (${entries.length}条) ---`));
          entries.slice(0, 10).forEach((e) => console.log(`  - [${e.category}] ${e.content}`));
        }
      }
    }
  });

// 查看状态
program
  .command('status')
  .description('查看项目状态')
  .action(() => {
    const projectPath = process.cwd();
    const agentDir = path.join(projectPath, '.fe-agent');

    console.log(chalk.cyan('\n📊 项目状态：\n'));

    if (!fs.existsSync(agentDir)) {
      console.log(chalk.dim('前端智能体尚未在此项目中运行过'));
      return;
    }

    // 检查各目录
    const dirs = ['logs', 'knowledge', 'skills'];
    for (const dir of dirs) {
      const dirPath = path.join(agentDir, dir);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath, { recursive: true });
        console.log(chalk.green(`  ${dir}/: ${Array.isArray(files) ? files.length : 0} 个文件`));
      } else {
        console.log(chalk.dim(`  ${dir}/: 暂无`));
      }
    }

    // 检查配置
    const configPath = path.join(projectPath, '.env');
    if (fs.existsSync(configPath)) {
      console.log(chalk.green('  配置: 已配置'));
    } else {
      console.log(chalk.yellow('  配置: 未配置'));
    }
  });

program.parse();
