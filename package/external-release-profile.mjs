export const externalFeatureProfile = Object.freeze({
  BRIDGE_MODE: true,
  COORDINATOR_MODE: true,
  KAIROS_BRIEF: true,
  TRANSCRIPT_CLASSIFIER: true,
  VOICE_MODE: true,

  DAEMON: false,
  DIRECT_CONNECT: false,
  FORK_SUBAGENT: false,
  KAIROS: false,
  PROACTIVE: false,
  SSH_REMOTE: false,
  TORCH: false,
  UDS_INBOX: false,
  ULTRAPLAN: false,
  WORKFLOW_SCRIPTS: false,
});

export const externalEnvProfile = Object.freeze({
  USER_TYPE: 'external',
  IS_DEMO: '',
});

export const externalMacroDefaults = Object.freeze({
  ISSUES_EXPLAINER:
    'report the issue at https://github.com/anthropics/claude-code/issues',
  PACKAGE_URL: '@anthropic-ai/claude-code',
  README_URL: 'https://code.claude.com/docs/en/overview',
  VERSION: '2.1.88',
  FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
  BUILD_TIME: '2026-03-30T21:59:52Z',
});

export const externalBundleProfile = Object.freeze({
  entrypoint: 'src/entrypoints/cli.tsx',
  outfile: 'dist/cli.external.js',
  target: 'node',
  format: 'esm',
  sourcemap: 'linked',
  minify: true,
  shebang: '#!/usr/bin/env node',
});

export function resolveExternalMacros(overrides = {}) {
  return Object.freeze({
    ...externalMacroDefaults,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => value !== undefined),
    ),
  });
}

export function resolveExternalFeature(name) {
  return externalFeatureProfile[name] ?? false;
}
