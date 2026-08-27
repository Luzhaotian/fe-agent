export enum Role {
  MANAGER = 'manager',
  PRODUCT = 'product',
  ARCHITECT_SYS = 'architect_sys',
  BACKEND = 'backend',
  ARCHITECT = 'architect',
  TESTER = 'tester',
  REVIEWER = 'reviewer',
}

/** 内置角色 + 运行时自定义角色（custom:xxx）。 */
export type RoleKey = Role | `custom:${string}`;

export const RoleName: Record<Role, string> = {
  [Role.MANAGER]: '项目经理',
  [Role.PRODUCT]: '产品',
  [Role.ARCHITECT_SYS]: '架构',
  [Role.BACKEND]: '后端架构',
  [Role.ARCHITECT]: '前端架构',
  [Role.TESTER]: '测试员',
  [Role.REVIEWER]: '审查员',
};

export function getRoleDisplayName(role: RoleKey, customName?: string): string {
  if (customName) return customName;
  if (Object.values(Role).includes(role as Role)) {
    return RoleName[role as Role];
  }
  if (typeof role === 'string' && role.startsWith('custom:')) {
    return role.replace(/^custom:/, '').replace(/-/g, ' ');
  }
  return String(role);
}

export function isBuiltinRole(role: RoleKey): role is Role {
  return Object.values(Role).includes(role as Role);
}

export interface RoleDefinition {
  name: `custom:${string}`;
  displayName: string;
  description: string;
  systemPrompt: string;
  tags: string[];
  skills: string[];
  sensitive?: boolean;
  createdAt: string;
}

export interface CapabilityGap {
  capability: string;
  reason: string;
  suggestedTags?: string[];
  sensitive?: boolean;
}

export enum IssueLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum MessageType {
  TASK = 'task',
  QUESTION = 'question',
  REVIEW_FEEDBACK = 'review_feedback',
  RESULT = 'result',
}

export enum WorkflowStage {
  REQUIREMENT_INPUT = 'requirement_input',
  PRODUCT_ORGANIZE = 'product_organize',
  REVIEW_REQUIREMENT = 'review_requirement',
  ARCH_EVALUATE = 'arch_evaluate',
  REVIEW_API_DOC = 'review_api_doc',
  DEVELOP_BACKEND = 'develop_backend',
  WRITE_BACKEND_TEST = 'write_backend_test',
  REVIEW_BACKEND = 'review_backend',
  DEVELOP_FRONTEND = 'develop_frontend',
  WRITE_FRONTEND_TEST = 'write_frontend_test',
  REVIEW_FRONTEND = 'review_frontend',
  CUSTOM_ROLE = 'custom_role',
  COMPLETE = 'complete',
}

export type ReviewType = 'requirement' | 'api_doc' | 'code' | 'test' | 'code_and_test';
export type WorkScope = 'backend' | 'frontend' | 'infra';

/** 任务复杂度：决定走快路径 / 标准 / 完整关卡 */
export type TaskComplexity = 'simple' | 'standard' | 'full';

export interface AgentMessage {
  id: string;
  from: RoleKey;
  to: RoleKey;
  type: MessageType;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface ReviewFeedback {
  id: string;
  reviewerRole: RoleKey;
  targetRole: RoleKey;
  level: IssueLevel;
  content: string;
  suggestion: string;
  timestamp: Date;
}

export interface LogEntry {
  id: string;
  role: RoleKey;
  action: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeEntry {
  id: string;
  role: RoleKey;
  category: string;
  content: string;
  source: string;
  createdAt: Date;
}

export interface ProjectConfig {
  llm: {
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  project: {
    name: string;
    path: string;
    framework?: string;
    language?: string;
  };
  workflow?: {
    /** 跳过经理开局 LLM 分析，直接分发产品（默认 true） */
    skipManagerAnalysis?: boolean;
    /** 分发开发/测试任务时使用产物引用而非全文（默认 true） */
    useArtifactRefs?: boolean;
    /** 同侧开发与测试并行执行（默认 true） */
    parallelSideWork?: boolean;
    /** 同侧代码+用例合并为一次审查（默认 true；full 复杂度下自动关闭） */
    mergeCodeTestReview?: boolean;
    /** 任务分级：auto 规则判断，或强制 simple/standard/full（默认 auto） */
    taskComplexity?: TaskComplexity | 'auto';
  };
}

export interface WorkflowState {
  stage: WorkflowStage;
  apiDoc?: string;
  reviewFeedbacks: ReviewFeedback[];
  history: AgentMessage[];
  skipBackend?: boolean;
  complexity?: TaskComplexity;
}
