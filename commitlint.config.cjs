/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'subject-case': [0],
    'subject-full-stop': [2, 'never', '.'],
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'scope-enum': [
      1,
      'always',
      [
        'agents',
        'orchestrator',
        'llm',
        'cli',
        'workflow',
        'artifacts',
        'config',
        'deps',
        'docs',
        'test',
        'readme',
      ],
    ],
  },
};
