/** 仅包含公开展示配置；前端只能记录用户确认，不能验证微信关注状态。 */
export const followGateConfig = {
  enabled: true,
  // 与钟楼项目共用；只有同源部署的页面才能共享浏览器记录。
  storageKey: 'darmk:follow-gate:main:v1',
  accountName: '程途漫记',
  eyebrow: '关注公众号 · 发现更多交互作品',
  title: '先关注，再开启视觉实验',
  description: '创作不易，感谢支持。\n扫码关注公众号，继续发掘更多 Three.js 交互特效、实现拆解和作品。',
  qrCodePath: 'images/qrcode_for_gh_10e8400b2bfb_860.jpg',
  confirmLabel: '我已关注，进入体验',
  helperText: '点击后，下次在此浏览器打开可直接进入。',
} as const
