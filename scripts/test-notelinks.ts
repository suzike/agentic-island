// 便签双链 + Markdown→HTML 单测。
// 运行：node --experimental-strip-types scripts/test-notelinks.ts

import { extractLinks, buildGraph, backlinks } from '../src/renderer/src/logic/noteLinks.ts'
import { mdToHtml } from '../src/renderer/src/logic/mdHtml.ts'

let failed = 0
const ok = (c: boolean, m: string): void => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) failed++ }

// extractLinks
ok(JSON.stringify(extractLinks('见 [[热管理架构]] 与 [[MIL 测试]]，还有 [[热管理架构]]')) === JSON.stringify(['热管理架构', 'MIL 测试']), 'extractLinks 去重')
ok(extractLinks('没有链接').length === 0, '无链接返回空')

const notes = [
  { id: 1, emoji: '', title: '热管理架构', md: '核心见 [[电子水泵]]', color: 'sky', tags: [], createdAt: 0, updatedAt: 0 },
  { id: 2, emoji: '', title: '电子水泵', md: '被 [[热管理架构]] 引用', color: 'violet', tags: [], createdAt: 0, updatedAt: 0 },
  { id: 3, emoji: '', title: '孤立便签', md: '无链接', color: 'amber', tags: [], createdAt: 0, updatedAt: 0 }
] as never[]

const g = buildGraph(notes)
ok(g.nodes.length === 2, `图节点=2（孤立不入），实际 ${g.nodes.length}`)
ok(g.edges.length === 2, `双向边=2，实际 ${g.edges.length}`)
ok(g.nodes.find((n) => n.id === 1)?.deg === 2, '节点度数统计')
ok(backlinks(notes, '热管理架构').length === 1 && backlinks(notes, '热管理架构')[0].id === 2, '反向链接')

// mdToHtml
const html = mdToHtml('## 标题\n\n- 项目 **粗** `代码`\n\n> 引用\n\n见 [[另一条]]')
ok(html.includes('<h3>') && html.includes('标题'), 'HTML 标题')
ok(html.includes('<ul') && html.includes('<li>') && html.includes('<strong>粗</strong>'), 'HTML 列表+粗体')
ok(html.includes('<blockquote'), 'HTML 引用')
ok(html.includes('<b>另一条</b>'), '双链转粗体')
ok(!/<script/i.test(mdToHtml('<script>alert(1)</script>')), 'HTML 转义防注入')

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 个失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
