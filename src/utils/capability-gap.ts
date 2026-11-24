import { CapabilityGap } from '../types';

/** 从角色回复中解析能力缺口信号（块级优先，再回退行字段）。 */
export function parseCapabilityGap(response: string): CapabilityGap | null {
  if (!response.includes('[NEEDS_NEW_ROLE]')) return null;

  const block = extractNeedsNewRoleBlock(response);
  const source = block || response;

  const capability = extractField(source, 'capability');
  const reason = extractField(source, 'reason');
  if (!capability || !reason) return null;

  const tagsRaw = extractField(source, 'tags');
  const suggestedTags = tagsRaw
    ? tagsRaw.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
    : [];

  const sensitiveRaw = extractField(source, 'sensitive');
  const sensitive = sensitiveRaw ? /^(yes|true|是|1)$/i.test(sensitiveRaw.trim()) : false;

  return { capability, reason, suggestedTags, sensitive };
}

/** 截取 [NEEDS_NEW_ROLE] 到下一空行块或下一标记。 */
function extractNeedsNewRoleBlock(text: string): string | null {
  const start = text.indexOf('[NEEDS_NEW_ROLE]');
  if (start < 0) return null;
  const rest = text.slice(start);
  const endMatch = rest.slice(16).search(/\n\s*\n|\[NEEDS_ARCHITECT_SYS\]|\[SKIP_BACKEND\]/);
  if (endMatch >= 0) {
    return rest.slice(0, 16 + endMatch);
  }
  return rest.slice(0, 800);
}

function extractField(text: string, field: string): string | null {
  const pattern = new RegExp(`(?:^|\\n)\\s*${field}\\s*[:：]\\s*(.+?)\\s*(?=\\n|$)`, 'i');
  const match = text.match(pattern);
  return match?.[1]?.trim() || null;
}

/** 为结果 metadata 合并能力缺口与基建需求标记。 */
export function enrichResultMetadata(
  response: string,
  metadata: Record<string, unknown> = {}
): Record<string, unknown> {
  const gap = parseCapabilityGap(response);
  if (gap) return { ...metadata, needsNewRole: gap };
  if (response.includes('[NEEDS_ARCHITECT_SYS]')) {
    return { ...metadata, needsArchitectSys: true };
  }
  return metadata;
}
