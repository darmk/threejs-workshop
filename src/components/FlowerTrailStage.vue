<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { FlowerTrail, type FlowerPalette, type FlowerTrailState } from '../three/FlowerTrail'

const host = ref<HTMLElement | null>(null)
const state = ref<FlowerTrailState>({ flowers: 0, demonstrating: true, full: false })
const palette = ref<FlowerPalette>('meadow')
const width = ref(0.85)
const breeze = ref(!matchMedia('(prefers-reduced-motion: reduce)').matches)
const error = ref('')
let garden: FlowerTrail | undefined
let touchPointer: number | null = null
const paletteOptions: Array<{ id: FlowerPalette; label: string }> = [
  { id: 'meadow', label: '日光野花' }, { id: 'twilight', label: '暮色花园' },
]
function choosePalette(value: FlowerPalette) { palette.value = value; garden?.setPalette(value) }
function down(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  touchPointer = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  garden?.endStroke(); garden?.paint(event.clientX, event.clientY)
}
function move(event: PointerEvent) {
  if (event.pointerType !== 'mouse' && touchPointer !== event.pointerId) return
  garden?.paint(event.clientX, event.clientY)
}
function up(event: PointerEvent) {
  if (touchPointer !== event.pointerId) return
  touchPointer = null; garden?.endStroke()
  const el = event.currentTarget as HTMLElement
  if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
}
function leave() { if (touchPointer === null) garden?.endStroke() }
function lostCapture() { touchPointer = null; garden?.endStroke() }
onMounted(() => {
  if (!host.value) return
  try { garden = new FlowerTrail(host.value, next => { state.value = next }) }
  catch { garden?.dispose(); error.value = '这片花园需要 WebGL 支持，请换一个支持 WebGL 的浏览器再试。' }
})
onBeforeUnmount(() => garden?.dispose())
</script>

<template>
  <section class="flower-workspace" aria-label="在荒地上种下一条花路">
    <div class="flower-stage" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @pointerleave="leave" @lostpointercapture="lostCapture">
      <div ref="host" class="flower-stage__canvas"></div>
      <div class="flower-stage__top" aria-hidden="true"><span>一小片春天 <i></i> FIELD NOTES</span><span>014 / 沿途生花</span></div>
      <div class="flower-stage__note"><span>不用赶路，慢慢来。</span><strong>你走过的地方，<br />会开花。</strong><p>在空地上移动鼠标<br />把春天，留在经过的地方。</p></div>
      <div class="flower-stage__count" aria-live="off"><b>{{ state.flowers.toString().padStart(3, '0') }}</b><span>朵花，留在这里</span></div>
      <div class="flower-stage__caption"><i :class="{ 'is-growing': state.demonstrating }"></i><span>{{ state.demonstrating ? '正在长出第一条花路，你也可以随时接着种。' : state.full ? '花园已经很热闹了，继续划动会把最早的花移到新位置。' : state.flowers ? '花会留下，风会经过。继续在空地上划一划。' : '移动鼠标，种下第一簇花。触屏请按住划动。' }}</span></div>
      <p v-if="error" class="flower-error" role="alert">{{ error }}</p>
    </div>
    <div class="flower-controls">
      <fieldset class="flower-palette"><legend>接下来，种什么颜色？</legend><div><button v-for="option in paletteOptions" :key="option.id" :class="[{ active: palette === option.id }, `flower-palette--${option.id}`]" :aria-pressed="palette === option.id" :disabled="Boolean(error)" @click="choosePalette(option.id)"><i aria-hidden="true"><b></b><b></b><b></b></i>{{ option.label }}</button></div></fieldset>
      <label class="flower-width"><span>花路宽度 <b>{{ width < 0.65 ? '细细一径' : width > 1.1 ? '铺开一片' : '刚刚好' }}</b></span><input v-model.number="width" aria-label="花路宽度" type="range" min="0.35" max="1.45" step="0.05" :disabled="Boolean(error)" @input="garden?.setWidth(width)" /></label>
      <div class="flower-actions"><button :disabled="Boolean(error)" :aria-pressed="breeze" @click="breeze = !breeze; garden?.setBreeze(breeze)">{{ breeze ? '风在吹' : '让风吹' }} <span aria-hidden="true">≈</span></button><button :disabled="Boolean(error)" @click="garden?.clear()">清空荒地</button><button class="flower-demo" :disabled="Boolean(error)" @click="garden?.demonstrate()">再长一条花路 <span aria-hidden="true">↗</span></button></div>
    </div>
    <div class="flower-bottom"><span>鼠标经过就会生长 · 触屏按住划动</span><button :disabled="Boolean(error)" @click="garden?.plantCenter()">在中央种一簇花 ＋</button><span>花茎生长 → 花瓣展开 → 留下一路春天</span></div>
  </section>
</template>

<style scoped>
.flower-workspace { color: #424a32; background: #ede8dc; border: 1px solid #a99f87; }
.flower-stage { position: relative; height: clamp(540px, 51vw, 720px); overflow: hidden; background: #d8cbb5; touch-action: none; cursor: crosshair; }
.flower-stage__canvas, .flower-stage__canvas :deep(canvas) { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.flower-stage__top { position: absolute; top: 27px; left: 30px; right: 30px; display: flex; justify-content: space-between; color: #625d49; font-size: 9px; letter-spacing: .1em; pointer-events: none; }
.flower-stage__top > span:first-child { display: flex; align-items: center; gap: 13px; }
.flower-stage__top i { width: 22px; height: 1px; background: #8e8c6d; }
.flower-stage__note { position: absolute; top: 87px; left: 40px; pointer-events: none; }
.flower-stage__note > span { color: #756e53; font-size: 11px; letter-spacing: .1em; }
.flower-stage__note strong { display: block; margin: 18px 0; font-family: 'Noto Serif SC', 'Songti SC', SimSun, serif; color: #3f4c34; font-weight: 400; font-size: clamp(27px, 3.05vw, 43px); line-height: 1.5; letter-spacing: .04em; }
.flower-stage__note p { font-size: 11px; line-height: 2; color: #6b6c51; }
.flower-stage__count { position: absolute; top: 91px; right: 35px; display: grid; gap: 6px; justify-items: end; pointer-events: none; }
.flower-stage__count b { font-size: 31px; font-weight: 400; font-variant-numeric: tabular-nums; letter-spacing: -.06em; color: #5b6247; }
.flower-stage__count span { font-size: 10px; color: #707057; }
.flower-stage__caption { position: absolute; bottom: 26px; left: 31px; right: 24px; display: flex; align-items: center; gap: 10px; font-size: 10px; line-height: 1.8; color: #555c40; pointer-events: none; }
.flower-stage__caption i { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: #79824f; }
.flower-stage__caption .is-growing { box-shadow: 0 0 0 4px #79824f18; }
.flower-controls { display: flex; align-items: center; justify-content: space-between; gap: 27px; border-top: 1px solid #b7b19a; padding: 23px 28px; background: #f2eee3; }
.flower-palette { border: 0; margin: 0; padding: 0; flex: 0 0 auto; }
.flower-palette legend, .flower-width > span { margin-bottom: 11px; font-size: 10px; color: #73765d; }
.flower-palette > div { display: flex; gap: 7px; }
.flower-palette button { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 6px 11px; border: 1px solid transparent; background: transparent; color: #72765f; font-size: 10px; }
.flower-palette button.active { border-color: #9b9f80; background: #e4e7d6; color: #414e34; }
.flower-palette button i { display: flex; }
.flower-palette button b { width: 10px; height: 10px; border: 1px solid #74674421; border-radius: 50%; margin-left: -2px; background: #f7efd5; }
.flower-palette--meadow b:nth-child(2) { background: #de7a52; }.flower-palette--meadow b:nth-child(3) { background: #dfadb6; }
.flower-palette--twilight b:nth-child(2) { background: #9e91be; }.flower-palette--twilight b:nth-child(3) { background: #cf9bb9; }
.flower-width { display: block; width: 170px; min-width: 120px; }
.flower-width > span { display: flex; justify-content: space-between; gap: 12px; }
.flower-width b { font-weight: 400; color: #4c5d3a; }
.flower-width input { width: 100%; display: block; margin: 0; accent-color: #69794d; cursor: pointer; }
.flower-actions { display: flex; gap: 15px; align-items: center; }
.flower-actions button { min-height: 40px; padding: 7px 3px; border: 0; background: transparent; color: #646c50; font-size: 11px; white-space: nowrap; }
.flower-actions button > span { margin-left: 7px; font-size: 16px; }
.flower-actions .flower-demo { background: #536644; border: 1px solid #536644; color: #fbf8e9; padding: 0 15px; min-height: 43px; }
.flower-actions .flower-demo:hover { background: #435637; }
.flower-bottom { display: flex; justify-content: space-between; align-items: center; gap: 15px; padding: 12px 28px; border-top: 1px solid #c9c5b2; color: #777b62; font-size: 9px; }
.flower-bottom button { border: 0; padding: 4px 0; background: transparent; color: #536643; font-size: 10px; }
button:not(:disabled) { cursor: pointer; }button:focus-visible, input:focus-visible { outline: 2px solid #536644; outline-offset: 4px; }button:disabled { cursor: not-allowed; opacity: .5; }
.flower-error { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 25px; background: #eee8d9ed; color: #775c37; font-size: 14px; text-align: center; }
@media(max-width: 1100px) { .flower-controls { flex-wrap: wrap; }.flower-actions { margin-left: auto; }.flower-width { flex: 1; max-width: 250px; }.flower-bottom > span:last-child { display: none; } }
@media(max-width: 600px) { .flower-stage { height: 600px; }.flower-stage__top { top: 22px; left: 20px; right: 20px; font-size: 8px; }.flower-stage__top i { display: none; }.flower-stage__note { top: 66px; left: 24px; }.flower-stage__note strong { font-size: 29px; margin: 12px 0; }.flower-stage__note p { font-size: 10px; line-height: 1.9; }.flower-stage__count { right: 22px; top: 67px; }.flower-stage__count b { font-size: 27px; }.flower-stage__count span { font-size: 9px; }.flower-stage__caption { left: 22px; bottom: 22px; font-size: 9px; }.flower-controls { padding: 21px 18px; gap: 21px; }.flower-palette { width: 100%; }.flower-palette > div { gap: 12px; }.flower-width { max-width: none; width: 100%; flex: 0 0 100%; }.flower-actions { width: 100%; justify-content: space-between; gap: 12px; }.flower-actions .flower-demo { padding: 0 11px; }.flower-bottom { padding: 10px 18px; flex-wrap: wrap; gap: 6px; } }
</style>
