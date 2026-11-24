import { describe, it, expect } from 'vitest';
import { parseCapabilityGap, enrichResultMetadata } from '../src/utils/capability-gap';

describe('parseCapabilityGap', () => {
  it('parses block fields', () => {
    const text = `
done
[NEEDS_NEW_ROLE]
capability: 数据迁移脚本
reason: 后端角色只覆盖 API
tags: data-migration, sql
sensitive: yes
`;
    const gap = parseCapabilityGap(text);
    expect(gap).not.toBeNull();
    expect(gap!.capability).toBe('数据迁移脚本');
    expect(gap!.sensitive).toBe(true);
    expect(gap!.suggestedTags).toContain('sql');
  });

  it('returns null without marker', () => {
    expect(parseCapabilityGap('普通回复')).toBeNull();
  });
});

describe('enrichResultMetadata', () => {
  it('sets needsArchitectSys', () => {
    const meta = enrichResultMetadata('需要改依赖 [NEEDS_ARCHITECT_SYS]');
    expect(meta.needsArchitectSys).toBe(true);
  });
});
