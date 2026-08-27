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
