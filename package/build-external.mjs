import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
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

function replaceFeatureCalls(source) {
  return source.replace(/feature\('([^']+)'\)/g, (_, name) =>
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

function transformSourceFile(source, filePath, stagedSourceDir, macros) {
  let next = source;
  next = replaceImportSpecifiers(next, filePath, stagedSourceDir);
  next = replaceFeatureCalls(next);
  next = replaceEnvLiterals(next);
  next = replaceMacroLiterals(next, macros);
  next = stripBunFeatureImport(next);
  return next;
}

function prepareWorkspace(buildDir, macros) {
  const stagedSourceDir = path.join(buildDir, 'src');
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(stagedSourceDir, { recursive: true });

  for (const sourceFile of walkFiles(sourceDir)) {
    const relativePath = path.relative(sourceDir, sourceFile);
    const stagedFile = path.join(stagedSourceDir, relativePath);
    mkdirSync(path.dirname(stagedFile), { recursive: true });

    const sourceText = readFileSync(sourceFile, 'utf8');
    const transformed = transformSourceFile(
      sourceText,
      stagedFile,
      stagedSourceDir,
      macros,
    );
    writeFileSync(stagedFile, transformed);
  }

  const vendorDir = path.join(cliDir, 'vendor');
  if (existsSync(vendorDir)) {
    cpSync(vendorDir, path.join(buildDir, 'vendor'), {
      recursive: true,
      force: true,
    });
  }

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

function ensureShebang(outputFile) {
  const current = readFileSync(outputFile, 'utf8');
  if (current.startsWith(externalBundleProfile.shebang)) return;
  writeFileSync(
    outputFile,
    `${externalBundleProfile.shebang}\n${current}`,
    'utf8',
  );
}

function runBuild(options, macros) {
  const entrypoint = path.join(options.buildDir, 'src', 'main.tsx');
  const relativeOut = toPosix(path.relative(cliDir, options.out));
  const relativeEntrypoint = toPosix(path.relative(cliDir, entrypoint));
  const args = [
    'build',
    `--outfile=${relativeOut}`,
    `--target=${externalBundleProfile.target}`,
    `--format=${externalBundleProfile.format}`,
    `--sourcemap=${options.sourcemap}`,
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
}

function assertInputs() {
  if (!existsSync(sourceDir)) {
    throw new Error(`Missing source directory: ${sourceDir}`);
  }
  if (!existsSync(path.join(cliDir, 'node_modules'))) {
    throw new Error(
      `Missing cli/node_modules. Populate dependencies before building.`,
    );
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

  assertInputs();
  prepareWorkspace(options.buildDir, macros);

  if (options.check) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          buildDir: options.buildDir,
          out: options.out,
          transformedFiles: walkFiles(path.join(options.buildDir, 'src')).length,
          macros,
        },
        null,
        2,
      )}\n`,
    );
    return;
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
