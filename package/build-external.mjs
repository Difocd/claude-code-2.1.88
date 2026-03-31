import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  externalBundleProfile,
  externalEnvProfile,
  externalFeatureProfile,
  resolveExternalFeature,
  resolveExternalMacros,
} from './external-release-profile.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const cliDir = path.join(rootDir, 'cli');
const sourceDir = path.join(cliDir, 'src');
const manifestTemplateFile = path.join(rootDir, 'package.external.json');
const publishedCliBundleFile = path.join(rootDir, 'cli.js');

const localAntPackages = {
  '@ant/claude-for-chrome-mcp': {
    sourceDir: path.join(cliDir, 'node_modules', '@ant', 'claude-for-chrome-mcp'),
    packageJson: {
      name: '@ant/claude-for-chrome-mcp',
      version: '1.0.0',
      private: true,
      type: 'module',
      main: './src/index.ts',
      module: './src/index.ts',
      exports: {
        '.': './src/index.ts',
      },
    },
  },
  '@ant/computer-use-mcp': {
    sourceDir: path.join(cliDir, 'node_modules', '@ant', 'computer-use-mcp'),
    packageJson: {
      name: '@ant/computer-use-mcp',
      version: '0.1.3',
      private: true,
      type: 'module',
      main: './src/index.ts',
      module: './src/index.ts',
      exports: {
        '.': './src/index.ts',
        './types': './src/types.ts',
        './sentinelApps': './src/sentinelApps.ts',
      },
    },
  },
  '@ant/computer-use-input': {
    sourceDir: path.join(cliDir, 'node_modules', '@ant', 'computer-use-input'),
    packageJson: {
      name: '@ant/computer-use-input',
      version: '0.0.0-local',
      private: true,
      main: './js/index.js',
      exports: {
        '.': './js/index.js',
      },
    },
  },
  '@ant/computer-use-swift': {
    sourceDir: path.join(cliDir, 'node_modules', '@ant', 'computer-use-swift'),
    packageJson: {
      name: '@ant/computer-use-swift',
      version: '0.0.0-local',
      private: true,
      main: './js/index.js',
      exports: {
        '.': './js/index.js',
      },
    },
  },
};

const localWorkspacePackages = {
  ...localAntPackages,
  'audio-capture-napi': {
    sourceDir: path.join(cliDir, 'vendor', 'audio-capture-src'),
    packageJson: {
      name: 'audio-capture-napi',
      version: '0.0.0-local',
      private: true,
      type: 'module',
      main: './index.ts',
      module: './index.ts',
      exports: {
        '.': './index.ts',
      },
    },
  },
  'modifiers-napi': {
    sourceDir: path.join(cliDir, 'vendor', 'modifiers-napi-src'),
    packageJson: {
      name: 'modifiers-napi',
      version: '0.0.0-local',
      private: true,
      type: 'module',
      main: './index.ts',
      module: './index.ts',
      exports: {
        '.': './index.ts',
      },
    },
  },
  'color-diff-napi': {
    sourceDir: path.join(cliDir, 'src', 'native-ts', 'color-diff'),
    packageJson: {
      name: 'color-diff-napi',
      version: '0.0.0-local',
      private: true,
      type: 'module',
      main: './index.ts',
      module: './index.ts',
      exports: {
        '.': './index.ts',
      },
    },
  },
};

const forcedSourceOverrides = {
  'skills/bundled/verifyContent.ts': `export const SKILL_MD = '# Verify\\n'\nexport const SKILL_FILES: Record<string, string> = {\n  'examples/cli.md': '# CLI Verify Example\\n',\n  'examples/server.md': '# Server Verify Example\\n',\n}\n`,
  'skills/bundled/claudeApiContent.ts': `export const SKILL_MD = '# Claude API\\n'\nexport const SKILL_FILES: Record<string, string> = {}\n`,
};

function parseArgs(argv) {
  const options = {
    out: path.join(rootDir, externalBundleProfile.outfile),
    buildDir: path.join(cliDir, '.external-build'),
    minify: externalBundleProfile.minify,
    sourcemap: externalBundleProfile.sourcemap,
    printProfile: false,
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--print-profile') {
      options.printProfile = true;
      continue;
    }
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    if (arg === '--no-minify') {
      options.minify = false;
      continue;
    }
    if (arg === '--out') {
      options.out = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--build-dir') {
      options.buildDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--version') {
      options.version = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--build-time') {
      options.buildTime = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--package-url') {
      options.packageUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: node build-external.mjs [options]',
      '',
      'Options:',
      '  --out <file>          Output bundle path',
      '  --build-dir <dir>     Temporary transformed workspace',
      '  --version <value>     Override MACRO.VERSION',
      '  --build-time <iso>    Override MACRO.BUILD_TIME',
      '  --package-url <name>  Override MACRO.PACKAGE_URL',
      '  --no-minify           Disable Bun minification',
      '  --print-profile       Print the resolved external profile JSON',
      '  --check               Validate scaffold inputs without building',
      '  -h, --help            Show this help',
      '',
    ].join('\n'),
  );
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function ensureRelative(specifier) {
  if (specifier.startsWith('.')) return specifier;
  return `./${specifier}`;
}

function rewriteSrcSpecifier(specifier, filePath, stagedSourceDir) {
  const normalized = specifier.replace(/^src\/+/, '').replace(/\/+/g, '/');
  const targetPath = path.join(stagedSourceDir, normalized);
  const fromDir = path.dirname(filePath);
  return ensureRelative(toPosix(path.relative(fromDir, targetPath)));
}

function replaceImportSpecifiers(source, filePath, stagedSourceDir) {
  const replacer = (_, prefix, specifier, suffix) =>
    `${prefix}${rewriteSrcSpecifier(specifier, filePath, stagedSourceDir)}${suffix}`;

  return source
    .replace(/(from\s+['"])(src\/+[^'"]+)(['"])/g, replacer)
    .replace(/(import\(\s*['"])(src\/+[^'"]+)(['"]\s*\))/g, replacer)
    .replace(/(require\(\s*['"])(src\/+[^'"]+)(['"]\s*\))/g, replacer);
}

function stripBunFeatureImport(source) {
  return source.replace(
    /^\s*import\s*\{\s*feature\s*\}\s*from\s*['"]bun:bundle['"];?\n?/gm,
    '',
  );
}

function stripDtsImports(source) {
  return source.replace(/^\s*import\s+['"][^'"]+\.d\.ts['"];?\n?/gm, '');
}

function replaceFeatureCalls(source) {
  return source.replace(/feature\(\s*(['"])([^'"]+)\1\s*,?\s*\)/g, (_, _quote, name) =>
    String(resolveExternalFeature(name)),
  );
}

function replaceEnvLiterals(source) {
  let next = source;
  for (const [key, value] of Object.entries(externalEnvProfile)) {
    next = next.replace(
      new RegExp(`\\bprocess\\.env\\.${key}\\b`, 'g'),
      JSON.stringify(value),
    );
  }
  return next;
}

function replaceMacroLiterals(source, macros) {
  let next = source;
  for (const [key, value] of Object.entries(macros)) {
    next = next.replace(
      new RegExp(`\\bMACRO\\.${key}\\b`, 'g'),
      JSON.stringify(value),
    );
  }
  return next;
}

function normalizeCommanderCompat(source) {
  return source.replace(
    /new Option\((['"])-d2e,\s*--debug-to-stderr\1/g,
    "new Option('--debug-to-stderr'",
  );
}

function normalizeLegacyDebugFlagArgv(source, filePath) {
  if (!toPosix(filePath).endsWith('/entrypoints/cli.tsx')) {
    return source;
  }

  return source.replace(
    /async function main\(\): Promise<void> \{\n/,
    [
      'async function main(): Promise<void> {',
      "  process.argv = process.argv.map(arg => arg === '-d2e' ? '--debug-to-stderr' : arg);",
      '',
    ].join('\n'),
  );
}

function transformSourceFile(source, filePath, stagedSourceDir, macros) {
  let next = source;
  next = replaceImportSpecifiers(next, filePath, stagedSourceDir);
  next = replaceFeatureCalls(next);
  next = replaceEnvLiterals(next);
  next = replaceMacroLiterals(next, macros);
  next = normalizeCommanderCompat(next);
  next = normalizeLegacyDebugFlagArgv(next, filePath);
  next = stripBunFeatureImport(next);
  next = stripDtsImports(next);
  return next;
}

function resetGeneratedWorkspace(buildDir) {
  rmSync(path.join(buildDir, 'src'), { recursive: true, force: true });
  rmSync(path.join(buildDir, 'vendor'), { recursive: true, force: true });
  rmSync(path.join(buildDir, 'vendor-deps'), { recursive: true, force: true });
  rmSync(path.join(buildDir, 'profile.json'), { force: true });
  rmSync(path.join(buildDir, 'package.json'), { force: true });
  rmSync(path.join(buildDir, '.npmrc'), { force: true });
}

function packageDirForWorkspacePackage(buildDir, packageName) {
  const segments = packageName.split('/');
  return path.join(buildDir, 'vendor-deps', ...segments);
}

function prepareLocalWorkspacePackages(buildDir) {
  for (const [packageName, descriptor] of Object.entries(localWorkspacePackages)) {
    const packageDir = packageDirForWorkspacePackage(buildDir, packageName);
    mkdirSync(path.dirname(packageDir), { recursive: true });
    cpSync(descriptor.sourceDir, packageDir, {
      recursive: true,
      force: true,
    });
    writeFileSync(
      path.join(packageDir, 'package.json'),
      `${JSON.stringify(descriptor.packageJson, null, 2)}\n`,
      'utf8',
    );

    if (packageName === 'color-diff-napi') {
      const indexFile = path.join(packageDir, 'index.ts');
      const sourceText = readFileSync(indexFile, 'utf8')
        .replaceAll('../../ink/stringWidth.js', '../../src/ink/stringWidth.js')
        .replaceAll('../../utils/log.js', '../../src/utils/log.js');
      writeFileSync(indexFile, sourceText, 'utf8');
    }
  }
}

function prepareWorkspaceManifest(buildDir) {
  const manifest = JSON.parse(readFileSync(manifestTemplateFile, 'utf8'));
  const workspaceManifest = {
    name: '@anthropic-ai/claude-code-external-build-workspace',
    private: true,
    type: manifest.type,
    engines: manifest.engines,
    dependencies: { ...manifest.dependencies },
    optionalDependencies: manifest.optionalDependencies ?? {},
  };

  for (const packageName of Object.keys(localWorkspacePackages)) {
    const localPath = `file:./vendor-deps/${packageName}`;
    workspaceManifest.dependencies[packageName] = localPath;
  }

  writeFileSync(
    path.join(buildDir, 'package.json'),
    `${JSON.stringify(workspaceManifest, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(path.join(buildDir, '.npmrc'), 'fund=false\naudit=false\n', 'utf8');
}

function writeStubFile(stagedSourceDir, relativePath, contents) {
  const targetFile = path.join(stagedSourceDir, relativePath);
  if (existsSync(targetFile)) return;
  mkdirSync(path.dirname(targetFile), { recursive: true });
  writeFileSync(targetFile, contents, 'utf8');
}

function extractTemplateLiteralContaining(sourceText, needle) {
  const needleIndex = sourceText.indexOf(needle);
  if (needleIndex === -1) return null;

  const startMarker = 'exports=`';
  const startIndex = sourceText.lastIndexOf(startMarker, needleIndex);
  if (startIndex === -1) return null;

  const contentStart = startIndex + startMarker.length;
  for (let index = contentStart; index < sourceText.length; index += 1) {
    if (sourceText[index] !== '`') continue;

    let backslashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && sourceText[cursor] === '\\'; cursor -= 1) {
      backslashCount += 1;
    }

    if (backslashCount % 2 === 0) {
      return sourceText.slice(contentStart, index);
    }
  }

  return null;
}

function decodeTemplateLiteralContent(sourceText) {
  return sourceText.replaceAll('\\`', '`').replaceAll('\\${', '${');
}

function getPublishedPromptAssets() {
  if (!existsSync(publishedCliBundleFile)) {
    return {};
  }

  const bundleText = readFileSync(publishedCliBundleFile, 'utf8');
  const autoModeSystemPrompt = extractTemplateLiteralContaining(
    bundleText,
    '<permissions_template>',
  );
  const permissionsExternal = extractTemplateLiteralContaining(
    bundleText,
    '<user_environment_to_replace>',
  );

  return {
    autoModeSystemPrompt: autoModeSystemPrompt
      ? decodeTemplateLiteralContent(autoModeSystemPrompt)
      : null,
    permissionsExternal: permissionsExternal
      ? decodeTemplateLiteralContent(permissionsExternal)
      : null,
  };
}

function writeStubFiles(stagedSourceDir) {
  const publishedPromptAssets = getPublishedPromptAssets();
  const stubs = {
    'types/connectorText.ts': `export type ConnectorTextBlock = {\n  type: 'connector_text'\n  text?: string\n  content?: string\n  connector_name?: string\n}\n\nexport type ConnectorTextDelta = {\n  type?: 'connector_text_delta'\n  text?: string\n  content?: string\n}\n\nexport function isConnectorTextBlock(value: unknown): value is ConnectorTextBlock {\n  return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'connector_text'\n}\n`,
    'services/compact/snipCompact.ts': `import type { Message } from '../../types/message.js'\n\nexport type SnipCompactResult = {\n  messages: Message[]\n  tokensFreed: number\n  boundaryMessage?: Message\n}\n\nexport function isSnipRuntimeEnabled(): boolean {\n  return false\n}\n\nexport function shouldNudgeForSnips(_messages: Message[]): boolean {\n  return false\n}\n\nexport function snipCompactIfNeeded(messages: Message[], _options?: { force?: boolean }): SnipCompactResult {\n  return { messages, tokensFreed: 0 }\n}\n`,
    'services/compact/snipProjection.ts': `import type { Message } from '../../types/message.js'\n\nexport function isSnipBoundaryMessage(_message: unknown): boolean {\n  return false\n}\n\nexport function projectSnippedView(messages: Message[]): Message[] {\n  return messages\n}\n`,
    'services/compact/cachedMicrocompact.ts': `export type CacheEditsBlock = { edits: unknown[] }\nexport type PinnedCacheEdits = { userMessageIndex: number; block: CacheEditsBlock }\nexport type CachedMCState = {\n  pinnedEdits: PinnedCacheEdits[]\n  registeredTools: Set<string>\n  toolOrder: string[]\n  deletedRefs: Set<string>\n}\n\nexport function isCachedMicrocompactEnabled(): boolean { return false }\nexport function isModelSupportedForCacheEditing(_model: string): boolean { return false }\nexport function getCachedMCConfig() {\n  return { supportedModels: [], triggerThreshold: 0, keepRecent: 0 }\n}\nexport function createCachedMCState(): CachedMCState {\n  return { pinnedEdits: [], registeredTools: new Set(), toolOrder: [], deletedRefs: new Set() }\n}\nexport function markToolsSentToAPI(_state: CachedMCState): void {}\nexport function resetCachedMCState(_state: CachedMCState): void {}\nexport function registerToolResult(_state: CachedMCState, _toolId: string): void {}\nexport function registerToolMessage(_state: CachedMCState, _groupIds: string[]): void {}\nexport function getToolResultsToDelete(_state: CachedMCState): string[] { return [] }\nexport function createCacheEditsBlock(_state: CachedMCState, _toolsToDelete: string[]): CacheEditsBlock | null { return null }\n`,
    'tools/TungstenTool/TungstenTool.ts': `export class TungstenTool {}\n`,
    'tools/TungstenTool/TungstenLiveMonitor.tsx': `export function TungstenLiveMonitor(): null { return null }\n`,
    'tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.ts': `export class VerifyPlanExecutionTool {}\n`,
    'tools/VerifyPlanExecutionTool/constants.ts': `export const VERIFY_PLAN_EXECUTION_TOOL_NAME = 'VerifyPlanExecutionTool'\n`,
    'tools/WorkflowTool/constants.ts': `export const WORKFLOW_TOOL_NAME = 'WorkflowTool'\n`,
    'components/agents/SnapshotUpdateDialog.tsx': `export function SnapshotUpdateDialog(): null { return null }\n`,
    'assistant/AssistantSessionChooser.tsx': `export function AssistantSessionChooser(): null { return null }\n`,
    'commands/assistant/assistant.tsx': `export function NewInstallWizard(): null { return null }\nexport async function computeDefaultInstallDir(): Promise<string> { return '' }\n`,
    'coordinator/workerAgent.ts': `export function getCoordinatorAgents(): [] { return [] }\n`,
    'entrypoints/sdk/coreTypes.generated.ts': `export {}\n`,
    'entrypoints/sdk/runtimeTypes.ts': `export {}\n`,
    'entrypoints/sdk/toolTypes.ts': `export {}\n`,
    'ink/devtools.ts': `export {}\n`,
    'components/messages/SnipBoundaryMessage.tsx': `export function SnipBoundaryMessage(): null { return null }\n`,
    'components/messages/UserGitHubWebhookMessage.tsx': `export function UserGitHubWebhookMessage(): null { return null }\n`,
    'components/messages/UserForkBoilerplateMessage.tsx': `export function UserForkBoilerplateMessage(): null { return null }\n`,
    'components/messages/UserCrossSessionMessage.tsx': `export function UserCrossSessionMessage(): null { return null }\n`,
    'services/contextCollapse/index.ts': `export function isContextCollapseEnabled(): boolean { return false }\nexport function resetContextCollapse(): void {}\nexport function getStats() {\n  return {\n    collapsedSpans: 0,\n    collapsedMessages: 0,\n    stagedSpans: 0,\n    health: {\n      totalSpawns: 0,\n      totalErrors: 0,\n      totalEmptySpawns: 0,\n      emptySpawnWarningEmitted: false,\n      lastError: undefined,\n    },\n  }\n}\n`,
    'utils/filePersistence/types.ts': `export const DEFAULT_UPLOAD_CONCURRENCY = 4\nexport const FILE_COUNT_LIMIT = 1000\nexport const OUTPUTS_SUBDIR = 'outputs'\nexport type FailedPersistence = { path: string; error: string }\nexport type PersistedFile = { path: string; fileId: string }\nexport type TurnStartTime = number\nexport type FilesPersistedEventData = { files: PersistedFile[]; failed: FailedPersistence[] }\n`,
    'tools/DiscoverSkillsTool/prompt.ts': `export const DISCOVER_SKILLS_TOOL_NAME = 'DiscoverSkillsTool'\n`,
    'utils/permissions/yolo-classifier-prompts/auto_mode_system_prompt.txt':
      publishedPromptAssets.autoModeSystemPrompt ??
      `Auto mode is unavailable in this external rebuild.\n`,
    'utils/permissions/yolo-classifier-prompts/permissions_external.txt':
      publishedPromptAssets.permissionsExternal ??
      `Permission classifier prompt unavailable in this external rebuild.\n`,
    'utils/permissions/yolo-classifier-prompts/permissions_anthropic.txt': `Permission classifier prompt unavailable in this external rebuild.\n`,
    'utils/ultraplan/prompt.txt': `Ultraplan is unavailable in this external rebuild.\n`,
    'skills/bundled/verify/SKILL.md': `# Verify\n`,
    'skills/bundled/verify/examples/cli.md': `# CLI Verify Example\n`,
    'skills/bundled/verify/examples/server.md': `# Server Verify Example\n`,
  };

  for (const [relativePath, contents] of Object.entries(stubs)) {
    writeStubFile(stagedSourceDir, relativePath, contents);
  }
}

function writeWorkspaceMetadata(buildDir, macros) {
  const metadata = {
    featureProfile: externalFeatureProfile,
    envProfile: externalEnvProfile,
    macros,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(
    path.join(buildDir, 'profile.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
}

function ensureExistingLocalWorkspacePackages(buildDir) {
  for (const packageName of Object.keys(localWorkspacePackages)) {
    const packageDir = packageDirForWorkspacePackage(buildDir, packageName);
    if (existsSync(packageDir) && !lstatSync(packageDir).isSymbolicLink()) {
      continue;
    }

    const fallbackSources = [];
    const descriptor = localWorkspacePackages[packageName];
    if (descriptor && existsSync(descriptor.sourceDir)) {
      fallbackSources.push(descriptor.sourceDir);
    }
    const vendorDepDir = path.join(cliDir, 'vendor-deps', ...packageName.split('/'));
    if (existsSync(vendorDepDir)) {
      fallbackSources.push(vendorDepDir);
    }

    let restored = false;
    for (const candidate of fallbackSources) {
      if (!candidate) continue;
      if (!existsSync(candidate)) continue;
      rmSync(packageDir, { recursive: true, force: true });
      mkdirSync(path.dirname(packageDir), { recursive: true });
      cpSync(candidate, packageDir, { recursive: true, force: true });
      restored = true;
      break;
    }

    if (!restored) {
      throw new Error(
        `Unable to hydrate workspace package ${packageName}. Provide ${packageDir} or restore ${fallbackSources.join(' or ')}`,
      );
    }
  }
}

function hydrateExistingWorkspace(buildDir, stagedSourceDir, macros) {
  if (!existsSync(stagedSourceDir)) {
    throw new Error(
      `Missing staged workspace source directory: ${stagedSourceDir}. Restore cli/src or keep the transformed workspace intact.`,
    );
  }

  ensureExistingLocalWorkspacePackages(buildDir);
  writeStubFiles(stagedSourceDir);
  prepareWorkspaceManifest(buildDir);
  writeWorkspaceMetadata(buildDir, macros);
}

function prepareWorkspace(buildDir, macros) {
  const stagedSourceDir = path.join(buildDir, 'src');
  mkdirSync(buildDir, { recursive: true });

  if (!existsSync(sourceDir)) {
    hydrateExistingWorkspace(buildDir, stagedSourceDir, macros);
    return;
  }

  resetGeneratedWorkspace(buildDir);
  mkdirSync(stagedSourceDir, { recursive: true });

  for (const sourceFile of walkFiles(sourceDir)) {
    const relativePath = path.relative(sourceDir, sourceFile);
    const stagedFile = path.join(stagedSourceDir, relativePath);
    mkdirSync(path.dirname(stagedFile), { recursive: true });

    const sourceText =
      forcedSourceOverrides[relativePath] ?? readFileSync(sourceFile, 'utf8');
    const transformed = forcedSourceOverrides[relativePath]
      ? sourceText
      : transformSourceFile(sourceText, stagedFile, stagedSourceDir, macros);
    writeFileSync(stagedFile, transformed);
  }

  const vendorDir = path.join(cliDir, 'vendor');
  if (existsSync(vendorDir)) {
    cpSync(vendorDir, path.join(buildDir, 'vendor'), {
      recursive: true,
      force: true,
    });
  }

  writeStubFiles(stagedSourceDir);
  prepareLocalWorkspacePackages(buildDir);
  prepareWorkspaceManifest(buildDir);
  writeWorkspaceMetadata(buildDir, macros);
}

function ensureShebang(outputFile) {
  const current = readFileSync(outputFile, 'utf8');
  if (current.startsWith(externalBundleProfile.shebang)) return;
  writeFileSync(
    outputFile,
    `${externalBundleProfile.shebang}\n${current}`,
    'utf8',
  );
}

function resolveActualOutputPath(entrypoint, requestedOut) {
  const candidates = [
    path.join(path.dirname(entrypoint), path.basename(requestedOut)),
    path.join(cliDir, path.basename(requestedOut)),
    requestedOut,
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate Bun output for ${requestedOut}`);
}

function runBuild(options, macros) {
  const entrypoint = path.join(options.buildDir, externalBundleProfile.entrypoint);
  const relativeOut = toPosix(path.relative(cliDir, options.out));
  const relativeEntrypoint = toPosix(path.relative(cliDir, entrypoint));
  rmSync(options.out, { force: true });
  rmSync(`${options.out}.map`, { force: true });
  const args = [
    'build',
    `--outfile=${relativeOut}`,
    `--target=${externalBundleProfile.target}`,
    `--format=${externalBundleProfile.format}`,
    `--sourcemap=${options.sourcemap}`,
    '--loader:.txt=text',
  ];

  if (options.minify) args.push('--minify');
  args.push(relativeEntrypoint);

  const result = spawnSync('bun', args, {
    cwd: cliDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      USER_TYPE: externalEnvProfile.USER_TYPE,
      IS_DEMO: externalEnvProfile.IS_DEMO,
      CLAUDE_CODE_EXTERNAL_VERSION: macros.VERSION,
      CLAUDE_CODE_EXTERNAL_BUILD_TIME: macros.BUILD_TIME,
      CLAUDE_CODE_EXTERNAL_PACKAGE_URL: macros.PACKAGE_URL,
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const actualOut = resolveActualOutputPath(entrypoint, options.out);
  if (actualOut !== options.out) {
    cpSync(actualOut, options.out, { force: true });
    const actualMap = `${actualOut}.map`;
    if (existsSync(actualMap)) {
      cpSync(actualMap, `${options.out}.map`, { force: true });
    }
  }
}

function assertInputs(buildDir) {
  if (!existsSync(manifestTemplateFile)) {
    throw new Error(`Missing manifest template: ${manifestTemplateFile}`);
  }

  if (existsSync(sourceDir)) {
    for (const [packageName, descriptor] of Object.entries(localWorkspacePackages)) {
      if (!existsSync(descriptor.sourceDir)) {
        throw new Error(
          `Missing local package source for ${packageName}: ${descriptor.sourceDir}`,
        );
      }
    }
    return;
  }

  const stagedSourceDir = path.join(buildDir, 'src');
  if (!existsSync(stagedSourceDir)) {
    throw new Error(
      `Missing source directory. Provide ${sourceDir} or keep ${stagedSourceDir} intact.`,
    );
  }

  for (const packageName of Object.keys(localWorkspacePackages)) {
    const packageDir = packageDirForWorkspacePackage(buildDir, packageName);
    if (!existsSync(packageDir)) {
      throw new Error(
        `Missing vendored workspace package for ${packageName}: ${packageDir}`,
      );
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const macros = resolveExternalMacros({
    VERSION: options.version,
    BUILD_TIME: options.buildTime,
    PACKAGE_URL: options.packageUrl,
  });

  if (options.printProfile) {
    process.stdout.write(
      `${JSON.stringify(
        {
          featureProfile: externalFeatureProfile,
          envProfile: externalEnvProfile,
          macros,
          bundleProfile: {
            ...externalBundleProfile,
            outfile: options.out,
            buildDir: options.buildDir,
            minify: options.minify,
            sourcemap: options.sourcemap,
          },
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  assertInputs(options.buildDir);
  prepareWorkspace(options.buildDir, macros);

  if (options.check) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          buildDir: options.buildDir,
          out: options.out,
          transformedFiles: walkFiles(path.join(options.buildDir, 'src')).length,
          hasWorkspaceManifest: existsSync(
            path.join(options.buildDir, 'package.json'),
          ),
          localWorkspacePackages: Object.keys(localWorkspacePackages),
          macros,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (!existsSync(path.join(options.buildDir, 'node_modules'))) {
    throw new Error(
      `Missing ${path.join(options.buildDir, 'node_modules')}. Run npm install in ${options.buildDir} before building.`,
    );
  }

  mkdirSync(path.dirname(options.out), { recursive: true });
  runBuild(options, macros);
  ensureShebang(options.out);

  const mapFile = `${options.out}.map`;
  const outputStat = statSync(options.out);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        out: options.out,
        size: outputStat.size,
        hasSourceMap: existsSync(mapFile),
      },
      null,
      2,
    )}\n`,
  );
}

main();
