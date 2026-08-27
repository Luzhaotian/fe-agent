import * as fs from 'fs';
import * as path from 'path';
import { RoleDefinition } from '../types';
import { ensureDir } from './file';

const ROLES_DIR = 'roles';

function getRolesDir(projectPath: string): string {
  return path.join(projectPath, '.fe-agent', ROLES_DIR);
}

export class RoleRegistry {
  private projectPath: string;
  private roles: Map<string, RoleDefinition> = new Map();

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.reload();
  }

  reload(): void {
    this.roles.clear();
    const dir = getRolesDir(this.projectPath);
    ensureDir(dir);

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
        const def = JSON.parse(raw) as RoleDefinition;
        if (def.name?.startsWith('custom:')) {
          this.roles.set(def.name, def);
        }
      } catch {
        // skip invalid role files
      }
    }
  }

  listRoles(): RoleDefinition[] {
    return Array.from(this.roles.values());
  }

  getRole(name: string): RoleDefinition | undefined {
    return this.roles.get(name);
  }

  saveRole(def: RoleDefinition): void {
    const dir = getRolesDir(this.projectPath);
    ensureDir(dir);
    const slug = def.name.replace(/^custom:/, '');
    const filePath = path.join(dir, `${slug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(def, null, 2), 'utf-8');
    this.roles.set(def.name, def);
  }

  /** B 辅助：基于标签/描述/能力关键词做规则匹配，不调用 LLM。 */
  matchRole(text: string, gap?: { capability?: string; suggestedTags?: string[] }): RoleDefinition | null {
    const haystack = [
      text,
      gap?.capability || '',
      ...(gap?.suggestedTags || []),
    ]
      .join('\n')
      .toLowerCase();

    let best: { role: RoleDefinition; score: number } | null = null;

    for (const role of this.roles.values()) {
      let score = 0;

      for (const tag of role.tags) {
        if (haystack.includes(tag.toLowerCase())) score += 3;
      }

      if (gap?.capability && role.description.toLowerCase().includes(gap.capability.toLowerCase())) {
        score += 4;
      }

      const namePart = role.name.replace(/^custom:/, '').replace(/-/g, ' ');
      if (haystack.includes(namePart)) score += 2;

      if (role.displayName && haystack.includes(role.displayName.toLowerCase())) score += 2;

      if (score > 0 && (!best || score > best.score)) {
        best = { role, score };
      }
    }

    return best && best.score >= 3 ? best.role : null;
  }
}
