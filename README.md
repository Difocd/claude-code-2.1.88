# Claude Code Reverse Build Notes

这个目录记录了从 `@anthropic-ai/claude-code` 发布包反推源码和重建 external CLI 的过程。

当前状态：
- 已通过 `reverse-sourcemap` 还原出 `cli/`
- 已补出 external 重建脚手架
- 已生成可执行产物 `package/dist/cli.external.js`
- `auto-mode defaults` 输出已和官方 `cli.js` 对齐

## 1. 获取发布包和 sourcemap

```sh
npm i @anthropic-ai/claude-code
cp node_modules/@anthropic-ai/claude-code/cli.js .
cp node_modules/@anthropic-ai/claude-code/cli.js.map .
npm install --global reverse-sourcemap
reverse-sourcemap -o cli -v cli.js.map
```

## 2. 目录说明

- `package/cli/`: reverse-sourcemap 还原出的源码树
- `package/package.external.json`: external 重建用 manifest
- `package/analyze-external-deps.mjs`: 自动回填构建依赖
- `package/build-external.mjs`: external CLI 重建脚本
- `package/external-release-profile.mjs`: external feature/env/macro profile
- `package/dist/cli.external.js`: 当前重建产物

## 3. 分析依赖

先根据 `cli/node_modules` 和 `cli.js.map` 自动回填依赖：

```sh
cd package
node analyze-external-deps.mjs
```

如果要继续用 npm registry 补公开包版本：

```sh
node analyze-external-deps.mjs --registry-latest
```

## 4. 重建 external CLI

```sh
cd package
node build-external.mjs
```

常用参数：

```sh
node build-external.mjs --check
node build-external.mjs --print-profile
node build-external.mjs --no-minify
```

## 5. 验证

```sh
node dist/cli.external.js --version
node dist/cli.external.js --help
node dist/cli.external.js auto-mode defaults
```

官方产物对比：

```sh
node cli.js auto-mode defaults
node dist/cli.external.js auto-mode defaults
```

## 6. 当前已知结论

- external 构建入口应走 `src/entrypoints/cli.tsx`，不能直接打 `main.tsx`
- 公开版 Commander 对 `-d2e` 不兼容，重建脚本里做了 argv 归一化
- `auto_mode_system_prompt.txt` 和 `permissions_external.txt` 不在磁盘源码里，而是内嵌在官方 `cli.js` 中；重建脚本会自动提取它们

![效果](./image.png)
