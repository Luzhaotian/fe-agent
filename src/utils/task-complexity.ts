import { TaskComplexity } from '../types';

export interface ComplexityResult {
  complexity: TaskComplexity;
  reason: string;
  /** simple 路径暗示无需后端 */
  skipBackendHint: boolean;
}

const FRONTEND_ONLY =
  /页面|组件|样式|文案|UI|按钮|弹窗|表单样式|css|tsx|jsx|改一下文案|微调|排版|图标/;
const BACKEND_SIGNAL =
  /接口|API|api|后端|服务端|数据库|鉴权|登录|注册|CRUD|增删改查|服务端|REST|GraphQL/;
const FULL_SIGNAL =
  /迁移|部署|基建|重构|权限体系|多租户|微服务|数据清洗|多端|灰度|监控|基础设施|devops|k8s|kubernetes/;

/**
 * 规则分级（不调 LLM）。
 * simple：短且偏前端小改；full：复杂/基建向；其余 standard。
 */
export function classifyTaskComplexity(
  text: string,
  forced?: TaskComplexity | 'auto'
): ComplexityResult {
  if (forced && forced !== 'auto') {
    return {
      complexity: forced,
      reason: `配置强制为 ${forced}`,
      skipBackendHint: forced === 'simple',
    };
  }

  const trimmed = text.trim();
  const len = trimmed.length;

  if (FULL_SIGNAL.test(trimmed) || len > 1500) {
    return {
      complexity: 'full',
      reason: len > 1500 ? '需求较长，走完整关卡' : '命中复杂/基建关键词，走完整关卡',
      skipBackendHint: false,
    };
  }

  const frontendOnly = FRONTEND_ONLY.test(trimmed) && !BACKEND_SIGNAL.test(trimmed);
  const shortAndLight = len > 0 && len <= 280 && !BACKEND_SIGNAL.test(trimmed);

  if ((frontendOnly || shortAndLight) && len <= 400) {
    return {
      complexity: 'simple',
      reason: frontendOnly
        ? '偏前端小改且无后端信号，走快路径'
        : '需求简短且无后端信号，走快路径',
      skipBackendHint: true,
    };
  }

  return {
    complexity: 'standard',
    reason: '常规全栈/业务需求，走标准关卡（并行+合并审查）',
    skipBackendHint: false,
  };
}
