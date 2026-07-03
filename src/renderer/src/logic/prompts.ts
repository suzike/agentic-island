// 问答快捷指令的出厂默认（用户可在问答区 ✎ 管理里增删改，改动持久化；可一键恢复默认）。

import type { QuickPrompt } from '../types'

export const DEFAULT_QUICK_PROMPTS: QuickPrompt[] = [
  { id: 1, icon: '📖', label: '解释代码', text: '解释下面这段代码的作用与关键逻辑：\n' },
  { id: 2, icon: '🐛', label: '找 Bug', text: '帮我找出下面代码/报错中的问题并给出修复：\n' },
  { id: 3, icon: '⚡', label: '优化性能', text: '请从性能角度审查并优化下面的代码：\n' },
  { id: 4, icon: '🧪', label: '写测试', text: '为下面的代码编写单元测试（含边界用例）：\n' },
  { id: 5, icon: '🔤', label: '写正则', text: '帮我写一个正则表达式，要求：' },
  { id: 6, icon: '🌐', label: '中英互译', text: '翻译下面的内容（中英互译，保留术语）：\n' }
]
