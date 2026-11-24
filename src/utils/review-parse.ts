import { Role, IssueLevel, ReviewFeedback, ReviewType, WorkScope, RoleKey } from '../types';
import { resolveReviewTarget, REVIEW_PASSED } from './review-target';

export interface ParsedReview {
  feedbacks: ReviewFeedback[];
  highestLevel: IssueLevel;
  passed: boolean;
  /** 无法解析出问题列表且无通过信号时为 true（应 fail-closed） */
  parseUncertain: boolean;
}

interface StructuredIssue {
  level?: string;
  description?: string;
  content?: string;
  suggestion?: string;
  targetRole?: string;
  location?: string;
}

interface StructuredReview {
  passed?: boolean;
  reviewType?: string;
  issues?: StructuredIssue[];
  summary?: string;
}

const LEVEL_MAP: Record<string, IssueLevel> = {
  高: IssueLevel.HIGH,
  high: IssueLevel.HIGH,
  中: IssueLevel.MEDIUM,
  medium: IssueLevel.MEDIUM,
  低: IssueLevel.LOW,
  low: IssueLevel.LOW,
};

function mapLevel(raw?: string): IssueLevel {
  if (!raw) return IssueLevel.MEDIUM;
  return LEVEL_MAP[raw.trim().toLowerCase()] || LEVEL_MAP[raw.trim()] || IssueLevel.MEDIUM;
}

function mapTargetRole(raw: string | undefined, defaultTarget: RoleKey): RoleKey {
  if (!raw) return defaultTarget;
  const t = raw.trim();
  if (/产品/.test(t)) return Role.PRODUCT;
  if (/架构(?!师)|系统架构|architect_sys|基建/.test(t)) return Role.ARCHITECT_SYS;
  if (/后端/.test(t)) return Role.BACKEND;
  if (/前端|architect(?!_sys)/i.test(t)) return Role.ARCHITECT;
  if (/测试/.test(t)) return Role.TESTER;
  if (/经理|manager/i.test(t)) return Role.MANAGER;
  if (t.startsWith('custom:')) return t as RoleKey;
  return defaultTarget;
}

function getHighestLevel(feedbacks: ReviewFeedback[]): IssueLevel {
  const levels = feedbacks.map((f) => f.level);
  if (levels.includes(IssueLevel.HIGH)) return IssueLevel.HIGH;
  if (levels.includes(IssueLevel.MEDIUM)) return IssueLevel.MEDIUM;
  return IssueLevel.LOW;
}

function hasPassPhrase(text: string): boolean {
  return (
    text.includes(REVIEW_PASSED) ||
    /审查通过|无明显问题|无严重问题|可以继续下一步|无问题，?可以继续/.test(text)
  );
}

function hasFailPhrase(text: string): boolean {
  return /不通过|未通过|需要整改|存在问题|必须修改|请修改/.test(text);
}

function tryParseStructuredJson(text: string): StructuredReview | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1]?.trim(), text.trim()].filter(Boolean) as string[];

  for (const raw of candidates) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as StructuredReview;
      if (parsed && (typeof parsed.passed === 'boolean' || Array.isArray(parsed.issues))) {
        return parsed;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function parseMarkdownIssues(
  reviewContent: string,
  reviewType: ReviewType,
  scope: WorkScope | undefined,
  defaultTarget: RoleKey
): ReviewFeedback[] {
  const feedbacks: ReviewFeedback[] = [];
  const blockPattern =
    /####?\s*问题\s*\d*\s*\[等级[：:]\s*(高|中|低)\]([\s\S]*?)(?=####?\s*问题\s*\d*\s*\[等级|###\s*总体评价|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(reviewContent)) !== null) {
    const level = mapLevel(match[1]);
    const body = match[2] || '';
    const desc =
      body.match(/\*\*描述\*\*\s*[:：]?\s*(.+)/)?.[1]?.trim() ||
      body.match(/-\s*\*\*描述\*\*\s*[:：]?\s*(.+)/)?.[1]?.trim() ||
      match[0].slice(0, 200);
    const suggestion =
      body.match(/\*\*建议\*\*\s*[:：]?\s*(.+)/)?.[1]?.trim() ||
      body.match(/-\s*\*\*建议\*\*\s*[:：]?\s*(.+)/)?.[1]?.trim() ||
      '';
    const targetRaw =
      body.match(/\*\*目标角色\*\*\s*[:：]?\s*(.+)/)?.[1]?.trim() ||
      body.match(/-\s*\*\*目标角色\*\*\s*[:：]?\s*(.+)/)?.[1]?.trim();

    feedbacks.push({
      id: `fb_${Date.now()}_${feedbacks.length}`,
      reviewerRole: Role.REVIEWER,
      targetRole: mapTargetRole(targetRaw, defaultTarget),
      level,
      content: desc,
      suggestion,
      timestamp: new Date(),
      reviewType,
      scope,
    });
  }

  if (feedbacks.length === 0) {
    const levelPattern = /\[等级[：:]\s*(高|中|低)\]/g;
    let levelMatch: RegExpExecArray | null;
    while ((levelMatch = levelPattern.exec(reviewContent)) !== null) {
      feedbacks.push({
        id: `fb_${Date.now()}_${feedbacks.length}`,
        reviewerRole: Role.REVIEWER,
        targetRole: defaultTarget,
        level: mapLevel(levelMatch[1]),
        content: levelMatch[0],
        suggestion: '',
        timestamp: new Date(),
        reviewType,
        scope,
      });
    }
  }

  return feedbacks;
}

/**
 * 解析审查回复：优先 JSON；其次 Markdown 等级块。
 * 无问题列表且无明确通过信号 → parseUncertain，passed=false（fail-closed）。
 */
export function parseReviewResponse(
  reviewContent: string,
  reviewType: ReviewType,
  scope?: WorkScope
): ParsedReview {
  const defaultTarget = resolveReviewTarget(reviewType, scope);
  const structured = tryParseStructuredJson(reviewContent);

  if (structured) {
    const issues = structured.issues || [];
    const feedbacks: ReviewFeedback[] = issues.map((issue, i) => ({
      id: `fb_json_${Date.now()}_${i}`,
      reviewerRole: Role.REVIEWER,
      targetRole: mapTargetRole(issue.targetRole, defaultTarget),
      level: mapLevel(issue.level),
      content: issue.description || issue.content || `问题 ${i + 1}`,
      suggestion: issue.suggestion || '',
      timestamp: new Date(),
      reviewType,
      scope,
    }));

    const highestLevel = feedbacks.length ? getHighestLevel(feedbacks) : IssueLevel.LOW;
    const hasBlocking = feedbacks.some(
      (f) => f.level === IssueLevel.HIGH || f.level === IssueLevel.MEDIUM
    );
    const passed =
      structured.passed === true
        ? !hasBlocking
        : structured.passed === false
          ? false
          : !hasBlocking && (feedbacks.length === 0 || highestLevel === IssueLevel.LOW);

    if (structured.passed === true && feedbacks.length === 0) {
      feedbacks.push({
        id: `fb_json_pass_${Date.now()}`,
        reviewerRole: Role.REVIEWER,
        targetRole: defaultTarget,
        level: IssueLevel.LOW,
        content: REVIEW_PASSED,
        suggestion: structured.summary || '可以继续下一步',
        timestamp: new Date(),
        reviewType,
        scope,
      });
    }

    return {
      feedbacks,
      highestLevel: feedbacks.length ? getHighestLevel(feedbacks) : highestLevel,
      passed: Boolean(passed),
      parseUncertain: false,
    };
  }

  const feedbacks = parseMarkdownIssues(reviewContent, reviewType, scope, defaultTarget);
  const passPhrase = hasPassPhrase(reviewContent);
  const failPhrase = hasFailPhrase(reviewContent);

  if (feedbacks.length === 0) {
    if (passPhrase && !failPhrase) {
      return {
        feedbacks: [
          {
            id: `fb_pass_${Date.now()}`,
            reviewerRole: Role.REVIEWER,
            targetRole: defaultTarget,
            level: IssueLevel.LOW,
            content: REVIEW_PASSED,
            suggestion: '可以继续下一步',
            timestamp: new Date(),
            reviewType,
            scope,
          },
        ],
        highestLevel: IssueLevel.LOW,
        passed: true,
        parseUncertain: false,
      };
    }

    // fail-closed：无法确认通过
    return {
      feedbacks: [
        {
          id: `fb_uncertain_${Date.now()}`,
          reviewerRole: Role.REVIEWER,
          targetRole: defaultTarget,
          level: IssueLevel.MEDIUM,
          content: '审查结果无法可靠解析，默认不通过，请审查员按格式重审或人工确认',
          suggestion: '请使用 JSON 审查格式或明确写出「审查通过」与问题等级',
          timestamp: new Date(),
          reviewType,
          scope,
        },
      ],
      highestLevel: IssueLevel.MEDIUM,
      passed: false,
      parseUncertain: true,
    };
  }

  const highestLevel = getHighestLevel(feedbacks);
  const hasBlocking = feedbacks.some(
    (f) => f.level === IssueLevel.HIGH || f.level === IssueLevel.MEDIUM
  );
  const passed = !hasBlocking && !failPhrase && (passPhrase || highestLevel === IssueLevel.LOW);

  return { feedbacks, highestLevel, passed, parseUncertain: false };
}

/** 经理侧最终判定：尊重解析结果，且正文「通过」不得覆盖中高问题。 */
export function isReviewPassed(
  content: string,
  feedbacks: ReviewFeedback[],
  highestLevel: IssueLevel,
  parsedPassed?: boolean
): boolean {
  if (typeof parsedPassed === 'boolean') {
    return parsedPassed && highestLevel === IssueLevel.LOW;
  }
  if (highestLevel === IssueLevel.HIGH || highestLevel === IssueLevel.MEDIUM) return false;
  if (feedbacks.some((f) => f.content.includes('无法可靠解析'))) return false;
  if (hasPassPhrase(content)) return true;
  if (feedbacks.length === 1 && feedbacks[0].content.includes('审查通过')) return true;
  return false;
}
