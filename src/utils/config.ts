import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { ProjectConfig } from '../types';
import { fileExists } from './file';

const CONFIG_FILE = '.env';
const LOCAL_CONFIG_FILE = 'fe-agent.config.json';

export function loadConfig(projectPath: string): ProjectConfig {
  // 加载 .env
  const envPath = path.join(projectPath, CONFIG_FILE);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  // 加载本地配置
  const localConfigPath = path.join(projectPath, LOCAL_CONFIG_FILE);
  let localConfig: Partial<ProjectConfig> = {};
  if (fs.existsSync(localConfigPath)) {
    try {
      localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  const config: ProjectConfig = {
    llm: {
      apiKey: process.env.LLM_API_KEY || localConfig.llm?.apiKey || '',
      baseUrl: process.env.LLM_BASE_URL || localConfig.llm?.baseUrl || 'https://api.openai.com/v1',
      model: process.env.LLM_MODEL || localConfig.llm?.model || 'gpt-4o',
      temperature: Number(process.env.LLM_TEMPERATURE) || localConfig.llm?.temperature || 0.7,
      maxTokens: Number(process.env.LLM_MAX_TOKENS) || localConfig.llm?.maxTokens || 4096,
    },
    project: {
      name: localConfig.project?.name || path.basename(projectPath),
      path: projectPath,
      framework: localConfig.project?.framework,
      language: localConfig.project?.language,
    },
  };

  return config;
}

export function validateConfig(config: ProjectConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.llm.apiKey) {
    errors.push('缺少 LLM_API_KEY，请在 .env 文件中配置或在环境变量中设置');
  }

  if (!config.llm.baseUrl) {
    errors.push('缺少 LLM_BASE_URL，请在 .env 文件中配置');
  }

  return { valid: errors.length === 0, errors };
}

export function initConfig(projectPath: string): void {
  const envExamplePath = path.join(projectPath, '.env.example');
  const envPath = path.join(projectPath, '.env');

  if (!fileExists(envPath) && fileExists(envExamplePath)) {
    console.log('📝 未找到 .env 文件，请根据 .env.example 创建 .env 文件并填入配置');
  }
}
