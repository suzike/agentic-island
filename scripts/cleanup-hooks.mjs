// 一次性：从真实全局配置移除本工具的 hook（按文件名子串匹配，兼容斜杠方向）。
import { uninstallClaudeCode, uninstallCodex } from '../src/main/hook-installer.ts'
uninstallClaudeCode('cc-forward.mjs')
uninstallCodex('codex-forward.mjs')
console.log('cleaned real global config')
