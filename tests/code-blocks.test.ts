import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseCodeBlocks, applyCodeBlocks } from '../src/utils/code-blocks';

describe('parseCodeBlocks', () => {
  it('parses language:filepath headers', () => {
    const text = '```ts:src/a.ts\nexport const a = 1;\n```\n```js\nconsole.log(1)\n```';
    const blocks = parseCodeBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].filepath).toBe('src/a.ts');
    expect(blocks[0].content).toContain('export const a');
    expect(blocks[1].filepath).toBeUndefined();
  });
});

describe('applyCodeBlocks', () => {
  it('writes relative paths and rejects escape', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-agent-'));
    const text = '```ts:hello.ts\nexport {};\n```\n```ts:../escape.ts\nx\n```';
    const result = applyCodeBlocks(dir, text);
    expect(result.written).toContain('hello.ts');
    expect(fs.existsSync(path.join(dir, 'hello.ts'))).toBe(true);
    expect(result.errors.some((e) => e.includes('跳出'))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
