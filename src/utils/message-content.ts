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

/** 构建审查任务正文：优先引用已落盘的代码/用例产物。 */
export function buildReviewTaskContent(
  artifacts: Artifacts,
  scope: 'backend' | 'frontend',
  kind: 'code' | 'test' | 'code_and_test',
  fallback: { code?: string; test?: string },
  useArtifacts: boolean
): string {
  const side = scope === 'backend' ? '后端' : '前端';

  if (useArtifacts) {
    if (kind === 'code_and_test') {
      const codePath = artifacts.saveCode(scope, fallback.code || '');
      const testPath = artifacts.saveTests(scope, fallback.test || '');
      return `请合并审查以下${side}代码与测试用例（一次给出结论）。

产物路径：
- 代码：${artifacts.getRelativeArtifactPath(codePath)}
- 用例：${artifacts.getRelativeArtifactPath(testPath)}

请阅读产物后输出审查报告；不要在回复中重复粘贴全文。`;
    }

    if (kind === 'code') {
      const codePath = artifacts.saveCode(scope, fallback.code || '');
      return `请审查以下${side}代码。

产物路径：${artifacts.getRelativeArtifactPath(codePath)}

请阅读产物后输出审查报告。`;
    }

    const testPath = artifacts.saveTests(scope, fallback.test || '');
    return `请审查以下${side}测试用例。

产物路径：${artifacts.getRelativeArtifactPath(testPath)}

请阅读产物后输出审查报告。`;
  }

  if (kind === 'code_and_test') {
    return `请合并审查以下${side}代码与测试用例：\n\n## 代码\n${fallback.code || ''}\n\n## 测试用例\n${fallback.test || ''}`;
  }
  if (kind === 'code') {
    return `请审查以下代码：\n${fallback.code || ''}`;
  }
  return `请审查以下测试用例：\n${fallback.test || ''}`;
}
