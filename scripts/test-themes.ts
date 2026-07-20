import assert from 'node:assert/strict'
import { hexToOklch, huesForHarmony, makeCustomTheme, normalizeThemeIdentity, normalizeThemeTokens, oklchToHex, parseThemeIdentity, themeContrastRatios, THEMES } from '../src/renderer/src/logic/themes.ts'

let checks = 0
const check = (condition: unknown, message: string): void => {
  assert.ok(condition, message)
  checks++
}

const legacy = normalizeThemeTokens({ th: '168', th2: '196', ths: '176', cs: '.9', css: '1.5', pl: '1.1' })
check(legacy.mode === 'dark', '旧主题应迁移为深色外观')
check(Math.abs(+legacy.bg - .17) < .01, '旧 pl 应迁移为接近原视觉的面板明度')
check(+legacy.ga >= .9 && +legacy.bl >= 20, '旧主题应补齐玻璃参数')
check(+legacy.c1 > 0 && +legacy.c2 > 0 && +legacy.sc > 0, '旧主题应补齐独立 OKLCH 通道')

const unsafe = normalizeThemeTokens({ th: '-20', th2: '999', ths: 'bad', cs: '8', css: '-2', mode: 'light', bg: '4', ga: '.1', fi: '9', bl: '200', sh: '-1' })
check(unsafe.th === '0' && unsafe.th2 === '360', '导入色相应限制在完整 0-360 范围')
check(unsafe.bg === '0.94' && unsafe.ga === '0.25' && unsafe.bl === '56', '导入材质参数应限制在安全范围')
check(unsafe.c1 === '0.22' && unsafe.tx === '0.18', '缺失的高级色彩与文字令牌应使用安全默认值')

const controlCenter = THEMES.find((theme) => theme.key === 'control-center')
check(controlCenter?.mode === 'light', '应提供冰川控制中心浅色主题')
check(+normalizeThemeTokens(controlCenter || {}).bg > .7, '控制中心主题应使用明亮冷蓝玻璃')
check(themeContrastRatios(controlCenter || {}).primary >= 4.5, '内置控制中心主题的主按钮应达到 WCAG AA')

const complementary = huesForHarmony(30, 'complementary')
check(complementary.th2 === 210 && complementary.ths === 38, '互补关系应生成正确副色和面板色')
const wrapped = huesForHarmony(350, 'analogous')
check(wrapped.th2 === 22 && wrapped.ths === 328, '配色关系应正确跨越 360 度边界')

const custom = makeCustomTheme('custom-test', '测试主题', {
  th: '12', th2: '132', ths: '252', cs: '1.1', css: '1.2', mode: 'light', bg: '.84', ga: '.88', fi: '1.2', bl: '40', sh: '.5'
})
check(custom.mode === 'light' && custom.bg === '0.84', '自定义主题应持久化完整外观令牌')
check(custom.desc.includes('浅色'), '自定义主题说明应反映明暗外观')
const transparent = makeCustomTheme('custom-transparent', '透明主题', { ...custom, ga: '.33' })
check(transparent.ga === '0.33', '自定义主题应持久化可调透明度')

const aiIdentity = parseThemeIdentity('```json\n{"name":"冰川晨曦","tags":["冷蓝","浅色玻璃","清透","冷蓝"],"desc":"冷蓝主色与冰青副色交织，呈现清透克制的晨间玻璃质感。"}\n```')
check(aiIdentity?.name === '冰川晨曦' && aiIdentity.tags.length === 3, '应解析 AI 主题身份并清理重复标签')
const invalidIdentity = parseThemeIdentity('{"name":"只有名称"}')
check(invalidIdentity === null, '缺少介绍的 AI 命名结果应拒绝写入')
const cleanIdentity = normalizeThemeIdentity({ name: '  雾海蓝  ', tags: ['#冷蓝', '玻璃', '玻璃'], desc: '  清透\n克制  ' })
check(cleanIdentity.name === '雾海蓝' && cleanIdentity.desc === '清透 克制' && cleanIdentity.tags.join(',') === '冷蓝,玻璃', '主题身份应清理空白、井号与重复标签')

const namedCustom = makeCustomTheme('custom-named', '冰川晨曦', custom, { desc: aiIdentity!.desc, tags: aiIdentity!.tags })
check(namedCustom.label === '冰川晨曦' && namedCustom.tags?.includes('浅色玻璃') && namedCustom.desc === aiIdentity!.desc, 'AI 名称、标签和介绍应随自定义主题持久化')

const picked = hexToOklch('#4f8cff')
check(!!picked && picked.h >= 240 && picked.h <= 270, 'HEX 取色应转换到正确的蓝色色相')
check(/^#[0-9a-f]{6}$/i.test(oklchToHex(picked!)), 'OKLCH 应能导出标准 HEX')

const ratios = themeContrastRatios({ ...controlCenter, tx: '.12', l1: '.54' })
check(ratios.text >= 4.5 && ratios.primary >= 4.5, '主题对比度审计应识别 WCAG AA 安全组合')

console.log(`theme tests passed: ${checks}`)
