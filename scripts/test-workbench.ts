import assert from 'node:assert/strict'
import { migrateProjects, newProject, projectForTodo } from '../src/renderer/src/logic/workbench.ts'

let checks = 0
const check = (condition: unknown, message: string): void => {
  assert.ok(condition, message)
  checks++
}

const created = newProject('控制器平台', 'E:\\work\\控制器平台', 2)
check(created.name === '控制器平台', '项目名称应保留')
check(created.repoPath === 'E:\\work\\控制器平台', '项目仓库应保留')
check(created.status === 'active', '新项目默认激活')

const migrated = migrateProjects({
  todos: [
    { id: 1, text: '审查需求', done: false, project: '控制器平台', createdAt: 1 },
    { id: 2, text: '补测试', done: false, project: '控制器平台', createdAt: 2 }
  ],
  repos: [{ path: 'E:\\work\\控制器平台' }, { path: 'E:\\work\\sim-model' }]
})
check(migrated.length === 2, '迁移应去重同名项目并合并仓库')
check(migrated.some((p) => p.name === '控制器平台' && p.repoPath === 'E:\\work\\控制器平台'), '同名待办项目应关联仓库')
check(migrated.some((p) => p.name === 'sim-model'), '独立仓库应生成项目')

const saved = [newProject('已保存项目')]
check(migrateProjects({ workbenchProjects: saved }) === saved, '已有作战台项目应作为唯一真源')

const legacyTodo = { id: 3, text: '旧任务', done: false, project: '控制器平台', createdAt: 3 }
check(projectForTodo(legacyTodo, [created])?.id === created.id, '旧任务应按项目名称兼容关联')
check(projectForTodo({ ...legacyTodo, project: undefined, projectId: created.id }, [created])?.id === created.id, '新任务应按稳定标识关联')

console.log(`workbench tests passed: ${checks}`)
