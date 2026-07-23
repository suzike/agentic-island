import type { AnswerAnalysisAction, AnswerMethodId } from '../types'

export type AnswerMethodGroup = 'structure' | 'reasoning' | 'decision' | 'innovation' | 'execution'
export type AnalysisMethodGroup = 'evidence' | 'reasoning' | 'risk' | 'decision' | 'execution'

export interface AnswerMethodDefinition {
  id: AnswerMethodId
  group: AnswerMethodGroup
  label: string
  framework: string
  description: string
  outcome: string
  prompt: string
  keywords: string[]
}

export interface AnalysisMethodDefinition {
  id: Exclude<AnswerAnalysisAction, 'council'>
  group: AnalysisMethodGroup
  label: string
  framework: string
  description: string
  outcome: string
  prompt: string
  keywords: string[]
  priority: number
}

export const ANSWER_METHOD_GROUPS: Array<{ id: AnswerMethodGroup; label: string; description: string }> = [
  { id: 'structure', label: '表达组织', description: '让答案层次清楚、易于沟通' },
  { id: 'reasoning', label: '推理求解', description: '从原理、因果和证据展开' },
  { id: 'decision', label: '决策判断', description: '比较选择、处理不确定性' },
  { id: 'innovation', label: '创新设计', description: '发现需求并突破常规方案' },
  { id: 'execution', label: '行动落地', description: '形成可实施、可评审的方案' }
]

export const ANSWER_METHODS: AnswerMethodDefinition[] = [
  {
    id: 'pyramid', group: 'structure', label: '金字塔原理', framework: 'Pyramid Principle',
    description: '先给结论，再用互不重叠的理由逐层支撑。',
    outcome: '结论 → 关键依据 → 行动建议',
    prompt: '本轮采用金字塔原理：先给一个明确结论，再以不重不漏的分组给出关键依据，最后给出行动建议。每层内容必须支撑上一层，避免平铺信息。',
    keywords: ['汇报', '总结', '概括', '结论', '老板', '领导', 'brief', 'summary', 'executive']
  },
  {
    id: 'mece', group: 'structure', label: 'MECE 拆解', framework: 'MECE',
    description: '把复杂主题拆成相互独立、整体穷尽的部分。',
    outcome: '问题边界 → 完整分类 → 逐类结论',
    prompt: '本轮采用 MECE：先界定问题边界，再按相互独立、整体穷尽的维度拆解；说明分类依据，检查重叠与遗漏，最后合并为整体结论。',
    keywords: ['分类', '框架', '全面', '完整', '梳理', '维度', '模块', '体系', 'structure']
  },
  {
    id: 'feynman', group: 'structure', label: '费曼解释法', framework: 'Feynman Technique',
    description: '用朴素语言解释机制，并暴露理解断点。',
    outcome: '一句话解释 → 机制 → 示例 → 易错点',
    prompt: '本轮采用费曼解释法：先用非专业人士也能理解的一句话解释，再讲核心机制和具体例子；指出最容易误解的地方，最后用一个自检问题确认是否真正理解。',
    keywords: ['解释', '是什么', '原理', '入门', '学习', '理解', '通俗', 'teach', 'explain']
  },
  {
    id: 'socratic-answer', group: 'structure', label: '苏格拉底式回答', framework: 'Socratic Method',
    description: '先识别关键未知，再给带条件的阶段性判断。',
    outcome: '关键问题 → 暂定判断 → 条件分支',
    prompt: '本轮采用苏格拉底式协作：先提出 3 至 5 个会显著改变答案的关键问题；在信息不足时仍给出带条件的暂定判断，并清楚列出不同回答会如何改变结论。',
    keywords: ['需求不清', '澄清', '应该吗', '是否', '可不可以', '怎么选', '不确定', 'clarify']
  },
  {
    id: 'first-principles', group: 'reasoning', label: '第一性原理', framework: 'First Principles',
    description: '剥离惯例，从不可再简化的事实重新推导。',
    outcome: '基本事实 → 约束 → 从零推导',
    prompt: '本轮采用第一性原理：区分事实、假设和行业惯例，把问题还原到不可再简化的基本事实与约束，再从零推导方案；不要把常见做法当作必然正确。',
    keywords: ['为什么', '本质', '从零', '突破', '根本', '原理', '重新设计', 'first principles']
  },
  {
    id: 'systems-thinking', group: 'reasoning', label: '系统思维', framework: 'Systems Thinking',
    description: '分析要素、反馈回路、延迟和整体副作用。',
    outcome: '系统边界 → 反馈回路 → 杠杆点',
    prompt: '本轮采用系统思维：定义系统边界和关键参与者，识别因果关系、增强/平衡反馈回路、时间延迟与非预期后果，最后指出最有影响力的杠杆点。',
    keywords: ['系统', '长期', '影响', '生态', '组织', '复杂', '反馈', '联动', 'system']
  },
  {
    id: 'scientific-method', group: 'reasoning', label: '科学方法', framework: 'Scientific Method',
    description: '把判断转成可证伪假设和可重复验证。',
    outcome: '假设 → 实验 → 指标 → 判定标准',
    prompt: '本轮采用科学方法：把核心判断写成可证伪假设，给出对照实验、变量、测量指标、样本或观察窗口、成功阈值和可能混淆因素；区分证据与推测。',
    keywords: ['验证', '实验', '测试', '数据', '证据', '假设', '效果', '评估', 'experiment']
  },
  {
    id: 'decision-matrix', group: 'decision', label: '决策矩阵', framework: 'Weighted Decision Matrix',
    description: '用权重、评分和敏感性比较多个选项。',
    outcome: '标准/权重 → 评分 → 敏感性 → 建议',
    prompt: '本轮采用加权决策矩阵：列出候选方案、评价标准、权重和评分依据；计算或定性比较总分，并做权重敏感性检查，说明在什么条件下推荐会改变。',
    keywords: ['选择', '比较', '哪个好', '选型', '方案', '决策', '权衡', 'buy', 'versus', 'vs']
  },
  {
    id: 'scenario-planning', group: 'decision', label: '情景规划', framework: 'Scenario Planning',
    description: '围绕关键不确定性推演不同未来。',
    outcome: '关键变量 → 情景 → 预警信号 → 对策',
    prompt: '本轮采用情景规划：找出两个最关键的不确定性，构造 3 至 4 个有区分度的情景；分别说明影响、早期信号、稳健策略和需要保留的选择权。',
    keywords: ['未来', '趋势', '不确定', '预测', '风险', '规划', '如果', 'scenario']
  },
  {
    id: 'six-thinking-hats', group: 'decision', label: '六顶思考帽', framework: 'Six Thinking Hats',
    description: '分离事实、感受、风险、收益、创意和过程。',
    outcome: '六种视角 → 冲突点 → 综合判断',
    prompt: '本轮采用六顶思考帽：分别从事实、直觉感受、风险、价值收益、创造性替代和过程控制六个视角审视问题，最后综合冲突并给出决定。',
    keywords: ['讨论', '团队', '视角', '创意', '利弊', '头脑风暴', '观点', 'hats']
  },
  {
    id: 'jobs-to-be-done', group: 'innovation', label: 'JTBD', framework: 'Jobs to Be Done',
    description: '围绕用户要完成的进步，而不是已有功能。',
    outcome: '情境 → 任务 → 阻力 → 成功标准',
    prompt: '本轮采用 Jobs to Be Done：描述用户在什么情境下想取得什么进步，识别功能、情感和社会层面的任务，以及推动力、阻力和替代方案；以可观察的成功标准收尾。',
    keywords: ['用户', '产品', '需求', '功能', '客户', '体验', '使用场景', 'jtbd']
  },
  {
    id: 'design-thinking', group: 'innovation', label: '设计思维', framework: 'Design Thinking',
    description: '从真实用户洞察走向可快速验证的原型。',
    outcome: '同理 → 定义 → 创意 → 原型 → 测试',
    prompt: '本轮采用设计思维：先描述目标用户、场景和痛点，再重构问题陈述；提出多种方案，选出最小可行原型，并设计低成本用户测试与学习指标。',
    keywords: ['设计', '体验', '界面', '流程', '用户研究', '原型', '痛点', 'design']
  },
  {
    id: 'triz', group: 'innovation', label: 'TRIZ 创新', framework: 'TRIZ',
    description: '识别工程矛盾，寻找无需妥协的解法。',
    outcome: '矛盾 → 理想结果 → 分离原则 → 方案',
    prompt: '本轮采用 TRIZ：明确改善一个属性时恶化的另一个属性，描述理想最终结果与可用资源；应用时间/空间/条件分离或创新原理，提出避免简单折中的方案。',
    keywords: ['创新', '矛盾', '冲突', '性能', '成本', '优化', '工程难题', 'triz']
  },
  {
    id: 'ooda', group: 'execution', label: 'OODA 闭环', framework: 'OODA Loop',
    description: '在快速变化中形成观察、判断、行动闭环。',
    outcome: '观察 → 判断 → 决策 → 行动 → 反馈',
    prompt: '本轮采用 OODA：分别列出需要观察的事实、判断所需模型与偏差、当前可逆决策、立即行动和反馈信号；优先缩短下一轮学习周期。',
    keywords: ['快速', '应急', '迭代', '竞争', '动态', '响应', '执行', 'ooda']
  },
  {
    id: 'rfc-adr', group: 'execution', label: 'RFC / ADR', framework: 'RFC + Architecture Decision Record',
    description: '以工程评审格式记录背景、选项和决定。',
    outcome: '背景 → 约束 → 方案 → 决定 → 后果',
    prompt: '本轮采用 RFC/ADR 工程格式：写明背景、目标与非目标、约束、候选方案、决定及理由、正负后果、迁移步骤、验收标准和待确认问题。',
    keywords: ['架构', '技术方案', '开发', '实现', '重构', '接口', '数据库', '框架', 'rfc', 'adr']
  }
]

export const ANALYSIS_METHOD_GROUPS: Array<{ id: AnalysisMethodGroup; label: string; description: string }> = [
  { id: 'evidence', label: '事实证据', description: '检查事实、来源、假设和置信度' },
  { id: 'reasoning', label: '逻辑因果', description: '检查论证、根因与系统关系' },
  { id: 'risk', label: '风险压力', description: '主动寻找失败模式和边界条件' },
  { id: 'decision', label: '决策取舍', description: '比较方案、代价和不同立场' },
  { id: 'execution', label: '执行验证', description: '把结论变成步骤和验证闭环' }
]

export const ANALYSIS_METHODS: AnalysisMethodDefinition[] = [
  {
    id: 'ground', group: 'evidence', label: '知识库核验', framework: 'Grounded Verification', priority: 98,
    description: '用已接入资料逐条验证关键结论。', outcome: '已证实 / 冲突 / 无法证实',
    prompt: '请结合当前已接入知识库重新核验目标回答。提取关键主张，逐条给出支持资料、冲突证据或“无法证实”，只保留有依据的结论并标明知识缺口。',
    keywords: ['资料', '文档', '规范', '知识库', '事实', '来源', '政策', '标准']
  },
  {
    id: 'evidence-audit', group: 'evidence', label: '证据置信审计', framework: 'Claim-Evidence-Confidence', priority: 96,
    description: '区分事实、推断和建议，并校准置信度。', outcome: '主张 → 证据 → 置信度 → 补证',
    prompt: '请使用“主张-证据-置信度”框架审计目标回答。逐条标记事实、推断、价值判断和建议；说明证据质量、反证、置信度及提升置信度所需的最小补充信息。',
    keywords: ['数据', '研究', '事实', '准确', '可信', '证据', '引用', '结论']
  },
  {
    id: 'assumptions', group: 'evidence', label: '假设地图', framework: 'Assumption Mapping', priority: 92,
    description: '暴露显式与隐含假设并安排验证优先级。', outcome: '假设 → 影响/不确定性 → 验证',
    prompt: '请建立假设地图：列出目标回答中的显式假设、隐含假设和未知信息，按“影响高低 × 不确定性高低”分类；优先给出高影响高不确定假设的验证方式。',
    keywords: ['假设', '前提', '未知', '依赖', '条件', '不确定']
  },
  {
    id: 'critique', group: 'reasoning', label: '逻辑漏洞审查', framework: 'Critical Review', priority: 95,
    description: '定位论证跳跃、遗漏和不可执行结论。', outcome: '问题 → 影响 → 修正结论',
    prompt: '请严格审查目标回答：找出逻辑跳跃、概念混淆、遗漏、错误前提和不够可执行之处。每项说明为什么有问题、影响什么，并给出修正后的结论。',
    keywords: ['逻辑', '漏洞', '审查', '错误', '严谨', '反驳', '推理']
  },
  {
    id: 'steelman', group: 'reasoning', label: '钢人化论证', framework: 'Steelman Argument', priority: 78,
    description: '把核心观点重构成最强、最公平的版本。', outcome: '最强论证 → 适用边界 → 仍存缺口',
    prompt: '请对目标回答进行钢人化：先识别其最有价值的核心主张，再补齐最强证据和最合理解释，使其成为最难反驳的版本；随后明确即使钢人化后仍然存在的边界。',
    keywords: ['观点', '论证', '争论', '辩论', '立场', '反对']
  },
  {
    id: 'causal-map', group: 'reasoning', label: '因果关系图', framework: 'Causal Mapping', priority: 88,
    description: '区分相关与因果，识别中介、混杂和反馈。', outcome: '变量 → 因果链 → 混杂 → 杠杆点',
    prompt: '请把目标回答重构为文字版因果图：列出关键变量和方向，区分相关与因果，指出中介变量、混杂因素、反馈回路和时间延迟，并标出最值得干预的杠杆点。',
    keywords: ['原因', '影响', '导致', '机制', '因果', '相关', '系统']
  },
  {
    id: 'five-whys', group: 'reasoning', label: '5 Whys 根因', framework: 'Five Whys', priority: 86,
    description: '沿可验证因果链追到可干预根因。', outcome: '症状 → 因果链 → 根因 → 纠正措施',
    prompt: '请使用 5 Whys 分析目标回答涉及的问题。每一层“为什么”必须有可验证依据，避免把责任归因于个人；区分根因、促成因素和症状，并给出针对根因的措施。',
    keywords: ['故障', '问题', '失败', '异常', '根因', '为什么', '事故', 'bug']
  },
  {
    id: 'second-order', group: 'reasoning', label: '二阶效应', framework: 'Second-Order Thinking', priority: 84,
    description: '追踪立即影响之后的连锁反应和反馈。', outcome: '一阶 → 二阶 → 长期 → 反作用',
    prompt: '请做二阶效应分析：分别列出目标建议的立即影响、随后产生的行为适应、长期系统变化和可能反作用；区分可逆与不可逆后果，并指出容易被忽略的激励变化。',
    keywords: ['长期', '后果', '副作用', '影响', '策略', '政策', '组织']
  },
  {
    id: 'counterfactual', group: 'reasoning', label: '反事实检验', framework: 'Counterfactual Reasoning', priority: 76,
    description: '改变关键条件，检验结论是否真的由其导致。', outcome: '基准事实 → 最小改变 → 结论变化',
    prompt: '请对目标回答做反事实检验：识别其认为最关键的原因，构造只改变一个条件的最小反事实，观察结论是否仍成立；指出必要条件、充分条件和可能的替代解释。',
    keywords: ['如果', '假如', '因果', '必要', '充分', '归因']
  },
  {
    id: 'red-team', group: 'risk', label: '红队挑战', framework: 'Red Team Analysis', priority: 97,
    description: '以强对手视角寻找最可能击穿方案的路径。', outcome: '攻击面 → 击穿路径 → 防护 → 残余风险',
    prompt: '请作为独立红队挑战目标回答。寻找最强反例、可被利用的假设、边界条件和对手策略；按严重度排序，给出防护措施，并明确措施后的残余风险。',
    keywords: ['安全', '风险', '方案', '上线', '攻击', '合规', '可靠', '审计']
  },
  {
    id: 'premortem', group: 'risk', label: '预演失败', framework: 'Pre-Mortem', priority: 94,
    description: '假设方案已经失败，倒推最可信原因和预警。', outcome: '失败叙事 → 原因 → 预警 → 预防',
    prompt: '假设目标回答中的方案在未来已经失败。请倒推 8 至 12 个具体且可信的失败原因，按概率和影响排序；为高风险项给出早期预警信号、负责人和预防措施。',
    keywords: ['项目', '计划', '上线', '实施', '风险', '交付', '迁移', '发布']
  },
  {
    id: 'fmea', group: 'risk', label: 'FMEA 失效分析', framework: 'Failure Mode and Effects Analysis', priority: 90,
    description: '系统识别失效模式、影响、原因和控制措施。', outcome: '失效模式 → S/O/D → 优先级 → 控制',
    prompt: '请对目标方案执行 FMEA。列出关键环节的失效模式、影响、原因、现有控制，分别评估严重度 S、发生度 O、可探测度 D（1-10），计算或比较风险优先级并给出改进。',
    keywords: ['可靠性', '质量', '失效', '安全', '硬件', '流程', '生产', '测试']
  },
  {
    id: 'scenario-stress', group: 'risk', label: '情景压力测试', framework: 'Scenario Stress Test', priority: 87,
    description: '用极端但合理的情景检验方案韧性。', outcome: '压力情景 → 断点 → 韧性措施',
    prompt: '请对目标回答做情景压力测试：至少覆盖需求暴增、资源减半、关键依赖失效、数据错误和外部规则变化。说明每种情景下首先断裂的环节、恢复时间和韧性措施。',
    keywords: ['容量', '高并发', '依赖', '灾难', '韧性', '极端', '压力', '容错']
  },
  {
    id: 'sensitivity', group: 'risk', label: '敏感性分析', framework: 'Sensitivity Analysis', priority: 82,
    description: '找出哪些参数变化最容易推翻结论。', outcome: '关键参数 → 变化范围 → 临界点',
    prompt: '请对目标结论做敏感性分析：识别最关键的参数、估计合理变化范围，说明单变量和组合变化如何影响结论，找出推荐发生反转的临界点。',
    keywords: ['参数', '估算', '成本', '收益', '预测', '模型', '阈值', '预算']
  },
  {
    id: 'alternatives', group: 'decision', label: '替代路径', framework: 'Alternative Generation', priority: 91,
    description: '提出原理不同的方案，而非同一方案的小改款。', outcome: '替代方案 → 适用条件 → 代价/失败模式',
    prompt: '请不要重复目标回答的方案，提出至少三条原理不同的替代路径。逐项比较适用条件、优势、代价、不可逆决定和典型失败模式，并指出何时应切换。',
    keywords: ['方案', '替代', '选择', '实现', '路线', '架构']
  },
  {
    id: 'decision-matrix', group: 'decision', label: '加权决策矩阵', framework: 'Weighted Decision Matrix', priority: 93,
    description: '用明确标准和权重比较原回答与备选项。', outcome: '标准/权重 → 评分 → 敏感性 → 推荐',
    prompt: '请把目标回答中的建议与主要备选项放入加权决策矩阵。给出标准、权重、评分和依据，做权重敏感性分析，并说明推荐在哪些条件下会改变。',
    keywords: ['选型', '比较', '选择', '哪个好', '决策', '权衡', 'vs']
  },
  {
    id: 'opportunity-cost', group: 'decision', label: '机会成本', framework: 'Opportunity Cost', priority: 83,
    description: '评估选择当前方案所放弃的最佳替代价值。', outcome: '投入 → 放弃项 → 边际价值 → 决策',
    prompt: '请分析目标建议的机会成本：明确稀缺资源、被放弃的最佳替代方案、短期与长期价值、沉没成本误区和边际收益，最后判断当前选择是否仍合理。',
    keywords: ['资源', '预算', '时间', '优先级', '投入', '取舍', '机会成本']
  },
  {
    id: 'stakeholder-map', group: 'decision', label: '利益相关者地图', framework: 'Stakeholder Mapping', priority: 79,
    description: '识别权力、利益、激励和潜在阻力。', outcome: '角色 → 权力/利益 → 立场 → 沟通策略',
    prompt: '请建立利益相关者地图：列出受目标建议影响的人群，评估权力、利益、激励、潜在收益和损失；预测支持/反对立场，并给出差异化沟通与参与策略。',
    keywords: ['团队', '组织', '客户', '用户', '部门', '沟通', '推动', '变革']
  },
  {
    id: 'decompose', group: 'execution', label: '依赖式拆解', framework: 'Work Breakdown + Dependency Map', priority: 92,
    description: '把复杂回答变成有依赖关系的可执行单元。', outcome: '子问题 → 依赖 → 关键路径 → 首步',
    prompt: '请把目标回答拆成可独立执行和验收的子问题，标出前置依赖、并行项、关键路径、负责人类型和完成定义；指出现在最应该启动的第一步。',
    keywords: ['执行', '步骤', '拆解', '开发', '任务', '落地', '实施']
  },
  {
    id: 'constraints', group: 'execution', label: '约束理论', framework: 'Theory of Constraints', priority: 89,
    description: '找出限制整体吞吐的单一核心约束。', outcome: '目标 → 约束 → 榨取 → 从属 → 提升',
    prompt: '请使用约束理论分析目标方案：明确系统目标与吞吐指标，找出当前核心约束；依次说明如何榨取约束、让其他环节服从约束、提升约束，并检查约束转移。',
    keywords: ['瓶颈', '效率', '流程', '产能', '性能', '吞吐', '进度', '约束']
  },
  {
    id: 'verification-plan', group: 'execution', label: '验证与验收计划', framework: 'Verification & Validation', priority: 96,
    description: '把回答里的关键承诺转成可执行验收项。', outcome: '主张 → 测试 → 指标 → 阈值 → 证据',
    prompt: '请把目标回答转成验证与验收计划。逐条提取关键承诺，定义测试方法、输入、环境、指标、通过阈值、边界/异常场景和需要保存的证据；区分验证“做对了”和确认“做的是对的”。',
    keywords: ['测试', '验收', '完成', '交付', '质量', '指标', '验证', '上线']
  },
  {
    id: 'socratic', group: 'execution', label: '关键澄清问题', framework: 'Socratic Questioning', priority: 77,
    description: '找出会实质改变方案选择的未知信息。', outcome: '关键问题 → 为什么重要 → 分支影响',
    prompt: '请基于目标回答提出 5 至 8 个高价值澄清问题。只问会显著改变方案、风险或优先级的问题；每个问题说明为什么重要，以及不同答案会如何改变结论。',
    keywords: ['不清楚', '需求', '确认', '信息不足', '澄清', '未知']
  },
  {
    id: 'suggest', group: 'execution', label: '高价值下一问', framework: 'Question Formulation', priority: 74,
    description: '生成能推动决策或实施的下一轮问题。', outcome: '4 个可直接追问的问题',
    prompt: '请基于当前完整会话生成 4 个高价值的下一问。问题必须推动决策、降低风险或进入实施，不得重复已经回答的内容。只输出 JSON 字符串数组。',
    keywords: ['下一步', '继续', '深入', '追问', '然后']
  }
]

export const ADVANCE_PROMPTS = Object.fromEntries(
  ANALYSIS_METHODS.map((method) => [method.id, method.prompt])
) as Record<Exclude<AnswerAnalysisAction, 'council'>, string>

function keywordScore(text: string, keywords: string[]): number {
  const normalized = text.toLowerCase()
  return keywords.reduce((score, keyword) => score + (normalized.includes(keyword.toLowerCase()) ? 5 : 0), 0)
}

export function answerMethodById(id?: AnswerMethodId): AnswerMethodDefinition | undefined {
  return id ? ANSWER_METHODS.find((method) => method.id === id) : undefined
}

export function answerMethodInstruction(id?: AnswerMethodId): string {
  const method = answerMethodById(id)
  return method ? `本轮回答方法（仅本轮生效）：${method.label} / ${method.framework}\n${method.prompt}` : ''
}

export function analysisMethodById(id: Exclude<AnswerAnalysisAction, 'council'>): AnalysisMethodDefinition {
  return ANALYSIS_METHODS.find((method) => method.id === id) || ANALYSIS_METHODS[0]
}

export function recommendAnswerMethods(question: string, limit = 3): AnswerMethodDefinition[] {
  const fallback: Partial<Record<AnswerMethodId, number>> = { pyramid: 3, 'first-principles': 2, 'rfc-adr': 1 }
  return [...ANSWER_METHODS]
    .map((method) => ({ method, score: keywordScore(question, method.keywords) + (fallback[method.id] || 0) }))
    .sort((a, b) => b.score - a.score || ANSWER_METHODS.indexOf(a.method) - ANSWER_METHODS.indexOf(b.method))
    .slice(0, Math.max(1, limit))
    .map(({ method }) => method)
}

export function recommendAnalysisMethods(question: string, answer: string, limit = 4): AnalysisMethodDefinition[] {
  const text = `${question}\n${answer}`
  return [...ANALYSIS_METHODS]
    .map((method) => ({ method, score: keywordScore(text, method.keywords) + method.priority / 20 }))
    .sort((a, b) => b.score - a.score || b.method.priority - a.method.priority)
    .slice(0, Math.max(1, limit))
    .map(({ method }) => method)
}
