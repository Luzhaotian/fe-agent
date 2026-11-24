import { describe, it, expect } from 'vitest';
import { resolveRevisionTargets, resolveReviewTarget } from '../src/utils/review-target';
import { Role } from '../src/types';

describe('resolveRevisionTargets', () => {
  it('returns both roles for merged review', () => {
    expect(resolveRevisionTargets('code_and_test', 'backend')).toEqual([
      Role.BACKEND,
      Role.TESTER,
    ]);
    expect(resolveRevisionTargets('code_and_test', 'frontend')).toEqual([
      Role.ARCHITECT,
      Role.TESTER,
    ]);
  });

  it('resolves single targets', () => {
    expect(resolveReviewTarget('requirement')).toBe(Role.PRODUCT);
    expect(resolveReviewTarget('code', 'backend')).toBe(Role.BACKEND);
  });
});
