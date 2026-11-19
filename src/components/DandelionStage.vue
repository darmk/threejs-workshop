<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { DandelionMeadow, type DandelionState } from '../three/DandelionMeadow'
import { BlowInput } from '../utils/BlowInput'

const host = ref<HTMLElement | null>(null)
const state = ref<DandelionState>({ phase: 'ready', progress: 0, level: 0 })
const micState = ref<'off' | 'requesting' | 'calibrating' | 'listening'>('off')
const notice = ref('不使用麦克风，也可以直接点“吹一口气”。')
const error = ref('')
const mic = new BlowInput()
let meadow: DandelionMeadow | undefined
let destroyed = false
let request = 0

async function toggleMic() {
  if (micState.value !== 'off') { stopMic(); return }
  const id = ++request
  micState.value = 'requesting'; notice.value = '请在浏览器提示中允许麦克风，也可以随时取消。'
  try {
    const started = await mic.start()
    if (!started || destroyed || id !== request) return
    micState.value = 'calibrating'; notice.value = '先安静一小会儿，正在适应周围的声音…'
  } catch (cause) {
    if (destroyed || id !== request) return
    micState.value = 'off'
    notice.value = cause instanceof DOMException && cause.name === 'NotAllowedError'
      ? '麦克风未获授权。直接点“吹一口气”也能完整体验。'
      : '暂时无法使用麦克风。请通过 HTTPS 或本机地址访问，也可以直接用按钮。'
  }
}
function stopMic() { request++; mic.stop(); micState.value = 'off'; notice.value = '麦克风已关闭，可以继续用按钮吹散蒲公英。' }
function visibility() { if (document.hidden && micState.value !== 'off') stopMic() }
onMounted(() => {
  if (!host.value) return
  try {
    meadow = new DandelionMeadow(host.value, next => { state.value = next }, () => {
      if (micState.value === 'calibrating' && !mic.calibrating) {
        micState.value = 'listening'; notice.value = '对着麦克风轻轻吹气。环境杂音也可能触发，可关闭后改用按钮。'
      }
      return mic.read()
    })
  } catch { error.value = '当前浏览器无法启动 WebGL，请换一个支持 WebGL 的浏览器。' }
  document.addEventListener('visibilitychange', visibility)
})
onBeforeUnmount(() => { destroyed = true; request++; mic.stop(); meadow?.dispose(); document.removeEventListener('visibilitychange', visibility) })
</script>

<template>
  <section class="dandelion-workspace" aria-label="吹散一整片蒲公英">
    <div class="dandelion-stage">
      <div ref="host" class="dandelion-canvas"></div>
      <div class="dandelion-top"><span>风的来信 <i></i> 015</span><span>把愿望，交给风。</span></div>
      <div class="dandelion-note"><small>在这里，停一小会儿。</small><strong>轻轻一吹，<br />就去远方。</strong><p>有些出发，<br />只需要一口气。</p></div>
      <div class="dandelion-caption"><i></i><span>{{ state.phase === 'ready' ? '蒲公英准备好了，等一阵风。' : state.phase === 'drifting' ? '你吹出的这一口气，正在带它们去远方。' : '风已经把它们送远了。再种一片，许下一个新愿望。' }}</span></div>
      <div v-if="state.phase !== 'ready'" class="dandelion-progress"><span>{{ state.phase === 'away' ? '已随风远行' : '正在随风远行' }}</span><b>{{ state.progress }}<small>%</small></b></div>
      <p v-if="error" class="dandelion-error" role="alert">{{ error }}</p>
    </div>
    <div class="dandelion-controls">
      <div class="dandelion-controls__intro"><small>一口气 / 一次远行</small><p>让这一片蒲公英，替你出发。</p></div>
      <div class="dandelion-actions"><button :disabled="Boolean(error)" :aria-pressed="micState !== 'off'" @click="toggleMic">{{ micState === 'off' ? '开启麦克风吹气' : micState === 'requesting' ? '取消麦克风申请' : '关闭麦克风' }}</button><button :disabled="Boolean(error)" @click="meadow?.reset()">重新长满</button><button class="dandelion-blow" :disabled="Boolean(error) || state.phase !== 'ready'" @click="meadow?.blow()">{{ state.phase === 'ready' ? '吹一口气' : state.phase === 'away' ? '已飞向远方' : '正在随风飞远' }} <span aria-hidden="true">↗</span></button></div>
    </div>
    <div class="dandelion-mic"><span class="dandelion-meter" :class="{ active: micState === 'listening' }" aria-hidden="true"><i :style="{ width: `${state.level}%` }"></i></span><p role="status">{{ notice }}</p><small>声音只在本机分析 · 不录音、不上传</small></div>
  </section>
</template>

<style scoped>
.dandelion-workspace { border: 1px solid #56645a; background: #192b27; color: #e2dfcc; }
.dandelion-stage { position: relative; height: clamp(540px, 49vw, 700px); overflow: hidden; background: #172c29; }
.dandelion-canvas, .dandelion-canvas :deep(canvas) { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.dandelion-top { position: absolute; top: 27px; left: 31px; right: 31px; display: flex; justify-content: space-between; font-size: 10px; color: #babd9e; letter-spacing: .1em; pointer-events: none; }
.dandelion-top > span:first-child { display: flex; align-items: center; gap: 16px; }.dandelion-top i { width: 32px; height: 1px; background: #c5c2a46b; }
.dandelion-note { position: absolute; top: 95px; left: 40px; pointer-events: none; }.dandelion-note small { font-size: 10px; letter-spacing: .12em; color: #b7baa0; }
.dandelion-note strong { display: block; margin: 19px 0; font-family: 'Songti SC', SimSun, serif; font-weight: 400; font-size: clamp(28px, 3vw, 42px); line-height: 1.5; letter-spacing: .05em; color: #eee6c9; }
.dandelion-note p { font-size: 11px; line-height: 2; color: #a9b49c; }
.dandelion-caption { position: absolute; bottom: 27px; left: 31px; right: 26px; display: flex; align-items: center; gap: 11px; pointer-events: none; color: #c7c7ab; font-size: 10px; line-height: 1.8; }.dandelion-caption i { width: 26px; height: 1px; flex-shrink: 0; background: #c7c7ab; }
.dandelion-progress { position: absolute; right: 34px; top: 94px; display: grid; gap: 11px; justify-items: end; color: #d6d1ae; pointer-events: none; }.dandelion-progress > span { font-size: 10px; }.dandelion-progress b { font-size: 31px; font-weight: 400; font-variant-numeric: tabular-nums; }.dandelion-progress small { font-size: 12px; margin-left: 4px; }
.dandelion-controls { display: flex; align-items: center; justify-content: space-between; gap: 25px; border-top: 1px solid #68735d66; padding: 24px 28px; background: #21332b; }.dandelion-controls__intro small { font-size: 10px; color: #a3b097; }.dandelion-controls__intro p { margin: 8px 0 0; font-size: 15px; color: #d9ddc5; }
.dandelion-actions { display: flex; gap: 17px; align-items: center; }.dandelion-actions button { border: 0; background: transparent; color: #bcc8ac; padding: 10px 4px; min-height: 44px; font-size: 11px; white-space: nowrap; }.dandelion-actions .dandelion-blow { background: #d9d5b0; color: #243c30; padding: 10px 20px; min-width: 133px; }.dandelion-blow span { margin-left: 19px; font-size: 18px; }
.dandelion-actions button:not(:disabled) { cursor: pointer; }.dandelion-actions button:disabled { opacity: .45; }.dandelion-actions button:focus-visible { outline: 2px solid #d9d5b0; outline-offset: 4px; }
.dandelion-mic { padding: 13px 28px; border-top: 1px solid #68735d44; display: flex; align-items: center; gap: 13px; color: #b3bba3; }.dandelion-mic p { margin: 0; font-size: 10px; line-height: 1.8; }.dandelion-mic > small { margin-left: auto; font-size: 9px; color: #8fa18c; white-space: nowrap; }.dandelion-meter { display: block; width: 45px; height: 3px; background: #5e6b5366; flex: 0 0 45px; }.dandelion-meter i { display: block; height: 100%; background: #d8d0a1; }.dandelion-meter.active { background: #849a5d66; }
.dandelion-error { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 25px; background: #172c29ed; text-align: center; font-size: 14px; }
@media(max-width: 850px) { .dandelion-controls { flex-wrap: wrap; }.dandelion-actions { margin-left: auto; }.dandelion-mic { flex-wrap: wrap; }.dandelion-mic > small { flex-basis: 100%; margin-left: 58px; } }
@media(max-width: 600px) { .dandelion-stage { height: 570px; }.dandelion-top { top: 23px; left: 21px; right: 21px; font-size: 9px; }.dandelion-note { top: 74px; left: 25px; }.dandelion-note strong { font-size: 30px; margin: 12px 0; }.dandelion-note p { font-size: 10px; }.dandelion-progress { top: 76px; right: 23px; }.dandelion-progress > span { font-size: 9px; }.dandelion-progress b { font-size: 25px; }.dandelion-caption { left: 22px; bottom: 23px; font-size: 9px; }.dandelion-controls { padding: 21px 18px; gap: 23px; }.dandelion-actions { width: 100%; gap: 11px; justify-content: space-between; }.dandelion-actions button { font-size: 10px; }.dandelion-actions .dandelion-blow { min-width: 109px; padding: 8px 12px; }.dandelion-blow span { margin-left: 7px; }.dandelion-mic { padding: 13px 18px; gap: 8px; }.dandelion-mic > small { margin-left: 0; }.dandelion-mic p { flex: 1; } }
</style>
