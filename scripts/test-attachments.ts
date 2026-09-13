// 附件外置测试：持久化边界上的"落盘 + 引用"与"回填"往返，含去重、失败保内联、丢失容错。
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  attachmentFileName,
  attachmentHash,
  externalizeAttachments,
  inlineAttachments,
  referencedAttachmentFiles,
  splitImageDataUrl
} from '../src/main/attachment-store.ts'

const ok = (condition: unknown, message: string): void => {
  if (condition) console.log(`✓ ${message}`)
  else { console.error(`❌ ${message}`); process.exit(1) }
}

// 1×1 红点 PNG（合法图片，仅用于验证字节往返）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const PNG = `data:image/png;base64,${PNG_B64}`
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

const okUrl = splitImageDataUrl(PNG)
ok(okUrl?.ext === 'png' && okUrl.base64 === PNG_B64, 'dataURL 解析：png 载荷与扩展名')
ok(splitImageDataUrl(JPEG)?.ext === 'jpeg', 'dataURL 解析：jpeg 归一化')
ok(splitImageDataUrl('data:image/png;base64,AAA BBB')?.base64 === 'AAABBB', 'dataURL 解析：剥离换行/空白')
ok(splitImageDataUrl('https://x.test/a.png') === null, '非 base64 图片（外链）不参与外置')
ok(splitImageDataUrl('data:text/plain;base64,QUJD') === null, '非 image/* 不参与外置')
ok(splitImageDataUrl(undefined) === null, '非字符串安全返回 null')

// ── 端到端：内存状态 → 外置 → JSON 落盘 → JSON 读回 → 回填 ──
const dir = mkdtempSync(join(tmpdir(), 'aiisland-att-'))
/** 每次场景都用原始副本：externalize 会原地把内联字段改成引用 */
const makeState = (): Record<string, unknown> => ({
  theme: 'x',
  askThread: [
    { role: 'user', text: '看这张图', attachments: [{ type: 'screenshot', name: '截图', thumb: PNG, dataUrl: PNG }] },
    { role: 'agent', blocks: [{ t: 'p', text: '好' }] }
  ],
  askSessions: [
    { id: 1, title: '归档', msgs: [{ role: 'user', text: '旧会话', attachments: [{ type: 'screenshot', name: '图2', thumb: JPEG, dataUrl: JPEG }] }] }
  ]
})
const state = makeState()

const writes = new Map<string, string>()
let failNext = false
const writeFile = (hash: string, ext: string, base64: string): boolean => {
  if (failNext) return false
  const name = attachmentFileName(hash, ext)
  if (!writes.has(name)) writes.set(name, base64)
  return true
}

const external = externalizeAttachments(state, writeFile)
ok(external.written === 2, `按文件去重后写入 2 个（PNG 一份 + JPEG 一份；实际 ${external.written}）`)
ok(external.keptInline === 0, '全部字段成功外置')
ok(external.referenced.size === 2, '引用集合含 2 个文件（PNG 与 JPEG）')

const persisted = JSON.stringify(state)
ok(!persisted.includes(PNG_B64.slice(0, 60)), '落盘 JSON 不再包含内联 base64（体积问题已解决）')
ok(persisted.includes('"ref"'), '落盘 JSON 以引用对象占位')

// 真实文件系统往返
const realDir = join(dir, 'attachments')
mkdirSync(realDir, { recursive: true })
const realWrite = (hash: string, ext: string, base64: string): boolean => {
  writeFileSync(join(realDir, attachmentFileName(hash, ext)), Buffer.from(base64, 'base64'))
  return true
}
const realRead = (hash: string, ext: string): string | null => {
  const file = join(realDir, attachmentFileName(hash, ext))
  return existsSync(file) ? readFileSync(file).toString('base64') : null
}
const diskState = makeState()
externalizeAttachments(diskState, realWrite)
const roundTrip = JSON.parse(JSON.stringify(diskState)) as Record<string, unknown>
const inlineStats = inlineAttachments(roundTrip, realRead)
ok(inlineStats.restored === 4 && inlineStats.missing === 0, '回填：4 个字段全部还原（当前分支 2 + 归档 2）')
const msgs = (roundTrip.askThread as { attachments: { thumb?: string; dataUrl?: string }[] }[])[0]
ok(msgs.attachments[0].dataUrl === PNG && msgs.attachments[0].thumb === PNG, '回填内容与原始 dataURL 完全一致')
const archived = (roundTrip.askSessions as { msgs: { attachments: { thumb?: string; dataUrl?: string }[] }[] }[])[0].msgs[0]
ok(archived.attachments[0].thumb === JPEG && archived.attachments[0].dataUrl === JPEG, '归档会话也完成回填（含 JPEG）')

// 文件丢失：移除字段而不是留下坏引用
rmSync(join(realDir, attachmentFileName(attachmentHash(PNG_B64), 'png')), { force: true })
const missingState = JSON.parse(JSON.stringify(diskState)) as Record<string, unknown>
const missingStats = inlineAttachments(missingState, realRead)
ok(missingStats.missing === 2 && missingStats.restored === 2, '文件缺失：只统计缺失项、其余正常回填')
const missingAtt = (missingState.askThread as { attachments: Record<string, unknown>[] }[])[0].attachments[0]
ok(!('thumb' in missingAtt) && !('dataUrl' in missingAtt), '缺失附件移除字段，不留坏引用')

// 写入失败：保留内联（宁可不省空间也不丢图）
const failureState = { askThread: [{ role: 'user', attachments: [{ type: 'screenshot', name: 's', thumb: PNG }] }] }
failNext = true
const failResult = externalizeAttachments(failureState, writeFile)
failNext = false
ok(failResult.written === 0 && failResult.keptInline === 1, '写盘失败：计为保留内联')
const keptAtt = (failureState.askThread as { attachments: { thumb?: unknown }[] }[])[0].attachments[0]
ok(keptAtt.thumb === PNG, '写盘失败后原 dataURL 原样保留（不丢图）')

// 去重：同一张图出现两次只写一次
const dupState = {
  askThread: [
    { attachments: [{ type: 'screenshot', name: 'a', dataUrl: PNG }] },
    { attachments: [{ type: 'screenshot', name: 'b', dataUrl: PNG }] }
  ]
}
const dupWrites: string[] = []
const dupResult = externalizeAttachments(dupState, (hash, ext) => { dupWrites.push(attachmentFileName(hash, ext)); return true })
ok(dupResult.written === 1 && dupWrites.length === 1, '相同图片按内容哈希去重，只落盘一次')
ok(dupResult.referenced.size === 1, '去重后引用集合只有一个文件')

// GC 引用集：能从状态中提取全部被引用文件
const refs = referencedAttachmentFiles(diskState as Record<string, unknown>)
ok(refs.size === 2 && refs.has(attachmentFileName(attachmentHash(PNG_B64), 'png')), 'GC 引用集：含 png 与 jpeg 两个文件')

// 非图片字段/无附件消息不报错
ok(externalizeAttachments({ askThread: [{ text: 'x' }, { attachments: [{ type: 'file', content: 'text' }] }] }, writeFile).written === 0, '无图片附件时不写入')

rmSync(dir, { recursive: true, force: true })
console.log('attachment store tests passed')
process.exit(0)
