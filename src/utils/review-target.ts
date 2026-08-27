import { Role, ReviewType, WorkScope } from '../types';

/** 根据审查类型与 scope 解析整改目标角色。 */
export function resolveReviewTarget(reviewType: ReviewType, scope?: WorkScope): Role {
  switch (reviewType) {
    case 'requirement':
      return Role.PRODUCT;
    case 'api_doc':
      return Role.ARCHITECT_SYS;
    case 'test':
      return Role.TESTER;
    case 'code':
    case 'code_and_test':
      return scope === 'backend' ? Role.BACKEND : Role.ARCHITECT;
    default:
      return Role.ARCHITECT;
  }
}

/** 合并审查不通过时，需同步整改的角色列表。 */
export function resolveRevisionTargets(reviewType: ReviewType, scope?: WorkScope): Role[] {
  if (reviewType === 'code_and_test') {
    const dev = scope === 'backend' ? Role.BACKEND : Role.ARCHITECT;
    return [dev, Role.TESTER];
  }
  return [resolveReviewTarget(reviewType, scope)];
}

/** 审查通过时的统一表述（经理与审查员共用）。 */
export const REVIEW_PASSED = '审查通过，无严重问题';
