export enum Role {
  MANAGER = 'manager',
  PRODUCT = 'product',
  ARCHITECT_SYS = 'architect_sys',
  BACKEND = 'backend',
  ARCHITECT = 'architect',
  TESTER = 'tester',
  REVIEWER = 'reviewer',
}

export const RoleName: Record<Role, string> = {
  [Role.MANAGER]: '项目经理',
  [Role.PRODUCT]: '产品',
  [Role.ARCHITECT_SYS]: '架构',
  [Role.BACKEND]: '后端架构',
  [Role.ARCHITECT]: '前端架构',
  [Role.TESTER]: '测试员',
  [Role.REVIEWER]: '审查员',
};

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
  COMPLETE = 'complete',
}

export type ReviewType = 'requirement' | 'api_doc' | 'code' | 'test';
export type WorkScope = 'backend' | 'frontend' | 'infra';

export interface AgentMessage {
  id: string;
  from: Role;
  to: Role;
  type: MessageType;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface ReviewFeedback {
  id: string;
  reviewerRole: Role;
  targetRole: Role;
  level: IssueLevel;
  content: string;
  suggestion: string;
  timestamp: Date;
}

export interface LogEntry {
  id: string;
  role: Role;
  action: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeEntry {
  id: string;
  role: Role;
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
}

export interface WorkflowState {
  stage: WorkflowStage;
  apiDoc?: string;
  reviewFeedbacks: ReviewFeedback[];
  history: AgentMessage[];
  skipBackend?: boolean;
}
