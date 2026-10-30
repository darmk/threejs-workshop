<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NeonTunnel, type TunnelPalette } from '../three/NeonTunnel'

const props = defineProps<{ speed: number; paused: boolean; palette: TunnelPalette }>()
const host = ref<HTMLElement | null>(null)
const error = ref('')
let effect: NeonTunnel | undefined
let downAt: { x: number; y: number } | undefined

function steer(event: PointerEvent) {
  const stage = event.currentTarget as HTMLElement
  const bounds = stage.getBoundingClientRect()
  const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2
  const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2
  effect?.steer(x, y)
}

function pointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  downAt = { x: event.clientX, y: event.clientY }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  steer(event)
}

function pointerUp(event: PointerEvent) {
  if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) < 12) effect?.pulse()
  downAt = undefined
  if (event.pointerType !== 'mouse') effect?.releaseSteer()
}

function pointerCancel() {
  downAt = undefined
  effect?.releaseSteer()
}

function pulse() { effect?.pulse() }
function reset() { effect?.reset() }

onMounted(() => {
  if (!host.value) return
  try {
    effect = new NeonTunnel(host.value)
    effect.setSpeed(props.speed)
    effect.setPaused(props.paused)
    effect.setPalette(props.palette)
  } catch {
    error.value = '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。'
  }
})

watch(() => props.speed, value => effect?.setSpeed(value))
watch(() => props.paused, value => effect?.setPaused(value))
watch(() => props.palette, value => effect?.setPalette(value))
onBeforeUnmount(() => effect?.dispose())
defineExpose({ pulse, reset })
</script>

<template>
  <div
    class="tunnel-stage"
    role="button"
    tabindex="0"
    aria-label="霓虹隧道，移动指针调整视角，点击触发能量脉冲"
    @pointermove="steer"
    @pointerdown="pointerDown"
    @pointerup="pointerUp"
    @pointercancel="pointerCancel"
    @pointerleave="effect?.releaseSteer()"
    @keydown.enter.prevent="pulse"
    @keydown.space.prevent="pulse"
  >
    <div ref="host" class="tunnel-stage__canvas"></div>
    <div class="tunnel-stage__vignette" aria-hidden="true"></div>
    <div class="tunnel-stage__topline"><span>VISUAL EXPERIMENT <b>008</b></span><span>INFINITE PASSAGE / 01</span></div>
    <div class="tunnel-stage__target" aria-hidden="true"><span></span><i></i></div>
    <div class="tunnel-stage__metric" aria-hidden="true"><span>目的地</span><strong>前方</strong><small>∞</small></div>
    <div class="tunnel-stage__footer"><span>移动视角 · 点击激起能量脉冲</span><span><i></i> 通道持续运行</span></div>
    <div v-if="error" class="stage-message stage-message--error" role="alert">{{ error }}</div>
  </div>
</template>
