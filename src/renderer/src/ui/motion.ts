// framer-motion 动效预设 v2 —— Apple 动效语言。
//  1. 弹簧用 iOS 式软弹簧（stiffness 300-400 / damping 26-32），不用硬回弹。
//  2. 按压反馈对齐 iOS：以透明度下沉为主（0.55），缩放极轻（0.98）。
//  3. 面板内卡片/列表项只做 opacity（禁 translate/blur——甩出面板与掉帧的两个已知坑）。
//  4. 浮层允许小位移（自锚点弹出，iOS sheet/menu 感）。
import type { Variants, Transition } from 'framer-motion'

/** 标准缓动（与 tokens.MOTION.ease 一致） */
export const EASE_STANDARD = [0.22, 0.61, 0.36, 1] as const
/** iOS sheet 弹出缓动 */
export const EASE_SPRING = [0.32, 1.12, 0.5, 1] as const

/** iOS 软弹簧（segmented 滑块、开关 knob） */
export const springSoft: Transition = { type: 'spring', stiffness: 350, damping: 30 }
/** 轻快弹簧（小件按压） */
export const springPop: Transition = { type: 'spring', stiffness: 480, damping: 28 }

/* ---------------- 入场/退场 ----------------
 * 性能约束：透明窗口 + 大树禁 filter: blur（掉帧）；面板内禁 translate（甩出面板）。 */

/** 卡片/区块入场：快速淡入 */
export const fadeScaleIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18, ease: EASE_STANDARD } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: EASE_STANDARD } },
}

/** Tab 内容切换：纯透明度快速交叉淡化 */
export const tabContent: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.13, ease: EASE_STANDARD } },
  exit: { opacity: 0, transition: { duration: 0.08 } },
}

/** 浮层弹出：自锚点放大 + 微上浮（iOS context menu / sheet 感） */
export const overlayPop: Variants = {
  initial: { opacity: 0, scale: 0.97, y: -4 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.2, ease: EASE_SPRING } },
  exit: { opacity: 0, scale: 0.98, y: -3, transition: { duration: 0.12, ease: EASE_STANDARD } },
}

/* ---------------- 列表 stagger ---------------- */

/** 列表容器：子项交错入场（首屏建议 ≤12 项） */
export const staggerContainer: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.024, delayChildren: 0.01 } },
}

/** 列表子项：纯淡入 */
export const staggerItem: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18, ease: EASE_STANDARD } },
}

/* ---------------- 微交互（Apple 式：透明度下沉 + 极轻缩放） ---------------- */

/** 可按压：iOS 式 opacity 下沉 + 0.98 微缩（不再做明显的 scale 弹跳） */
export const pressable = {
  whileHover: { opacity: 0.82 },
  whileTap: { opacity: 0.55, scale: 0.98 },
  transition: { duration: 0.12 },
} as const

/** 温和按压（大卡片：只降透明度） */
export const pressableGentle = {
  whileHover: { opacity: 0.9 },
  whileTap: { opacity: 0.7 },
  transition: { duration: 0.12 },
} as const

/** 勾选完成：轻弹勾 */
export const checkPop: Variants = {
  initial: { scale: 0.4, opacity: 0 },
  animate: { scale: 1, opacity: 1, transition: springPop },
}
