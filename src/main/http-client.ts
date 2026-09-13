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

/** 流式读取响应体并在超过 maxBytes 时中止——恶意/异常的大响应不再能把主进程内存打爆。 */
export async function readBodyText(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers?.get?.('content-length') || 0)
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`响应超过大小上限（${Math.round(maxBytes / 1024 / 1024)}MB）`)
  const reader = res.body?.getReader?.()
  if (!reader) return res.text()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
    if (out.length > maxBytes) {
      try { await reader.cancel() } catch { /* 已中断即可 */ }
      throw new Error(`响应超过大小上限（${Math.round(maxBytes / 1024 / 1024)}MB）`)
    }
  }
  return out + decoder.decode()
}
