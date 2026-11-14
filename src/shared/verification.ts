// 验证命令判定的唯一真源：主进程用它决定"哪些命令结果值得留作证据"，
// 设置页用它做规则预览。覆盖前端/后端常规工具链，以及汽车工程常见的
// MATLAB/Simulink 回归与 C/C++ 构建测试。
//
// 注意：本文件是运行时模块，只能被打包侧（main/preload/组件）import；
// 被 raw-node 测试直接加载的文件（agents-store / codex-tail / logic/*）
// 必须通过依赖注入拿到判定函数，不能 extensionless import 这里。

/** 内置判定：命中任意一条即视为验证/构建命令 */
export const BUILTIN_VERIFICATION: RegExp[] = [
  // JS / TS
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|check|audit(?::[\w-]+)?)\b/i,
  /(?:^|[;&|]\s*)(?:npx\s+)?(?:vitest|jest|mocha|playwright|cypress|tsc|eslint|biome)(?:\s|$)/i,
  // Python
  /\b(?:pytest|tox|nox|ruff|mypy|unittest)\b/i,
  /\bpython[3]?\s+-m\s+(?:pytest|unittest|doctest)\b/i,
  // Go / Rust / JVM / .NET / 其它
  /\bgo\s+(?:test|vet|build)\b/i,
  /\bcargo\s+(?:test|build|clippy|check)\b/i,
  /\b(?:mvn|mvnw)\s+.*\b(?:test|verify|package)\b/i,
  /\b(?:gradle|gradlew)\s+.*\b(?:test|check|build)\b/i,
  /\bdotnet\s+(?:test|build)\b/i,
  /\b(?:rspec|phpunit|mix\s+test|swift\s+test|ctest)\b/i,
  // C / C++ 构建与静态检查
  /(?:^|[;&|]\s*)(?:cmake|ninja|make|msbuild)(?:\s|$)/i,
  /(?:^|[;&|]\s*)(?:gcc|g\+\+|clang|clang\+\+|cl)(?:\s|$)/i,
  /\b(?:cppcheck|clang-tidy|clang-format\s+--dry-run|include-what-you-use|valgrind|gcov|lcov)\b/i,
  /\b(?:gtest|catch2|ctest)\b/i,
  // MATLAB / Simulink（汽车 MBD 的主力回归手段）
  /\bmatlab\b.*(?:-batch|-r\b|-nodisplay)/i,
  /\b(?:runtests|runperf|testsuite|sltest|slcoverage|simulink\.test|checkcode|mlint)\b/i,
  /\bpolyspace[-\s](?:bug-finder|code-prover|results)\b/i,
  /\b(?:slbuild|rtwbuild|slprj)\b/i,
  // CANoe / vTESTstudio / 诊断与总线回归
  /\b(?:canoe|canoe64|vteststudio|canoe4sw|cantata|tessy)\b/i
]

/** 用户自定义规则：全局补充 + 按项目补充（子串匹配，大小写不敏感，与审批规则一致） */
export interface VerificationRules {
  /** 全局补充规则，例如 "run_regression" */
  extra?: string[]
  /** 项目名（cwd 短名）→ 该项目额外的规则 */
  byProject?: Record<string, string[]>
}

const hit = (command: string, patterns?: string[]): boolean =>
  (patterns || []).some((rule) => {
    const needle = rule.trim().toLowerCase()
    return needle.length > 0 && command.toLowerCase().includes(needle)
  })

/**
 * 是否为验证/构建命令。内置正则 + 全局规则 + 项目规则，任一命中即算。
 * project 传 cwd 的短名（与 Agent 卡片上的项目名一致）。
 */
export function isVerificationCommand(command: string, rules?: VerificationRules, project?: string): boolean {
  const text = String(command || '').trim()
  if (!text) return false
  if (hit(text, rules?.extra)) return true
  if (project && hit(text, rules?.byProject?.[project])) return true
  return BUILTIN_VERIFICATION.some((re) => re.test(text))
}

/** 设置页预览用：返回命中的来源，便于用户确认规则是否生效 */
export function verificationMatchSource(command: string, rules?: VerificationRules, project?: string): 'builtin' | 'global' | 'project' | null {
  const text = String(command || '').trim()
  if (!text) return null
  if (project && hit(text, rules?.byProject?.[project])) return 'project'
  if (hit(text, rules?.extra)) return 'global'
  return BUILTIN_VERIFICATION.some((re) => re.test(text)) ? 'builtin' : null
}
