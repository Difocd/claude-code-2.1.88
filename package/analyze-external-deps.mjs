import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(rootDir, 'package.external.json');
const sourcemapPath = path.join(rootDir, 'cli.js.map');

function parseArgs(argv) {
  const options = {
    write: true,
    placeholder: '*',
    registryLatest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.write = false;
      continue;
    }
    if (arg === '--placeholder') {
      options.placeholder = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--registry-latest') {
      options.registryLatest = true;
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
      'Usage: node analyze-external-deps.mjs [options]',
      '',
      'Options:',
      '  --dry-run               Print the inferred dependency payload only',
      '  --placeholder <value>   Placeholder version for unresolved packages',
      '  --registry-latest       Resolve unresolved packages from npm dist-tags.latest',
      '  -h, --help              Show this help',
      '',
    ].join('\n'),
  );
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function listTopLevelNodeModulesPackages() {
  const output = execSync(
    "find cli/node_modules -mindepth 1 -maxdepth 1 -type d | sed 's#^cli/node_modules/##' | sort",
    { cwd: rootDir, encoding: 'utf8' },
  )
    .trim()
    .split(/\n+/)
    .filter(Boolean);

  const packages = new Set();

  for (const entry of output) {
    if (!entry.startsWith('@')) {
      packages.add(entry);
      continue;
    }

    const scopedOutput = execSync(
      `find cli/node_modules/${entry} -mindepth 1 -maxdepth 1 -type d | sed 's#^cli/node_modules/${entry}/##' | sort`,
      { cwd: rootDir, encoding: 'utf8' },
    )
      .trim()
      .split(/\n+/)
      .filter(Boolean);

    for (const child of scopedOutput) {
      packages.add(`${entry}/${child}`);
    }
  }

  return packages;
}

function listSourcemapPackages() {
  const sourcemap = readJson(sourcemapPath);
  const packages = new Set();

  for (const source of sourcemap.sources) {
    const match = source.match(/^..\x2fnode_modules\x2f((?:@[^/]+\/)?[^/]+)/);
    if (match) packages.add(match[1]);
  }

  return packages;
}

function sortObject(input) {
  return Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function packageDirFor(name) {
  return path.join(rootDir, 'cli', 'node_modules', ...name.split('/'));
}

function walkPackageFiles(dir) {
  const files = [];

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      files.push(fullPath);
    }
  }

  visit(dir);
  return files;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findVersionEvidence(name) {
  const dir = packageDirFor(name);
  let files;
  try {
    files = walkPackageFiles(dir);
  } catch {
    return null;
  }

  const maxFileBytes = 512 * 1024;
  const semver = '(\\d+\\.\\d+\\.\\d+(?:[-+][A-Za-z0-9.-]+)?)';
  const packageRegexes = [
    new RegExp(`\\b${escapeRegex(name)}\\b\\s+v${semver}`),
    new RegExp(
      `\\b${escapeRegex(name.split('/').at(-1) ?? name)}\\b\\s+v${semver}`,
    ),
  ];
  const assignmentRegexes = [
    { kind: 'version-export', re: new RegExp(`\\bexports\\.version\\b[^\\n]{0,32}?['"]${semver}['"]`) },
    { kind: 'version-const', re: new RegExp(`\\b(?:VERSION|SDK_VERSION)\\b[^\\n]{0,32}?['"]${semver}['"]`) },
    { kind: 'version-var', re: new RegExp(`\\b(?:const|let|var)\\s+version\\b[^\\n]{0,32}?['"]${semver}['"]`) },
    { kind: 'release-please', re: new RegExp(`['"]${semver}['"][^\\n]*x-release-please-version`) },
  ];

  for (const filePath of files) {
    if (!/\.(?:js|mjs|cjs|ts|tsx|json)$/.test(filePath)) continue;
    if (statSync(filePath).size > maxFileBytes) continue;

    const relPath = path.relative(rootDir, filePath);
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const re of packageRegexes) {
        const match = line.match(re);
        if (match) {
          return {
            version: match[1],
            evidence: `${relPath}:${index + 1}`,
            kind: 'package-banner',
          };
        }
      }
      for (const { kind, re } of assignmentRegexes) {
        const match = line.match(re);
        if (match) {
          return {
            version: match[1],
            evidence: `${relPath}:${index + 1}`,
            kind,
          };
        }
      }
    }
  }

  return null;
}

function inferVersion(name, placeholder, manifest) {
  if (manifest['x-manual-dependency-versions']?.[name]) {
    return manifest['x-manual-dependency-versions'][name];
  }
  if (manifest.optionalDependencies?.[name]) {
    return manifest.optionalDependencies[name];
  }
  if (name === 'sharp') {
    const optionalSharp = Object.entries(manifest.optionalDependencies ?? {}).find(
      ([key]) => key.startsWith('@img/sharp-'),
    );
    if (optionalSharp) return optionalSharp[1];
  }
  return placeholder;
}

async function resolveLatestFromRegistry(name) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`registry lookup failed for ${name}: HTTP ${response.status}`);
  }
  const metadata = await response.json();
  const version = metadata?.['dist-tags']?.latest;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`registry lookup failed for ${name}: missing dist-tags.latest`);
  }
  return {
    version,
    evidence: url,
    kind: 'registry-latest',
  };
}

async function resolveRegistryVersions(names) {
  const resolved = {};
  for (const name of names) {
    try {
      resolved[name] = await resolveLatestFromRegistry(name);
    } catch (error) {
      resolved[name] = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return resolved;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readJson(manifestPath);
  const optionalDependencyNames = new Set(
    Object.keys(manifest.optionalDependencies ?? {}),
  );
  const nodeModulesPackages = listTopLevelNodeModulesPackages();
  const sourcemapPackages = listSourcemapPackages();
  const inferredPackages = new Set([...nodeModulesPackages, ...sourcemapPackages]);

  const dependencies = {};
  const unresolvedVersions = [];
  const resolvedEvidence = {};
  const unresolvedNeedingRegistry = [];

  for (const name of [...inferredPackages].sort((left, right) =>
    left.localeCompare(right),
  )) {
    if (optionalDependencyNames.has(name)) continue;
    const inferred = findVersionEvidence(name);
    const version =
      inferred?.version ?? inferVersion(name, options.placeholder, manifest);
    dependencies[name] = version;
    if (version === options.placeholder) {
      unresolvedVersions.push(name);
      if (options.registryLatest) unresolvedNeedingRegistry.push(name);
    } else if (inferred) {
      resolvedEvidence[name] = inferred;
    }
  }

  if (options.registryLatest && unresolvedNeedingRegistry.length > 0) {
    const registryResolved = await resolveRegistryVersions(unresolvedNeedingRegistry);
    unresolvedVersions.length = 0;
    for (const name of Object.keys(registryResolved).sort((left, right) =>
      left.localeCompare(right),
    )) {
      const resolved = registryResolved[name];
      if (resolved.version) {
        dependencies[name] = resolved.version;
        resolvedEvidence[name] = resolved;
      } else {
        dependencies[name] = options.placeholder;
        unresolvedVersions.push(name);
      }
    }
  }

  const nextManifest = {
    ...manifest,
    scripts: sortObject({
      ...(manifest.scripts ?? {}),
      'deps:external:analyze': 'node ./analyze-external-deps.mjs',
    }),
    dependencies: sortObject(dependencies),
    'x-dependency-status':
      unresolvedVersions.length === 0 ? 'inferred-with-versions' : 'inferred-with-placeholders',
    'x-generated-dependencies': {
      sourceSignals: ['cli/node_modules', 'cli.js.map'],
      registryLatestEnabled: options.registryLatest,
      inferredDependencyCount: Object.keys(dependencies).length,
      resolvedVersionCount: Object.keys(resolvedEvidence).length,
      unresolvedVersionCount: unresolvedVersions.length,
      placeholderVersion: options.placeholder,
      resolvedEvidence,
      unresolvedVersions,
    },
  };

  const payload = `${JSON.stringify(nextManifest, null, 2)}\n`;
  if (options.write) {
    writeFileSync(manifestPath, payload, 'utf8');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        write: options.write,
        dependencyCount: Object.keys(dependencies).length,
        resolvedVersionCount: Object.keys(resolvedEvidence).length,
        unresolvedVersionCount: unresolvedVersions.length,
        placeholderVersion: options.placeholder,
        registryLatestEnabled: options.registryLatest,
      },
      null,
      2,
    )}\n`,
  );
}

await main();
