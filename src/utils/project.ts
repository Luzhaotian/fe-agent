import * as fs from 'fs';
import * as path from 'path';
import { writeFile, readFile, fileExists } from './file';

const SKIP_DIRS = new Set(['node_modules', 'dist']);

/** 扫描项目目录树（默认深度 3），跳过隐藏目录与常见构建产物。 */
export function getProjectStructure(projectPath: string, maxDepth = 3): string {
  const structure: string[] = [];

  const scan = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const indent = '  '.repeat(depth);
        if (entry.isDirectory()) {
          structure.push(`${indent}${entry.name}/`);
          scan(path.join(dir, entry.name), depth + 1);
        } else {
          structure.push(`${indent}${entry.name}`);
        }
      }
    } catch {
      // skip unreadable dirs
    }
  };

  scan(projectPath, 0);
  return structure.join('\n');
}

/** 读取或生成并落盘 role skills 文件。 */
export async function ensureSkillsFile(
  projectPath: string,
  filename: string,
  generate: () => Promise<string>
): Promise<{ content: string; created: boolean }> {
  const skillsPath = path.join(projectPath, '.fe-agent', 'skills', filename);
  if (fileExists(skillsPath)) {
    return { content: readFile(skillsPath) || '', created: false };
  }
  const content = await generate();
  writeFile(skillsPath, content);
  return { content, created: true };
}
