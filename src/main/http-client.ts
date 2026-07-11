// 主进程统一 HTTP 客户端：使用 Electron net.fetch 继承系统代理。
// 动态 import electron，避免 raw-node 测试加载纯逻辑模块时碰到 Electron 运行时依赖。

export interface NetFetchOptions extends RequestInit {
  timeoutMs?: number
}

export async function netFetch(url: string, opts: NetFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 20000, signal, ...rest } = opts
  const { net } = await import('electron')
  const ctrl = new AbortController()
  const abort = (): void => ctrl.abort()
  let timer: NodeJS.Timeout | undefined
  if (timeoutMs > 0) timer = setTimeout(abort, timeoutMs)
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', abort, { once: true })
  }
  try {
    return await net.fetch(url, { ...rest, signal: ctrl.signal })
  } finally {
    if (timer) clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', abort)
  }
}
