<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { followGateConfig } from '../follow-gate-config'
import { publicAsset } from '../utils/publicAsset'

function wasGranted(): boolean {
  try {
    return localStorage.getItem(followGateConfig.storageKey) === 'granted'
  } catch {
    return false
  }
}

const granted = ref(!followGateConfig.enabled || wasGranted())
const qrFailed = ref(false)

/** 确认前不渲染插槽，避免在引导页背后初始化 WebGL 或加载实验资源。 */
async function revealExperience(): Promise<void> {
  if (granted.value) return
  granted.value = true
  await nextTick()
  // 引导按钮被移除后，将键盘焦点交给当前页面标题，保留原 Hash 地址。
  const heading = document.querySelector<HTMLElement>('#app h1')
  if (heading) {
    heading.setAttribute('tabindex', '-1')
    heading.focus({ preventScroll: true })
  }
}

function enterExperience(): void {
  try {
    localStorage.setItem(followGateConfig.storageKey, 'granted')
  } catch {
    // 存储被禁用时仍允许本次访问，刷新后会再次显示引导。
  }
  void revealExperience()
}

function onStorage(event: StorageEvent): void {
  if (event.storageArea === localStorage && event.key === followGateConfig.storageKey && event.newValue === 'granted') {
    void revealExperience()
  }
}

onMounted(() => window.addEventListener('storage', onStorage))
onBeforeUnmount(() => window.removeEventListener('storage', onStorage))
</script>

<template>
  <slot v-if="granted" />
  <main v-else class="follow-gate" aria-labelledby="follow-gate-title">
    <section class="follow-gate__card">
      <p class="follow-gate__brand">视觉实验室 <span>/ THREE.JS × VUE</span></p>
      <p class="follow-gate__eyebrow">{{ followGateConfig.eyebrow }}</p>
      <h1 id="follow-gate-title">{{ followGateConfig.title }}</h1>
      <p class="follow-gate__copy">{{ followGateConfig.description }}</p>
      <div class="follow-gate__qr">
        <p v-if="qrFailed" class="follow-gate__error" role="status">二维码暂时无法加载<br />请在微信搜索「{{ followGateConfig.accountName }}」</p>
        <img v-else :src="publicAsset(followGateConfig.qrCodePath)" :alt="`「${followGateConfig.accountName}」公众号二维码`" width="860" height="860" @error="qrFailed = true" />
      </div>
      <p class="follow-gate__account">{{ followGateConfig.accountName }}</p>
      <p class="follow-gate__scan">微信扫一扫，或长按识别二维码</p>
      <button class="follow-gate__enter" type="button" @click="enterExperience">
        {{ followGateConfig.confirmLabel }} <span aria-hidden="true">→</span>
      </button>
      <p class="follow-gate__helper">{{ followGateConfig.helperText }}</p>
    </section>
  </main>
</template>

<style scoped>
.follow-gate { min-height: 100dvh; display: grid; place-items: center; padding: 32px 20px; color: var(--muted); background: var(--surface); }
.follow-gate__card { width: min(100%, 460px); padding: 32px 36px 26px; border: 1px solid var(--line); background: var(--surface-raised); text-align: center; }
.follow-gate__brand { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 0 0 36px; padding-bottom: 20px; border-bottom: 1px solid var(--line); color: #eeefeb; font-size: 13px; }
.follow-gate__brand span { color: var(--muted); font-size: 9px; letter-spacing: .08em; }
.follow-gate__eyebrow { margin: 0 0 12px; color: var(--accent); font-size: 12px; }
.follow-gate h1 { margin: 0; color: #eeefeb; font-size: clamp(23px, 5.5vw, 30px); font-weight: 600; line-height: 1.4; letter-spacing: -.04em; text-wrap: balance; }
.follow-gate__copy { margin: 16px auto 22px; font-size: 13px; line-height: 1.85; white-space: pre-line; }
.follow-gate__qr { display: grid; place-items: center; width: 200px; height: 200px; margin: auto; padding: 8px; background: #fff; }
.follow-gate__qr img { display: block; width: 100%; height: 100%; object-fit: contain; }
.follow-gate__error { margin: 0; color: #333; font-size: 13px; line-height: 1.8; }
.follow-gate__account { margin: 16px 0 6px; color: #eeefeb; font-size: 15px; }
.follow-gate__scan { margin: 0 0 24px; font-size: 12px; }
.follow-gate__enter { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; min-height: 50px; padding: 12px 18px; border: 1px solid var(--accent); background: var(--accent); color: #1d1712; font-size: 15px; font-weight: 600; transition: background .2s, transform .2s; }
.follow-gate__enter:hover { background: #ffac80; }
.follow-gate__enter:active { transform: translateY(1px); }
.follow-gate__enter span { font-size: 22px; font-weight: 400; }
.follow-gate__helper { margin: 14px 0 0; font-size: 11px; line-height: 1.7; }
@media (max-width: 440px) {
  .follow-gate { padding: 20px 16px; }
  .follow-gate__card { padding: 24px 20px; }
  .follow-gate__brand { margin-bottom: 26px; }
}
@media (prefers-reduced-motion: reduce) {
  .follow-gate__enter { transition: none; }
}
</style>
