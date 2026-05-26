# FE-Agent 前端智能体

> 多角色协作的前端开发 AI 助手

FE-Agent 是一个基于多角色协作的前端智能体，通过模拟真实开发团队的协作流程，自动化完成前端开发任务。

## 🎯 核心特性

- **5 个 AI 角色协作**：项目经理、产品、前端架构、测试员、审查员
- **自动工作流编排**：需求整理 → 审查 → 开发 → 测试 → 审查 → 交付
- **项目感知**：自动分析项目结构、框架、通用组件，严格按项目规范开发
- **知识库积累**：自动从交互中提取知识，持续积累经验
- **分级问题处理**：低/中/高级问题自动分级，高级问题交由用户决策
- **角色独立日志**：每个角色独立日志记录，便于追踪和回溯

## 🏗️ 角色说明

| 角色 | 职责 |
|------|------|
| **项目经理** | 统筹协作，分发任务，处理问题分级，协调审查反馈 |
| **产品** | 整理需求，拓展需求，支持网址需求提取 |
| **前端架构** | 按项目规范开发代码，自动生成 skills，优先使用通用组件 |
| **测试员** | 编写测试用例，覆盖功能和边界条件 |
| **审查员** | 审查需求/代码/测试，分级反馈问题 |

## 📦 安装

### 全局安装（推荐）

```bash
npm install -g fe-agent
```

### 使用 npx（无需安装）

```bash
npx fe-agent start -r "你的需求描述"
```

### 从源码安装

```bash
git clone https://github.com/your-username/fe-agent.git
cd fe-agent
npm install
npm run build
npm link
```

## 🚀 使用

### 1. 初始化配置

在项目根目录下执行：

```bash
fe-agent init
```

按提示输入 API Key 和模型配置。也可以手动创建 `.env` 文件：

```env
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
```

### 2. 启动智能体

```bash
# 交互式输入需求
fe-agent start

# 直接传入需求
fe-agent start -r "开发一个用户登录页面"

# 从文件读取需求
fe-agent start -f requirements.md

# 从网址获取需求
fe-agent start -u https://example.com/requirements
```

### 3. 查看日志

```bash
# 查看所有日志
fe-agent logs

# 查看指定角色日志
fe-agent logs -r architect

# 查看指定日期日志
fe-agent logs -d 2024-01-01
```

### 4. 查看知识库

```bash
# 查看所有知识库
fe-agent knowledge

# 查看指定角色知识库
fe-agent knowledge -r architect

# 搜索关键词
fe-agent knowledge -s "组件"
```

### 5. 查看项目状态

```bash
fe-agent status
```

## 🔄 工作流程

```
用户需求
   │
   ▼
项目经理 ◄──── 接收 & 分发
   │
   ▼
产品 ◄──── 整理需求
   │
   ▼
审查员 ◄──── 审查需求 ── 有问题 ──► 产品整改
   │
   │ 通过
   ▼
前端架构 ◄──── 开发代码    测试员 ◄──── 编写用例
   │                        │
   ▼                        ▼
审查员 ◄──── 审查代码和测试 ── 有问题 ──► 整改
   │
   │ 通过
   ▼
交付
```

## 📁 项目结构

```
.fe-agent/           # 智能体工作目录（自动生成）
├── logs/            # 日志
│   ├── manager/     # 项目经理日志
│   ├── product/    # 产品日志
│   ├── architect/  # 前端架构日志
│   ├── tester/     # 测试员日志
│   ├── reviewer/   # 审查员日志
│   └── global.log  # 全局日志
├── knowledge/       # 知识库
│   ├── manager/
│   ├── product/
│   ├── architect/
│   ├── tester/
│   └── reviewer/
└── skills/          # 项目 Skills
    └── architect.md
```

## ⚙️ 配置

### 环境变量 (.env)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | LLM API 密钥 | 必填 |
| `LLM_BASE_URL` | LLM API 地址 | `https://api.openai.com/v1` |
| `LLM_MODEL` | 模型名称 | `gpt-4o` |
| `LLM_TEMPERATURE` | 温度参数 | `0.7` |
| `LLM_MAX_TOKENS` | 最大 token 数 | `4096` |

### 项目配置 (fe-agent.config.json)

```json
{
  "project": {
    "name": "my-project",
    "framework": "react",
    "language": "typescript"
  }
}
```

## 🔧 开发

```bash
# 安装依赖
npm install

# 开发运行
npm run dev start -r "需求"

# 构建
npm run build

# 运行
npm start
```

## 📝 License

MIT
