import * as fs from 'fs';
import * as path from 'path';
import { ensureDir, writeFile } from './file';

export interface CodeBlock {
  language: string;
  filepath?: string;
  content: string;
}

/** 解析 ```lang:path 或 ```lang 代码块。 */
export function parseCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const header = (match[1] || '').trim();
    const content = match[2].replace(/\n$/, '');
    let language = header;
    let filepath: string | undefined;

    if (header.includes(':')) {
      const [lang, ...rest] = header.split(':');
      language = lang.trim() || 'text';
      const fp = rest.join(':').trim();
      if (fp) filepath = fp;
    } else if (header.includes(' ')) {
      const parts = header.split(/\s+/);
      language = parts[0] || 'text';
      if (parts[1]) filepath = parts[1];
    }

    blocks.push({ language, filepath, content });
  }

  return blocks;
}

export interface ApplyResult {
  written: string[];
  skipped: string[];
  errors: string[];
}

/**
 * 将带路径的代码块写入项目（相对 projectRoot）。
 * 拒绝绝对路径与跳出项目根的路径。
 */
export function applyCodeBlocks(
  projectRoot: string,
  text: string,
  options?: { dryRun?: boolean }
): ApplyResult {
  const written: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const root = path.resolve(projectRoot);

  for (const block of parseCodeBlocks(text)) {
    if (!block.filepath) {
      skipped.push(`(无路径 ${block.language})`);
      continue;
    }

    const resolved = path.resolve(root, block.filepath);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      errors.push(`拒绝路径跳出项目: ${block.filepath}`);
      continue;
    }

    if (options?.dryRun) {
      written.push(path.relative(root, resolved));
      continue;
    }

    try {
      ensureDir(path.dirname(resolved));
      fs.writeFileSync(resolved, block.content, 'utf-8');
      written.push(path.relative(root, resolved));
    } catch (err) {
      errors.push(`${block.filepath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { written, skipped, errors };
}

/** 将交付物全文与解析出的代码块索引写入 artifacts。 */
export function saveDeliverableArtifact(
  artifactsDir: string,
  name: string,
  content: string
): { artifactPath: string; blockCount: number } {
  ensureDir(artifactsDir);
  const artifactPath = path.join(artifactsDir, name);
  writeFile(artifactPath, content);

  const blocks = parseCodeBlocks(content).filter((b) => b.filepath);
  if (blocks.length > 0) {
    const index = blocks
      .map((b) => `- \`${b.filepath}\` (${b.language}, ${b.content.length} chars)`)
      .join('\n');
    writeFile(path.join(artifactsDir, `${name}.index.md`), `# ${name} 文件索引\n\n${index}\n`);
  }

  return { artifactPath, blockCount: blocks.length };
}
