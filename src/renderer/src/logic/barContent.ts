// 常驻迷你条的内容库：大量内置 + AI 每 10 分钟刷新的动态池 + GitHub 热门 + 用户自定义主题。
// 内置池是保底（离线/无 Key 也有内容）；AI 池在其上叠加轮换。

export const QUOTES: string[] = [
  '简单是可靠的前提。 —— Edsger Dijkstra',
  'Talk is cheap. Show me the code. —— Linus Torvalds',
  '过早优化是万恶之源，但该来的优化终究要来。 —— Donald Knuth',
  '程序必须先让人读懂，顺便让机器执行。 —— Harold Abelson',
  '完成比完美更重要，但完成不等于交差。',
  'Stay hungry, stay foolish. —— Steve Jobs',
  '预测未来的最好方式是创造它。 —— Alan Kay',
  '任何足够先进的技术都与魔法无异。 —— Arthur Clarke',
  '好的判断来自经验，而经验往往来自坏的判断。',
  '代码是写给人看的，只是恰好能在机器上运行。 —— Robert C. Martin',
  '控制复杂性是编程的本质。 —— Brian Kernighan',
  '种一棵树最好的时间是十年前，其次是现在。',
  '慢慢来，比较快。',
  '所有伟大的事物都是由一系列微小的事物组成的。 —— 梵高',
  '我们塑造工具，然后工具塑造我们。 —— Marshall McLuhan',
  '衡量进度的唯一标准是可工作的软件。 —— 敏捷宣言',
  '没有银弹。 —— Fred Brooks',
  '计算机科学只有两个难题：缓存失效和命名。 —— Phil Karlton',
  '先解决问题，再写代码。 —— John Johnson',
  '删除代码比写代码更让人快乐。',
  '如果调试是移除 bug 的过程，那编程就是放入 bug 的过程。 —— Dijkstra',
  '设计不是看起来怎样，而是如何运作。 —— Steve Jobs',
  '纪律是自由的前提。 —— Jocko Willink',
  '你无法管理你无法度量的东西。 —— Peter Drucker',
  '把每一件简单的事做好就是不简单。',
  '战略上藐视困难，战术上重视困难。',
  '大道至简，衍化至繁。',
  '君子藏器于身，待时而动。 —— 《周易》',
  '工欲善其事，必先利其器。 —— 《论语》',
  '不积跬步，无以至千里。 —— 荀子'
]

export const EXPERIENCE: string[] = [
  '先让它跑起来，再让它跑得对，最后让它跑得快。',
  '每个 bug 背后都有一个没写的测试在沉默。',
  '命名花的时间，会在读代码时十倍赚回来。',
  '日志是给未来凌晨三点排查问题的自己写的。',
  '能用配置解决的不写代码；能删代码解决的不加代码。',
  '重构的安全网是测试，不是勇气。',
  '拿不准接口怎么设计时，先写调用方的代码。',
  '复杂度不会消失，只会转移——把它关进最少人碰的房间。',
  '提交信息是写给三个月后接手排查的人的情书。',
  '性能问题九成在 I/O，剩下一成在你以为不在 I/O 的地方。',
  '需求冻结之前，所有抽象都只是猜测。',
  '最贵的代码是写完没人敢动的代码。',
  '出错信息要回答三件事：发生了什么、为什么、现在该怎么办。',
  '分支活得越久，合并的代价越痛。',
  '魔法数字是给未来埋的雷，常量名是拆雷说明书。',
  '代码评审评的是代码，不是人。',
  '默认值决定了 90% 用户的体验。',
  '幂等性是分布式系统的免费保险。',
  '监控报警的黄金法则：每条报警都必须可执行。',
  '技术债不可怕，可怕的是没有账本。',
  '写文档最好的时机是代码还热乎的时候。',
  '接口一旦公开，它的怪癖就成了契约。 —— Hyrum 定律',
  '估算时间乘以二，然后换更大的单位。',
  '所有输入都是恶意的，直到被证明无害。',
  '先度量，再优化；没有火焰图不谈性能。',
  '回滚方案没演练过，就等于没有回滚方案。',
  '越接近发布越不要重构。',
  '缓存是性能的解药，也是一致性的毒药。'
]

export const AGENT_TIPS: string[] = [
  'Agent 的上下文是稀缺资源——把最重要的信息放在最前和最后。',
  '给 Agent 明确的验收标准，它就能自己循环到做对为止。',
  '让 AI 先复述你的需求，再动手——误解在第一步最便宜。',
  'Prompt 里给一个好例子，胜过十条抽象规则。',
  '大任务拆小步提交给 Agent，每步可验证，失败可回滚。',
  'AI 生成的代码要过测试关，不是过眼睛关。',
  '把项目约定写进 CLAUDE.md / AGENTS.md，Agent 每次开工自动遵守。',
  '子代理并行探索，主代理只拿结论——上下文不会爆。',
  '让 Agent 输出结构化 JSON，解析比解读省十倍力气。',
  '计划模式先审蓝图再动工，返工率断崖式下降。',
  'Agent 犯错时，把错误原样贴回去，比重新描述更有效。',
  '工具调用失败要 fail-open 还是 fail-closed，取决于哪边代价大。',
  '给 Agent 的系统提示要像给新同事的入职手册：简短、具体、有边界。',
  '温度调低做工程，调高做头脑风暴。',
  '长对话定期让 AI 总结共识，防止上下文漂移。',
  'AI 说"应该可以"的时候，让它跑一遍证明。',
  '版本控制是与 Agent 协作的后悔药，小步提交是服药说明。',
  '让 Agent 自己写测试再实现，比人肉验收可靠。',
  '多 Agent 评审同一份代码，不同视角各挑各的刺。',
  '把重复的操作沉淀成 Skill / 斜杠命令，一次定义处处复用。',
  'RAG 检索质量决定回答上限，垃圾进垃圾出。',
  'Agent 卡住时先查它看到了什么上下文，而不是换提示词。'
]

export const THERMAL_TIPS: string[] = [
  'Simulink 模型的信号命名规范，是热管理软件可维护性的一半。',
  '标定量与逻辑分离：MAP/曲线进 DCM，模型里只留接口。',
  '热管理状态机切换要设迟滞，否则阀门在边界抖动到怀疑人生。',
  'PID 出口一定要限幅+抗积分饱和，冷却回路才不会过冲。',
  '模型在环（MIL）先过，再谈硬件在环——问题前移一步，成本降一个量级。',
  'Stateflow 里每个状态都要有明确的退出条件，别留"进得去出不来"的死角。',
  '乘员舱与电池回路抢热量时，仲裁优先级要写成显式表，不要藏在 if 嵌套里。',
  '压缩机转速指令变化率限制，既护硬件也护 NVH。',
  'AUTOSAR 接口先冻结再开发内部逻辑，SWC 之间才不会互相拖累。',
  '热泵模式切换的焓值计算，边界工况（-10℃ 附近）单独验证。',
  'Simulink 总线（Bus）版本化管理，接口变更全链路可追溯。',
  '仿真步长与被控对象时间常数匹配：冷却液回路 100ms 足够，电子膨胀阀要更细。',
  '故障注入测试覆盖传感器漂移，不只是断路短路。',
  '模型引用（Model Reference）比子系统复制粘贴，可测试性高一个维度。',
  'PTC 功率分配先算电源预算，再谈舒适性。',
  '低温冷启动的除霜策略，是用户对热管理的第一印象。',
  '查表外插要显式钳位，标定表边界外的世界不可信。',
  '每个需求编号进模型注释，SWRS 追溯不靠人肉记忆。',
  '电池冷却目标温度是移动的：快充前预冷，馈电时省能。',
  '数据字典（Simulink Data Dictionary）统一量纲，°C 和 K 打架是低级但致命的错。',
  '代码生成后 diff 一眼扫过，Embedded Coder 的配置漂移早发现。',
  '台架数据回灌仿真，模型可信度用数据说话。'
]

/** 内置池：按模式取保底内容 */
export const BUILTIN_POOLS: Record<string, string[]> = {
  quotes: QUOTES,
  exp: EXPERIENCE,
  agent: AGENT_TIPS,
  thermal: THERMAL_TIPS
}

/** AI 刷新提示词：一次生成全部启用主题的新批次（含用户自定义主题） */
export function barRefreshPrompt(topics: { key: string; desc: string }[]): string {
  const spec = topics.map((t) => `"${t.key}": [10 条，主题：${t.desc}]`).join(', ')
  return (
    '为一个屏幕顶部的迷你滚动条生成轮播内容。每条 ≤ 42 字、一行、有味道、可独立阅读，不要编号。' +
    `\n只输出一个 JSON 对象：{ ${spec} }` +
    '\n中文为主（名言可带英文原文）。内容要新颖，避免最常见的陈词滥调。'
  )
}

export function parseBarRefresh(raw: string | undefined, keys: string[]): Record<string, string[]> | null {
  if (!raw) return null
  let t = String(raw).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s === -1 || e === -1) return null
  try {
    const o = JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>
    const out: Record<string, string[]> = {}
    for (const k of keys) {
      const arr = o[k]
      if (Array.isArray(arr)) out[k] = arr.map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 15)
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}
