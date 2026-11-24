/** 代码类角色共用的输出格式说明。 */
export const CODE_OUTPUT_HINT = `代码输出格式：
\`\`\`language:filepath
// 代码内容
\`\`\`

每个文件用一个代码块输出，并说明文件路径。
若发现需要改基建/目录/依赖等非业务内容，在回复中标注 [NEEDS_ARCHITECT_SYS] 并说明原因。
若发现需要现有角色无法提供的能力，在回复中标注：
[NEEDS_NEW_ROLE]
capability: <所需能力简述>
reason: <为何现有角色无法处理>
tags: <逗号分隔标签>
sensitive: yes/no（涉及部署、删数据、生产环境等为 yes）`;

/** 测试员：产出可执行的 Playwright 用例。 */
export const PLAYWRIGHT_TEST_HINT = `统一使用 Playwright（@playwright/test），输出可直接落地的测试文件，不要写 Markdown 步骤清单。

输出格式（每个文件一个代码块）：
\`\`\`ts:e2e/<name>.spec.ts
import { test, expect } from '@playwright/test';
// ...
\`\`\`

约定：
- 前端（scope=frontend）：浏览器 E2E，用 page / locator；路径优先 e2e/ 或 tests/e2e/
- 后端（scope=backend）：用 Playwright request fixture 做 API 测试；路径优先 e2e/api/ 或 tests/api/
- test / test.describe 标题可用中文；断言明确；覆盖正常与异常/边界
- 选择器优先 role / label / placeholder / testid，避免脆弱 CSS
- 需要 baseURL、鉴权头等时用测试内注释或 test.use 说明，勿写死生产密钥
- 若项目尚无 Playwright，在回复末尾简要说明需安装 @playwright/test 与建议的 playwright.config.ts（可另给代码块）
- 基建/依赖安装需求可标注 [NEEDS_ARCHITECT_SYS]
- 能力不足时标注 [NEEDS_NEW_ROLE] 块`;
