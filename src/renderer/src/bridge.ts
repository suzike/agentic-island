// 桌面应用桥接：preload 已通过 contextBridge 注入 window.island。
import type { IslandBridgeApi } from '../../shared/protocol'

export const island: IslandBridgeApi = (window as unknown as { island: IslandBridgeApi }).island
