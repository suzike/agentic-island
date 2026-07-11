import type { TodoItem, WorkbenchProject } from '../types'

export const PROJECT_HUES = [205, 150, 75, 265, 25, 325]

export function newProject(name: string, repoPath = '', index = 0): WorkbenchProject {
  const now = Date.now()
  return {
    id: `project-${now}-${index}`,
    name: name.trim().slice(0, 40),
    repoPath: repoPath.trim() || undefined,
    status: 'active',
    colorHue: PROJECT_HUES[index % PROJECT_HUES.length],
    createdAt: now,
    updatedAt: now
  }
}

/** 首次升级时把已有 todo.project 和已钉仓库变成项目，不改写原待办。 */
export function migrateProjects(saved: Record<string, unknown>): WorkbenchProject[] {
  if (Array.isArray(saved.workbenchProjects)) return saved.workbenchProjects as WorkbenchProject[]
  const names = new Map<string, string>()
  if (Array.isArray(saved.todos)) {
    for (const todo of saved.todos as TodoItem[]) {
      const name = todo.project?.trim()
      if (name) names.set(name.toLowerCase(), name)
    }
  }
  if (Array.isArray(saved.repos)) {
    for (const repo of saved.repos as { path?: string }[]) {
      const path = repo.path?.trim()
      if (!path) continue
      const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || path
      names.set(name.toLowerCase(), name)
    }
  }
  return [...names.values()].map((name, index) => {
    const repo = (saved.repos as { path?: string }[] | undefined)?.find((r) => r.path?.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.toLowerCase() === name.toLowerCase())
    return newProject(name, repo?.path || '', index)
  })
}

export function projectForTodo(todo: TodoItem, projects: WorkbenchProject[]): WorkbenchProject | undefined {
  return projects.find((p) => p.id === todo.projectId) || projects.find((p) => p.name === todo.project)
}
