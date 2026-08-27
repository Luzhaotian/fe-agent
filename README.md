# 全栈智能体（Full-Stack Agent）

> 多角色协作的全栈开发 AI 助手

通过模拟真实研发团队协作，自动完成需求整理、架构评估、接口契约、后端实现、前端实现与测试审查。CLI 包名仍为 `fe-agent`（兼容既有安装与命令）。

## 核心特性

- **7 个 AI 角色协作**：项目经理、产品、架构、后端架构、前端架构、测试员、审查员
- **动态扩角色**：执行中若现有角色无法处理，自动匹配或创建自定义角色（落盘 `.fe-agent/roles/`）
- **全栈覆盖**：同一链路打通接口文档 → 后端 → 前端，而不是只写页面
- **后端优先**：先出接口文档并轻量审查，再写后端，最后写前端
- **架构角色**：处理非业务基建改动，并产出接口文档
- **项目感知**：按项目结构与 skills 开发，优先复用已有模块/组件
- **知识库积累**：按角色落盘日志与知识
- **分级问题处理**：低/中/高，高级交用户决策

## 角色说明

| 角色 | 职责 |
|------|------|
| **项目经理** | 统筹分发，问题分级，协调审查与关卡推进 |
| **产品** | 整理需求（含后端能力与数据实体） |
| **架构** | 非业务改动；产出接口文档；开发前评估 + 过程中按需介入 |
| **后端架构** | 按接口文档实现后端，生成 backend skills |
| **前端架构** | 按接口文档 + 需求实现前端 |
| **测试员** | 先后端用例，再前端用例 |
| **审查员** | 审需求；轻量审接口文档；审后端/前端代码与测试 |

## 安装

```bash
npm install -g fe-agent
# 或
npx fe-agent start -r "你的需求描述"
```

从源码：

```bash
git clone <repo>
cd fe-agent
npm install
npm run build
npm link
```

## 使用

### 初始化

```bash
fe-agent init
```

或手动配置 `.env`：

```env
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
```

### 启动

```bash
fe-agent start
fe-agent start -r "开发用户登录：含登录接口与登录页"
fe-agent start -f requirements.md
fe-agent start -u https://example.com/requirements
```

### 日志 / 知识库 / 状态

```bash
fe-agent logs
fe-agent logs -r backend
fe-agent logs -r architect_sys
fe-agent knowledge
fe-agent knowledge -r architect
fe-agent roles
fe-agent status
```

## 工作流程

整体由**项目经理**串起：接收各方结果 → 决定下一跳 → 有问题则整改回路，通过则进入下一关卡。

```mermaid
flowchart TD
  U[用户需求] --> M1[项目经理]
  M1 -->|分发| P[产品：整理需求]
  P -->|RESULT| M2[项目经理]
  M2 -->|送审| R1[审查员：审需求]
  R1 -->|有问题| M2
  M2 -->|整改| P
  R1 -->|通过| M3[项目经理]
  M3 -->|分发| A[架构：评估基建 + 产出接口文档]
  A -->|写入 api-doc.md| M4[项目经理]
  M4 -->|轻量送审| R2[审查员：审接口文档<br/>路径/入参/出参/错误码]
  R2 -->|有问题| M4
  M4 -->|整改| A
  R2 -->|通过| M5[项目经理]

  M5 -->|无需后端 SKIP| M7
  M5 -->|需要后端| B[后端架构：实现]
  M5 -->|同批| TB[测试员：后端用例]
  B -->|RESULT| M6[项目经理]
  TB -->|RESULT| M6
  M6 -->|送审| R3[审查员：审后端代码/用例]
  R3 -->|有问题| M6
  M6 -->|整改| B
  M6 -->|整改| TB
  R3 -->|后端关卡通过| M7[项目经理]

  M7 --> F[前端架构：按接口文档实现]
  M7 -->|同批| TF[测试员：前端用例]
  F -->|RESULT| M8[项目经理]
  TF -->|RESULT| M8
  M8 -->|送审| R4[审查员：审前端代码/用例]
  R4 -->|有问题| M8
  M8 -->|整改| F
  M8 -->|整改| TF
  R4 -->|前端关卡通过| Done[交付完成]

  X[任意角色发现非业务改动] -.->|needsArchitectSys| M9[项目经理]
  M9 -.->|按需分发| A2[架构：处理基建]
  A2 -.->|完成后恢复原阶段| M9
```

**执行顺序要点：**

1. 消息驱动：角色之间不直接调用，一律经项目经理分发。
2. **任务分级**：开局按规则分为 `simple` / `standard` / `full`（可配置强制）。
3. 关卡制（standard/full）：接口文档过审后才进后端；后端过审后才进前端。
4. **同批并行**：同一关卡内「开发」与「写用例」默认并行执行。
5. **合并审查**（simple/standard）：同侧代码+用例一次审完；full 仍分审。
6. **快路径（simple）**：产品整理 → 前端开发∥用例 → 一次合并审查 → 完成（跳过需求审、架构、接口审、后端）。
7. 捷径：架构标注无需后端时，跳过后端关卡直达前端。
8. 旁路：基建/目录/依赖等非业务改动，随时转给架构，处理完再回到原阶段。
9. 高级问题：审查或提问为「高」时打断，询问用户后再继续。
10. 动态角色：`[NEEDS_NEW_ROLE]` 或规则匹配缺口时自动创建/委派；敏感能力需用户确认。

## 动态角色

内置 7 角色覆盖常规全栈流程。当执行中发现能力缺口时：

1. **A 触发（主）**：任意角色在回复中标注能力缺口：
   ```
   [NEEDS_NEW_ROLE]
   capability: 数据迁移脚本
   reason: 后端角色只覆盖 API，不负责一次性存量迁移
   tags: data-migration, sql
   sensitive: no
   ```
2. **B 触发（辅）**：需求审查通过后，经理按标签/关键词规则匹配已有自定义角色。
3. **自动创建**：无匹配时由 LLM 生成角色定义，写入 `.fe-agent/roles/<name>.json`，并立即委派执行。
4. **完成后**：自定义角色交回经理，恢复原流程。

查看已创建角色：`fe-agent roles`

## 链路加速

| 优化项 | 说明 |
|--------|------|
| 任务分级快路径 | `simple` 跳过需求审/架构/接口审/后端 |
| 同批并行 | 开发与测试并行（`parallelSideWork`） |
| 合并审查 | 同侧代码+用例一次审（`mergeCodeTestReview`；`full` 自动关闭） |
| 跳过经理开局分析 | 默认不再为分发多调一次 LLM |
| 产物引用 | 开发/测试引用 artifacts，少重复粘贴全文 |
| 知识库检索 | 按词匹配，避免无效知识塞进 prompt |

`fe-agent.config.json` 可配置：

```json
{
  "workflow": {
    "skipManagerAnalysis": true,
    "useArtifactRefs": true,
    "parallelSideWork": true,
    "mergeCodeTestReview": true,
    "taskComplexity": "auto"
  }
}
```

`taskComplexity`：`auto`（默认规则判断）| `simple` | `standard` | `full`。

## 项目结构（运行时）

```
.fe-agent/
├── logs/            # 按角色日志（含 architect_sys / backend）
├── knowledge/       # 按角色知识库
├── skills/
│   ├── architect.md
│   ├── backend.md
│   └── architect_sys.md
├── roles/           # 运行时自动创建的自定义角色
└── artifacts/
    ├── api-doc.md       # 当前任务接口文档
    └── requirement.md   # 当前任务需求
```

## 配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | LLM API 密钥 | 必填 |
| `LLM_BASE_URL` | LLM API 地址 | `https://api.openai.com/v1` |
| `LLM_MODEL` | 模型名称 | `gpt-4o` |
| `LLM_TEMPERATURE` | 温度 | `0.7` |
| `LLM_MAX_TOKENS` | 最大 token | `4096` |

`fe-agent.config.json`：

```json
{
  "project": {
    "name": "my-project",
    "framework": "react",
    "language": "typescript"
  }
}
```

## 开发

```bash
npm install
npm run dev start -r "需求"
npm run build
npm start
```

## License

MIT
