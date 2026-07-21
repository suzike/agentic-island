# Agentic-Island 发布指南

本文档对应 `0.6.2` 的 Windows NSIS 发布流程。

## 1. 发布前审查

- 工作区没有意外生成物、个人数据、密钥或调试日志。
- `package.json` 与 `package-lock.json` 版本一致。
- README、CHANGELOG、架构说明、截图和版本 Release Note 一致。
- `npm audit --omit=dev` 无已知生产依赖漏洞。
- 本地模型、FFmpeg、hooks 和图标资源均存在。
- 问答分支、气泡内追问、上下文、知识库写入、独立 Embedding 连接与供应商/账号配置迁移的回归测试通过。

## 2. 发布门禁

```powershell
npm run typecheck
npm test
npm run build
npm run docs:capture
npm audit --omit=dev
npm run package
npm run verify:package
```

如果 electron-builder 在 GitHub 运行时下载阶段超时，而 `node_modules/electron/dist` 已存在且 `node -p "require('electron/package.json').version"` 与项目锁定版本一致，可在 `npm run build` 成功后复用本地 Windows 运行时：

```powershell
npx electron-builder --win nsis --publish never --config.electronDist=node_modules/electron/dist
```

该回退只替代 Electron 运行时下载，不跳过应用构建、原生依赖重建或 NSIS 制作。

安装包输出：

```text
dist/Agentic-Island-Setup-<version>.exe
dist/Agentic-Island-Setup-<version>.exe.blockmap
dist/latest.yml
dist/SHA256SUMS.txt
```

## 3. 安装验证

1. 从 `dist/win-unpacked/Agentic-Island.exe` 使用隔离 `--user-data-dir` 启动，确认主界面和版本号。
2. 使用 NSIS `/S /D=<isolated-dir>` 静默安装到临时目录。
3. 从临时安装目录启动 `Agentic-Island.exe`，确认 renderer ready、bridge discovery 写入隔离目录且无控制台崩溃。
4. 运行卸载器 `/S`，确认应用进程退出且安装目录可清理。
5. 计算 SHA-256，并写入 `SHA256SUMS.txt` 和版本 Release Note。

测试安装不得覆盖用户正式安装目录、真实配置或真实 Agent hooks。设置 `AIISLAND_SKIP_HOOKS=1` 并使用隔离 `AIISLAND_BRIDGE_FILE`。

## 4. GitHub Release

`.github/workflows/release.yml` 接收已存在的草稿 Release 标签，在 Windows runner 上重新安装依赖、执行类型检查和离线测试、构建 NSIS、生成校验值并上传发布资产。

当前安装包未使用商业代码签名。Release 页面必须注明 SmartScreen 可能显示未知发布者，并提供 SHA-256。

## 5. 回滚

- 不覆盖旧版本 Release 资产。
- 发布后发现阻塞缺陷时，撤下 latest 标记并发布新的补丁版本，不复用已发布版本号。
- 配置结构变更必须保持向后兼容；录屏工程按 schema 版本迁移，不能静默丢弃旧工程。
