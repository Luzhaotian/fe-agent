# Fullstack Roles Extension Design

**Date:** 2026-08-13  
**Status:** Approved (design discussion)  
**Approach:** Extend existing message-driven orchestration (Option 1)

## Summary

Extend FE-Agent from frontend-only multi-role collaboration to fullstack development, while preserving the current manager-centric message flow. Backend is developed first; a system architect role owns non-business infrastructure changes and API contracts; frontend consumes the reviewed API document.

## Goals

- Add backend development with the same collaboration patterns as frontend (skills, project awareness, review, knowledge, logs).
- Enforce order: **backend + API contract before frontend**.
- Introduce a **system architect** role for non-business project changes and API documentation.
- Keep token/resource cost reasonable (lightweight API-doc review; single tester role).

## Non-Goals

- Mandatory OpenAPI generation or schema tooling.
- Actually executing tests in CI/runtime (still generate cases only, same as today).
- Splitting tester into separate frontend/backend roles.
- Rewriting orchestration into a hard-coded finite-state-machine engine.
- Renaming the npm package `fe-agent` (docs may say fullstack; rename is optional later).

## Roles

| Role (CN) | Role ID | Responsibility |
|-----------|---------|----------------|
| 项目经理 | `manager` | Dispatch tasks; grade issues; coordinate review and fixes |
| 产品 | `product` | Organize/expand requirements (frontend + backend capability) |
| 架构 | `architect_sys` | Non-business changes (dirs/deps/infra); produce API doc; pre-dev evaluation + on-demand mid-flow |
| 后端架构 | `backend` | Implement backend per API doc; backend skills; reuse existing modules |
| 前端架构 | `architect` | Implement frontend per API doc + requirements; existing project awareness |
| 测试员 | `tester` | Write backend test cases first, then frontend cases |
| 审查员 | `reviewer` | Review requirements; lightweight API-doc review; review backend/frontend code and tests |

### Role ID notes

- Existing `architect` remains **frontend** architect (no breaking rename of stored logs/knowledge paths for that role).
- System architect uses `architect_sys`.
- Backend developer uses `backend`.

## Workflow

```
User requirement
  → Manager → Product organizes requirement
  → Reviewer reviews requirement (fix loops via Product)
  → Manager → Architect_sys: evaluate infra + produce API doc
       │         (if infra changes needed: apply first)
       ▼
  → Reviewer lightweight-reviews API doc (path / params / response / error codes)
       │ fail → Architect_sys revises doc
       ▼
  → Manager dispatches in parallel:
       ├─ Backend: implement to API doc
       └─ Tester: write backend test cases
  → Reviewer reviews backend code + backend tests (fix loops)
       ▼
  → Manager dispatches in parallel:
       ├─ Frontend (architect): implement to API doc + requirement
       └─ Tester: write frontend test cases
  → Reviewer reviews frontend code + frontend tests
       ▼
  → Complete
```

Anytime a role detects a non-business change:

- Manager routes to `architect_sys`; after fix, resume prior stage.
- Signal: message `metadata.needsArchitectSys = true`, or Manager LLM output `[DISPATCH:architect_sys]`.
- After `architect_sys` returns `RESULT`, Manager continues the interrupted stage using context in `WorkflowState.history`.

### Stage enum (extended)

- `requirement_input`
- `product_organize`
- `review_requirement`
- `arch_evaluate` — system architect evaluation + API doc
- `review_api_doc` — lightweight only
- `develop_backend`
- `write_backend_test`
- `review_backend`
- `develop_frontend`
- `write_frontend_test`
- `review_frontend`
- `fix_issues`
- `complete`

### Ordering rules

1. Frontend development does not start until backend review gate is passed (or backend stage is explicitly skipped).
2. Tester uses `scope: 'backend' | 'frontend'` and runs backend cases before frontend cases.
3. High-severity issues still escalate to the user (existing behavior).

### Frontend-only shortcut

If `architect_sys` concludes “no infra changes + no backend APIs required”, Manager skips backend stages and proceeds to frontend (same as today’s FE path after requirement review).

## Artifacts and data model

### On-disk layout (under project `.fe-agent/`)

```
.fe-agent/
├── logs/                 # + architect_sys / backend
├── knowledge/            # + architect_sys / backend
├── skills/
│   ├── architect.md      # frontend skills (existing)
│   ├── backend.md        # backend skills (new)
│   └── architect_sys.md  # system architecture conventions (optional)
└── artifacts/
    └── api-doc.md        # current-task API contract
```

Optional later: `artifacts/backend/`, `artifacts/frontend/` file inventories. Not required for v1.

### Type extensions

- `Role`: add `ARCHITECT_SYS = 'architect_sys'`, `BACKEND = 'backend'`.
- `WorkflowStage`: add stages listed above; rename conceptual “develop_code / write_test / review_code_and_test” into backend/frontend-specific stages (keep old names only if needed for short migration; prefer clean replace in types + orchestrator).
- Review metadata: `reviewType: 'requirement' | 'api_doc' | 'code' | 'test'` with optional `scope: 'backend' | 'frontend' | 'infra'`.
- `WorkflowState`: add `apiDoc?: string`; add `backendArtifacts: CodeArtifact[]`; keep `codeArtifacts` for frontend (or rename to `frontendArtifacts` with alias — prefer explicit `frontendArtifacts` + migrate call sites).

### API document minimal format

```markdown
## 接口列表
### [METHOD] /path
- 说明：
- 请求参数：
- 响应：
- 错误码：
```

Markdown only. Reviewer focuses on path, request params, response shape, and error codes — not implementation detail.

### Product requirement template additions

Add sections:

- 后端能力 / API 相关功能点
- 数据实体（如有）

Keep existing overview, feature list, interaction, edge cases, open questions.

## Agent behavior details

### Manager

- After requirement approval → dispatch `architect_sys` with requirement.
- After API doc lightweight approval → dispatch `backend` + `tester` (scope backend).
- After backend approval → dispatch `architect` (frontend) + `tester` (scope frontend), attaching `api-doc.md` content.
- On messages flagged as non-business / infra → dispatch `architect_sys`, then resume.
- Reuse existing low/medium/high issue handling and knowledge lookup.

### Architect_sys

- Analyze whether infra/structure/dependency changes are needed; apply if yes (emit file patches like other code roles).
- Produce/update `.fe-agent/artifacts/api-doc.md`.
- Mid-flow: handle infra-only tasks without rewriting business API unless required.

### Backend

- Mirror frontend architect patterns: scan project structure, ensure `skills/backend.md`, prefer existing modules, no invented style.
- Implement strictly against API doc + approved requirement.
- Return code blocks with filepath convention.

### Frontend (`architect`)

- Must read API doc from artifacts (or message metadata).
- Implement UI/client against documented contracts; keep existing skills/component reuse rules.

### Tester

- `scope=backend`: cases against API doc + backend requirement points.
- `scope=frontend`: cases against UI flows + API usage.
- Same review loop as today.

### Reviewer

- `api_doc`: lightweight checklist only (paths/params/responses/error codes) to limit cost.
- `code`/`test` with `scope` for backend vs frontend prompts.
- Requirement review unchanged in spirit; include backend/data sections.

## Implementation approach (Option 1)

Extend current Orchestrator + Manager message routing. Do not introduce a separate FSM engine.

### Files to change / add

| Path | Change |
|------|--------|
| `src/types/index.ts` | Roles, stages, state fields |
| `src/agents/architect-sys.ts` | **New** system architect |
| `src/agents/backend.ts` | **New** backend architect |
| `src/agents/architect.ts` | Consume API doc |
| `src/agents/manager.ts` | New dispatch order + on-demand architect_sys |
| `src/agents/tester.ts` | Backend-then-frontend scopes |
| `src/agents/reviewer.ts` | `api_doc` + scoped code/test review |
| `src/agents/product.ts` | Requirement template |
| `src/agents/index.ts` | Exports |
| `src/core/orchestrator.ts` | Register agents; stage updates |
| `src/utils/file.ts` | Artifacts helpers; new role dirs |
| `src/index.ts` | CLI role filters for logs/knowledge |
| `README.md` / `docs/original-requirement.md` | Document fullstack flow |

### Compatibility

- Existing `.fe-agent/logs|knowledge|skills` paths remain valid; new role dirs are additive.
- Package name stays `fe-agent` for this change.
- Issue grading, user confirmation, knowledge extraction stay on `BaseAgent` / Manager.

## Success criteria

1. A fullstack requirement runs: requirement review → API doc (lightweight review) → backend → frontend.
2. Frontend does not start before backend gate (unless backend skipped).
3. System architect can run before development and mid-flow for infra.
4. Logs/knowledge exist for `architect_sys` and `backend`.
5. API doc is persisted at `.fe-agent/artifacts/api-doc.md` and used by backend, frontend, tester, reviewer.
6. Frontend-only path still works via skip.

## Open decisions (resolved)

| Topic | Decision |
|-------|----------|
| Role split | Separate `backend` + keep frontend `architect` + add `architect_sys` |
| Architect trigger | Both pre-dev and on-demand |
| API ownership | `architect_sys` writes contract; backend implements; frontend consumes |
| API review | Lightweight only |
| Tester | Single role; backend cases then frontend cases |
| Orchestration | Extend message-driven Manager/Orchestrator |
