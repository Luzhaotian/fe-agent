import * as fs from 'fs';
import * as path from 'path';
import { Role, RoleName, LogEntry, KnowledgeEntry } from '../types';

const AGENT_DIR = '.fe-agent';

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getAgentDir(projectPath: string): string {
  return path.join(projectPath, AGENT_DIR);
}

// ============ 日志系统 ============

export class Logger {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    ensureDir(path.join(getAgentDir(projectPath), 'logs'));
  }

  private getLogDir(role: Role): string {
    const dir = path.join(getAgentDir(this.projectPath), 'logs', role);
    ensureDir(dir);
    return dir;
  }

  private getLogFilePath(role: Role, date?: Date): string {
    const d = date || new Date();
    const fileName = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.log`;
    return path.join(this.getLogDir(role), fileName);
  }

  log(role: Role, action: string, content: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role,
      action,
      content,
      timestamp: new Date(),
      metadata,
    };

    const logLine = this.formatLogEntry(entry);
    const logFile = this.getLogFilePath(role);

    fs.appendFileSync(logFile, logLine + '\n', 'utf-8');

    // 同时写入全局日志
    const globalLogFile = path.join(getAgentDir(this.projectPath), 'logs', 'global.log');
    fs.appendFileSync(globalLogFile, `[${RoleName[role]}] ${logLine}\n`, 'utf-8');
  }

  private formatLogEntry(entry: LogEntry): string {
    const time = entry.timestamp.toISOString();
    const meta = entry.metadata ? ` | meta: ${JSON.stringify(entry.metadata)}` : '';
    return `[${time}] [${entry.action}] ${entry.content}${meta}`;
  }

  getLogs(role: Role, date?: Date): string[] {
    const logFile = this.getLogFilePath(role, date);
    if (!fs.existsSync(logFile)) return [];
    return fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  }

  getAllLogs(date?: Date): Record<Role, string[]> {
    const result: Partial<Record<Role, string[]>> = {};
    for (const role of Object.values(Role)) {
      result[role as Role] = this.getLogs(role as Role, date);
    }
    return result as Record<Role, string[]>;
  }
}

// ============ 知识库系统 ============

export class KnowledgeBase {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    ensureDir(path.join(getAgentDir(projectPath), 'knowledge'));
  }

  private getKnowledgeDir(role: Role): string {
    const dir = path.join(getAgentDir(this.projectPath), 'knowledge', role);
    ensureDir(dir);
    return dir;
  }

  private getKnowledgeFilePath(role: Role): string {
    return path.join(this.getKnowledgeDir(role), 'knowledge.json');
  }

  addEntry(role: Role, category: string, content: string, source: string): void {
    const entry: KnowledgeEntry = {
      id: `k_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role,
      category,
      content,
      source,
      createdAt: new Date(),
    };

    const entries = this.getEntries(role);
    entries.push(entry);
    this.saveEntries(role, entries);
  }

  getEntries(role: Role): KnowledgeEntry[] {
    const filePath = this.getKnowledgeFilePath(role);
    if (!fs.existsSync(filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return [];
    }
  }

  searchEntries(role: Role, keyword: string): KnowledgeEntry[] {
    const entries = this.getEntries(role);
    return entries.filter(
      (e) =>
        e.content.includes(keyword) ||
        e.category.includes(keyword) ||
        e.source.includes(keyword)
    );
  }

  private saveEntries(role: Role, entries: KnowledgeEntry[]): void {
    const filePath = this.getKnowledgeFilePath(role);
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  // 分析日志并提取知识点
  extractFromLog(role: Role, logContent: string): string[] {
    const newKnowledge: string[] = [];
    // 简单规则：提取包含"发现"、"学到"、"注意"、"经验"等关键词的日志
    const patterns = [/发现[:：](.+)/, /学到[:：](.+)/, /注意[:：](.+)/, /经验[:：](.+)/, /新知识[:：](.+)/];
    for (const pattern of patterns) {
      const match = logContent.match(pattern);
      if (match) {
        newKnowledge.push(match[1].trim());
      }
    }
    return newKnowledge;
  }
}

// ============ 文件工具 ============

export function readFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function writeFile(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function listFiles(dirPath: string, pattern?: RegExp): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      files.push(...listFiles(fullPath, pattern));
    } else if (entry.isFile()) {
      if (!pattern || pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
