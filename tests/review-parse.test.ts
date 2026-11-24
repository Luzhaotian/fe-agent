import { describe, it, expect } from 'vitest';
import { parseReviewResponse, isReviewPassed } from '../src/utils/review-parse';
import { IssueLevel } from '../src/types';
import { REVIEW_PASSED } from '../src/utils/review-target';

describe('parseReviewResponse', () => {
  it('parses JSON passed=true', () => {
    const text = '```json\n{"passed":true,"issues":[],"summary":"审查通过"}\n```';
    const parsed = parseReviewResponse(text, 'requirement');
    expect(parsed.passed).toBe(true);
    expect(parsed.parseUncertain).toBe(false);
    expect(parsed.highestLevel).toBe(IssueLevel.LOW);
  });

  it('parses JSON with high issue as not passed', () => {
    const text = JSON.stringify({
      passed: false,
      issues: [
        {
          level: '高',
          description: '缺验收标准',
          suggestion: '补充',
          targetRole: '产品',
        },
      ],
    });
    const parsed = parseReviewResponse(text, 'requirement');
    expect(parsed.passed).toBe(false);
    expect(parsed.highestLevel).toBe(IssueLevel.HIGH);
    expect(parsed.feedbacks[0].targetRole).toBe('product');
  });

  it('fail-closed when format unknown', () => {
    const parsed = parseReviewResponse('随便写点什么，没有等级也没有通过', 'code', 'backend');
    expect(parsed.passed).toBe(false);
    expect(parsed.parseUncertain).toBe(true);
    expect(parsed.highestLevel).toBe(IssueLevel.MEDIUM);
  });

  it('accepts markdown pass phrase', () => {
    const parsed = parseReviewResponse(`总体评价：${REVIEW_PASSED}`, 'api_doc');
    expect(parsed.passed).toBe(true);
  });

  it('parses markdown level blocks', () => {
    const text = `
## 审查报告
#### 问题1 [等级：中]
- **描述**: 缺错误码
- **建议**: 补充
- **目标角色**: 架构
### 总体评价
需要整改
`;
    const parsed = parseReviewResponse(text, 'api_doc');
    expect(parsed.passed).toBe(false);
    expect(parsed.highestLevel).toBe(IssueLevel.MEDIUM);
  });
});

describe('isReviewPassed', () => {
  it('never passes on medium/high', () => {
    expect(isReviewPassed(REVIEW_PASSED, [], IssueLevel.MEDIUM, true)).toBe(false);
    expect(isReviewPassed(REVIEW_PASSED, [], IssueLevel.HIGH)).toBe(false);
  });

  it('respects parsedPassed flag', () => {
    expect(isReviewPassed('ok', [], IssueLevel.LOW, true)).toBe(true);
    expect(isReviewPassed('ok', [], IssueLevel.LOW, false)).toBe(false);
  });
});
