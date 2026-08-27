import { Artifacts } from './file';

/** 构建开发/测试任务正文：优先引用产物，减少重复 token。 */
export function buildScopedTaskContent(
  artifacts: Artifacts,
  side: '后端' | '前端',
  options: { useArtifacts?: boolean; requirement?: string; apiDoc?: string }
): string {
  const { useArtifacts, requirement, apiDoc } = options;

  if (useArtifacts) {
    const req = artifacts.readRequirement();
    const doc = artifacts.readApiDoc();
    return `请根据已审核需求与接口文档编写${side}交付物。

需求与接口文档已写入项目产物：
- 需求：.fe-agent/artifacts/requirement.md${req ? `（约 ${req.length} 字）` : ''}
- 接口文档：.fe-agent/artifacts/api-doc.md${doc ? `（约 ${doc.length} 字）` : ''}

请先阅读产物再执行，不要在回复中重复粘贴全文。`;
  }

  return `请根据以下需求与接口文档编写${side}交付物：

## 需求
${requirement || artifacts.readRequirement() || '（无）'}

## 接口文档
${apiDoc || artifacts.readApiDoc() || '（无）'}`;
}
