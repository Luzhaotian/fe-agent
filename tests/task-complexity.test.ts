import { describe, it, expect } from 'vitest';
import { classifyTaskComplexity } from '../src/utils/task-complexity';

describe('classifyTaskComplexity', () => {
  it('forces config value', () => {
    const r = classifyTaskComplexity('任意', 'full');
    expect(r.complexity).toBe('full');
  });

  it('marks frontend-only as simple', () => {
    const r = classifyTaskComplexity('微调首页按钮文案和样式');
    expect(r.complexity).toBe('simple');
    expect(r.skipBackendHint).toBe(true);
  });

  it('never marks API requirement as simple', () => {
    const r = classifyTaskComplexity('开发用户登录接口与登录页');
    expect(r.complexity).toBe('standard');
    expect(r.skipBackendHint).toBe(false);
  });

  it('marks infra keywords as full', () => {
    const r = classifyTaskComplexity('做一次数据库迁移和 k8s 部署改造');
    expect(r.complexity).toBe('full');
  });
});
