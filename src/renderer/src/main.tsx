import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Widget } from './Widget'
import { Sticky } from './Sticky'
import { PinnedShot } from './PinnedShot'
import { SnipOverlay } from './SnipOverlay'
import { ScrollHud } from './ScrollHud'

// 同一渲染入口按 hash 分流：#widget → 桌面挂件；#sticky → 钉屏便利贴；#pin → 钉屏截图；#snip → 框选叠层；#scrollhud → 滚动截图进度；否则主灵动岛
const hash = window.location.hash
const root = hash === '#widget' ? <Widget /> : hash === '#sticky' ? <Sticky /> : hash === '#pin' ? <PinnedShot /> : hash === '#snip' ? <SnipOverlay /> : hash === '#scrollhud' ? <ScrollHud /> : <App />

createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>)
