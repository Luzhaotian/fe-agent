import { ProjectConfig, CapabilityGap, RoleDefinition } from '../types';
import { chat } from '../core/llm';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `role-${Date.now()}`;
}

function uniqueRoleName(base: string, existing: Set<string>): string {
  let name = `custom:${base}`;
  let i = 2;
  while (existing.has(name)) {
    name = `custom:${base}-${i}`;
    i += 1;
  }
  return name;
}

function parseRoleJson(response: string): Partial<RoleDefinition> | null {
  try {
    const jsonText = response.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return JSON.parse(jsonText.slice(start, end + 1));
  } catch {
    return null;
  }
}

function fallbackDefinition(gap: CapabilityGap): Partial<RoleDefinition> {
  return {
    displayName: gap.capability,
    description: gap.reason,
    systemPrompt: `你是${gap.capability}专家。${gap.reason}

请用中文回复，给出可执行方案与必要代码块（\`\`\`language:filepath），完成后将结果交给项目经理。
若超出能力范围，标注 [NEEDS_NEW_ROLE]。`,
    tags: gap.suggestedTags || [slugify(gap.capability)],
    skills: [],
    sensitive: gap.sensitive,
  };
}

/** 用 LLM 自动生成新角色定义并落盘。 */
export async function createRoleDefinition(
  config: ProjectConfig,
  gap: CapabilityGap,
  existingNames: string[]
): Promise<RoleDefinition> {
  const existing = new Set(existingNames);
  const prompt = {
    systemPrompt: `你是智能体角色设计师。根据能力缺口描述，生成一个新角色的 JSON 定义。

要求：
1. 角色应能独立完成所述能力，边界清晰
2. systemPrompt 要具体、可执行，包含输出格式要求
3. tags 用于后续匹配，3-6 个英文或中文标签
4. 只输出合法 JSON，不要 markdown 代码块以外的文字

JSON 字段：
- displayName: 中文显示名
- description: 角色职责说明（1-3 句）
- systemPrompt: 完整系统提示词
- tags: string[]
- skills: string[]（可为空）
- sensitive: boolean`,
    userMessage: `能力缺口：
- capability: ${gap.capability}
- reason: ${gap.reason}
- suggestedTags: ${(gap.suggestedTags || []).join(', ') || '无'}
- sensitive: ${gap.sensitive ? 'yes' : 'no'}

请生成角色 JSON。`,
    temperature: 0.4,
  };

  let parsed: Partial<RoleDefinition> | null = null;
  try {
    const response = await chat(config, prompt);
    parsed = parseRoleJson(response);
    if (!parsed?.systemPrompt) {
      const retry = await chat(config, {
        ...prompt,
        userMessage: `${prompt.userMessage}\n\n上次输出无法解析，请只输出合法 JSON 对象。`,
        maxRetries: 1,
      });
      parsed = parseRoleJson(retry);
    }
  } catch {
    parsed = null;
  }

  if (!parsed?.systemPrompt) {
    parsed = fallbackDefinition(gap);
  }

  const slug = slugify(gap.capability);
  const name = uniqueRoleName(slug, existing);

  return {
    name: name as `custom:${string}`,
    displayName: parsed.displayName || gap.capability,
    description: parsed.description || gap.reason,
    systemPrompt: parsed.systemPrompt || fallbackDefinition(gap).systemPrompt!,
    tags: parsed.tags?.length ? parsed.tags : gap.suggestedTags || [slug],
    skills: parsed.skills || [],
    sensitive: parsed.sensitive ?? gap.sensitive ?? false,
    createdAt: new Date().toISOString().slice(0, 10),
  };
}
