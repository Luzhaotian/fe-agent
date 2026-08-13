// 角色枚举
export enum Role {
  MANAGER = 'manager',
  PRODUCT = 'product',
  ARCHITECT_SYS = 'architect_sys',
  BACKEND = 'backend',
  ARCHITECT = 'architect',
  TESTER = 'tester',
  REVIEWER = 'reviewer',
}

// 角色中文名映射
export const RoleName: Record<Role, string> = {
  [Role.MANAGER]: '项目经理',
  [Role.PRODUCT]: '产品',
  [Role.ARCHITECT_SYS]: '架构',
  [Role.BACKEND]: '后端架构',
  [Role.ARCHITECT]: '前端架构',
  [Role.TESTER]: '测试员',
  [Role.REVIEWER]: '审查员',
};

// 问题等级
export enum IssueLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

// 消息类型
export enum MessageType {
  TASK = 'task',
  QUESTION = 'question',
  REVIEW_FEEDBACK = 'review_feedback',
  RESULT = 'result',
  LOG = 'log',
}

// 工作流阶段
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
  FIX_ISSUES = 'fix_issues',
  COMPLETE = 'complete',
}

export type ReviewType = 'requirement' | 'api_doc' | 'code' | 'test';
export type WorkScope = 'backend' | 'frontend' | 'infra';

// Agent 消息
export interface AgentMessage {
  id: string;
  from: Role;
  to: Role;
  type: MessageType;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// 审查反馈
export interface ReviewFeedback {
  id: string;
  reviewerRole: Role;
  targetRole: Role;
  level: IssueLevel;
  content: string;
  suggestion: string;
  timestamp: Date;
}

// 需求文档
export interface Requirement {
  id: string;
  title: string;
  description: string;
  source: 'user' | 'url' | 'expanded';
  originalContent: string;
  organizedContent: string;
  status: 'draft' | 'reviewed' | 'approved' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

// 代码产物
export interface CodeArtifact {
  id: string;
  requirementId: string;
  files: CodeFile[];
  status: 'draft' | 'reviewed' | 'approved' | 'rejected';
  createdAt: Date;
}

export interface CodeFile {
  path: string;
  content: string;
  description: string;
}

// 测试用例
export interface TestCase {
  id: string;
  requirementId: string;
  name: string;
  description: string;
  steps: string[];
  expected: string;
  status: 'draft' | 'reviewed' | 'approved' | 'rejected';
}

// 日志条目
export interface LogEntry {
  id: string;
  role: Role;
  action: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// 知识条目
export interface KnowledgeEntry {
  id: string;
  role: Role;
  category: string;
  content: string;
  source: string;
  createdAt: Date;
}

// 项目配置
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
}

// 工作流状态
export interface WorkflowState {
  stage: WorkflowStage;
  requirement?: Requirement;
  apiDoc?: string;
  backendArtifacts: CodeArtifact[];
  frontendArtifacts: CodeArtifact[];
  testCases: TestCase[];
  reviewFeedbacks: ReviewFeedback[];
  pendingQuestions: AgentMessage[];
  history: AgentMessage[];
  skipBackend?: boolean;
}
