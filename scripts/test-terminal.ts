import assert from 'node:assert/strict'
import { consumeTerminalInput, extractPowerShellCwd, quotePowerShellLiteral, setLocationCommand, TERMINAL_COMMANDS, updateTerminalCwd } from '../src/renderer/src/logic/terminal.ts'

assert.equal(quotePowerShellLiteral("E:\\O'Brien\\repo"), "'E:\\O''Brien\\repo'")
assert.equal(setLocationCommand(' E:\\work\\repo '), "Set-Location -LiteralPath 'E:\\work\\repo'")
assert.equal(extractPowerShellCwd('\r\nPS E:\\work\\repo> '), 'E:\\work\\repo')
assert.equal(extractPowerShellCwd('\x1b[32mPS C:\\Users\\Lenovo>\x1b[0m '), 'C:\\Users\\Lenovo')
assert.equal(extractPowerShellCwd('普通输出'), null)

const tabs = [{ id: 't1', cwd: 'E:\\work' }, { id: 't2' }]
assert.equal(updateTerminalCwd(tabs, 't1', 'E:\\work'), tabs, '相同目录必须保持原引用，避免字符回显触发重渲染')
const changedTabs = updateTerminalCwd(tabs, 't2', 'D:\\repo')
assert.notEqual(changedTabs, tabs)
assert.equal(changedTabs[1].cwd, 'D:\\repo')
assert.equal(updateTerminalCwd(tabs, 'missing', 'D:\\repo'), tabs)

let input = consumeTerminalInput('', 'git status')
assert.equal(input.buffer, 'git status')
input = consumeTerminalInput(input.buffer, '\x7f')
assert.equal(input.buffer, 'git statu')
input = consumeTerminalInput(input.buffer, 's\r')
assert.equal(input.submitted, 'git status')
assert.equal(input.buffer, '')

assert.equal(consumeTerminalInput('secret', '\x03').buffer, '')
assert.equal(new Set(TERMINAL_COMMANDS.map((x) => x.id)).size, TERMINAL_COMMANDS.length)
for (const group of ['项目', 'Git', 'Node', '系统']) {
  assert.ok(TERMINAL_COMMANDS.filter((x) => x.group === group).length >= 4, `${group} 应至少有四条命令`)
}
assert.ok(TERMINAL_COMMANDS.every((x) => x.command && x.label && x.description))

console.log('terminal logic tests passed')
