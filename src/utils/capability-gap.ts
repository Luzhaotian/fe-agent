import { CapabilityGap } from '../types';

/** 从角色回复中解析能力缺口信号（A 触发）。 */
export function parseCapabilityGap(response: string): CapabilityGap | null {
  if (!response.includes('[NEEDS_NEW_ROLE]')) return null;

  const capability = extractField(response, 'capability');
  const reason = extractField(response, 'reason');
  if (!capability || !reason) return null;

  const tagsRaw = extractField(response, 'tags');
  const suggestedTags = tagsRaw
    ? tagsRaw.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
    : [];

  const sensitiveRaw = extractField(response, 'sensitive');
  const sensitive = sensitiveRaw ? /^(yes|true|是|1)$/i.test(sensitiveRaw.trim()) : false;

  return { capability, reason, suggestedTags, sensitive };
}

function extractField(text: string, field: string): string | null {
  const pattern = new RegExp(`^${field}\\s*[:：]\\s*(.+)$`, 'im');
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
