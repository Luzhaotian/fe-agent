import * as fs from 'fs';
import * as path from 'path';
import { Role, RoleKey, LogEntry, KnowledgeEntry, getRoleDisplayName, WorkflowState } from '../types';
import { saveDeliverableArtifact } from './code-blocks';

const AGENT_DIR = '.fe-agent';
const DEFAULT_MAX_KNOWLEDGE = 200;

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getAgentDir(projectPath: string): string {
  return path.join(projectPath, AGENT_DIR);
}

export function getFeAgentDir(projectPath: string): string {
  return getAgentDir(projectPath);
}

// ============ 日志系统 ============

export class Logger {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    ensureDir(path.join(getAgentDir(projectPath), 'logs'));
  }

  private getLogDir(role: RoleKey): string {
    const dir = path.join(getAgentDir(this.projectPath), 'logs', String(role));
    ensureDir(dir);
    return dir;
  }

  private getLogFilePath(role: RoleKey, date?: Date): string {
    const d = date || new Date();
    const fileName = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.log`;
    return path.join(this.getLogDir(role), fileName);
  }

  log(role: RoleKey, action: string, content: string, metadata?: Record<string, unknown>): void {
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

    const globalLogFile = path.join(getAgentDir(this.projectPath), 'logs', 'global.log');
    fs.appendFileSync(globalLogFile, `[${getRoleDisplayName(role)}] ${logLine}\n`, 'utf-8');
  }

  private formatLogEntry(entry: LogEntry): string {
    const time = entry.timestamp.toISOString();
    const meta = entry.metadata ? ` | meta: ${JSON.stringify(entry.metadata)}` : '';
    return `[${time}] [${entry.action}] ${entry.content}${meta}`;
  }

  getLogs(role: RoleKey, date?: Date): string[] {
    const logFile = this.getLogFilePath(role, date);
    if (!fs.existsSync(logFile)) return [];
    return fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  }

  getAllLogs(date?: Date): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    const logsRoot = path.join(getAgentDir(this.projectPath), 'logs');
    if (!fs.existsSync(logsRoot)) return result;

    for (const entry of fs.readdirSync(logsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      result[entry.name] = this.getLogs(entry.name as RoleKey, date);
    }
    return result;
  }
}

// ============ 知识库系统 ============

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s，。、；：""''（）()\[\]{}|/\\,.;:!?？！\n\r\t_-]+/)
    .flatMap((t) => {
      if (t.length < 2) return [];
      // 中文按 2-gram 粗切，提升短句命中
      if (/[\u4e00-\u9fff]/.test(t) && t.length > 4) {
        const grams: string[] = [t];
        for (let i = 0; i < t.length - 1; i++) grams.push(t.slice(i, i + 2));
        return grams;
      }
      return [t];
    });
}

export class KnowledgeBase {
  private projectPath: string;
  private maxEntries: number;
  /** 同步临界区标记：同 role 重入时先入队，避免并行回调交错丢写 */
  private busy = new Set<string>();
  private pending = new Map<string, Array<{ category: string; content: string; source: string }>>();

  constructor(projectPath: string, maxEntries = DEFAULT_MAX_KNOWLEDGE) {
    this.projectPath = projectPath;
    this.maxEntries = maxEntries;
    ensureDir(path.join(getAgentDir(projectPath), 'knowledge'));
  }

  private getKnowledgeDir(role: RoleKey): string {
    const dir = path.join(getAgentDir(this.projectPath), 'knowledge', String(role));
    ensureDir(dir);
    return dir;
  }

  private getKnowledgeFilePath(role: RoleKey): string {
    return path.join(this.getKnowledgeDir(role), 'knowledge.json');
  }

  addEntry(role: RoleKey, category: string, content: string, source: string): void {
    const key = String(role);
    const trimmed = content.trim();
    if (!trimmed) return;

    if (this.busy.has(key)) {
      const q = this.pending.get(key) || [];
      q.push({ category, content: trimmed, source });
      this.pending.set(key, q);
      return;
    }

    this.busy.add(key);
    try {
      this.writeOne(role, category, trimmed, source);
      const q = this.pending.get(key) || [];
      while (q.length > 0) {
        const next = q.shift()!;
        this.writeOne(role, next.category, next.content, next.source);
      }
    } finally {
      this.busy.delete(key);
    }
  }

  private writeOne(role: RoleKey, category: string, content: string, source: string): void {
    const entries = this.getEntries(role);
    if (entries.some((e) => e.category === category && e.content === content)) return;

    entries.push({
      id: `k_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role,
      category,
      content,
      source,
      createdAt: new Date(),
    });
    while (entries.length > this.maxEntries) {
      entries.shift();
    }
    this.saveEntries(role, entries);
  }

  getEntries(role: RoleKey): KnowledgeEntry[] {
    const filePath = this.getKnowledgeFilePath(role);
    if (!fs.existsSync(filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return [];
    }
  }

  searchEntries(role: RoleKey, keyword: string, limit = 5): KnowledgeEntry[] {
    const entries = this.getEntries(role);
    if (!keyword.trim()) return entries.slice(-limit);

    const queryTokens = new Set(tokenize(keyword));
    const scored = entries
      .map((e) => {
        let score = 0;
        if (e.content.includes(keyword) || e.category.includes(keyword) || e.source.includes(keyword)) {
          score += 10;
        }
        const tokens = tokenize(`${e.category} ${e.content} ${e.source}`);
        for (const t of tokens) {
          if (queryTokens.has(t)) score += 1;
        }
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((x) => x.e);
  }

  private saveEntries(role: RoleKey, entries: KnowledgeEntry[]): void {
    const filePath = this.getKnowledgeFilePath(role);
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
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

// ============ 产物系统 ============

export class Artifacts {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    ensureDir(path.join(getAgentDir(projectPath), 'artifacts'));
  }

  private getArtifactsDir(): string {
    return path.join(getAgentDir(this.projectPath), 'artifacts');
  }

  getApiDocPath(): string {
    return path.join(this.getArtifactsDir(), 'api-doc.md');
  }

  saveApiDoc(content: string): void {
    writeFile(this.getApiDocPath(), content);
  }

  readApiDoc(): string | null {
    return readFile(this.getApiDocPath());
  }

  getRequirementPath(): string {
    return path.join(this.getArtifactsDir(), 'requirement.md');
  }

  saveRequirement(content: string): void {
    writeFile(this.getRequirementPath(), content);
  }

  readRequirement(): string | null {
    return readFile(this.getRequirementPath());
  }

  saveCode(scope: 'backend' | 'frontend', content: string): string {
    const name = scope === 'backend' ? 'backend-code.md' : 'frontend-code.md';
    const { artifactPath } = saveDeliverableArtifact(this.getArtifactsDir(), name, content);
    return artifactPath;
  }

  readCode(scope: 'backend' | 'frontend'): string | null {
    const name = scope === 'backend' ? 'backend-code.md' : 'frontend-code.md';
    return readFile(path.join(this.getArtifactsDir(), name));
  }

  saveTests(scope: 'backend' | 'frontend', content: string): string {
    const name = scope === 'backend' ? 'backend-tests.md' : 'frontend-tests.md';
    writeFile(path.join(this.getArtifactsDir(), name), content);
    return path.join(this.getArtifactsDir(), name);
  }

  readTests(scope: 'backend' | 'frontend'): string | null {
    const name = scope === 'backend' ? 'backend-tests.md' : 'frontend-tests.md';
    return readFile(path.join(this.getArtifactsDir(), name));
  }

  getRelativeArtifactPath(absolutePath: string): string {
    return path.relative(this.projectPath, absolutePath);
  }
}

// ============ 工作流快照 ============

export function saveWorkflowSnapshot(projectPath: string, state: WorkflowState): void {
  const dir = path.join(getAgentDir(projectPath), 'state');
  ensureDir(dir);
  const serializable = {
    ...state,
    updatedAt: new Date().toISOString(),
    history: state.history.slice(-50).map((m) => ({
      id: m.id,
      from: m.from,
      to: m.to,
      type: m.type,
      content: m.content.slice(0, 500),
      timestamp: m.timestamp,
      metadata: m.metadata
        ? {
            reviewType: m.metadata.reviewType,
            scope: m.metadata.scope,
            workflowComplete: m.metadata.workflowComplete,
            complexity: m.metadata.complexity,
            skipBackend: m.metadata.skipBackend,
          }
        : undefined,
    })),
    reviewFeedbacks: state.reviewFeedbacks.slice(-30),
  };
  writeFile(path.join(dir, 'workflow.json'), JSON.stringify(serializable, null, 2));
}

export function readWorkflowSnapshot(projectPath: string): WorkflowState | null {
  const filePath = path.join(getAgentDir(projectPath), 'state', 'workflow.json');
  const raw = readFile(filePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorkflowState;
  } catch {
    return null;
  }
}
