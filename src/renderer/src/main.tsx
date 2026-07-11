import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Widget } from './Widget'
import { Sticky } from './Sticky'

// 同一渲染入口按 hash 分流：#widget → 桌面挂件；#sticky → 钉屏便利贴；否则主灵动岛
const hash = window.location.hash
const root = hash === '#widget' ? <Widget /> : hash === '#sticky' ? <Sticky /> : <App />

createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>)
