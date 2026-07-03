// 命令风险分级 —— 逐字移植自原型 Agentic-Island.dc.html:780-787。
// 危险：破坏性操作，Allow 需两步确认；安全：只读/测试类，可自动允许；其余为一般。

export type RiskLevel = 'danger' | 'safe' | 'normal'

export interface Risk {
  level: RiskLevel
  reason?: string
}

export function riskOf(cmd?: string): Risk {
  if (!cmd) return { level: 'normal' }
  const danger =
    /(rm\s+-[rf]{1,2}|rm\s+-rf|git\s+push\s+.*(--force|-f)|--force\b|sudo\s|dd\s+if=|mkfs|:\(\)\s*\{|chmod\s+777|>\s*\/dev\/|\bdel\s+\/[fqs]|format\s+[a-z]:|DROP\s+TABLE|TRUNCATE\s+TABLE|shutdown|reboot)/i
  const safe =
    /^\s*(ls|ll|cat|pwd|echo|npm\s+(test|run\s+test|run\s+lint)|pnpm\s+test|yarn\s+test|pytest|jest|git\s+(status|diff|log|show)|grep|rg|find|which|node\s+-v)/i
  if (danger.test(cmd)) return { level: 'danger', reason: '检测到破坏性操作' }
  if (safe.test(cmd)) return { level: 'safe', reason: '只读 / 测试类命令' }
  return { level: 'normal' }
}
