<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RainWindow } from '../three/RainWindow'

const props = defineProps<{ rain: number; paused: boolean }>()
const host = ref<HTMLElement | null>(null)
const error = ref('')
let effect: RainWindow | undefined
let dragging = false
let lastPoint: { x: number; y: number } | undefined

function down(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  dragging = true
  lastPoint = { x: event.clientX, y: event.clientY }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  effect?.wipeAt(event.clientX, event.clientY)
}

function move(event: PointerEvent) {
  if (!dragging) return
  effect?.wipeAt(event.clientX, event.clientY, lastPoint)
  lastPoint = { x: event.clientX, y: event.clientY }
}

function up() {
  dragging = false
  lastPoint = undefined
}

function wipeCenter() { effect?.wipeCenter() }
function reset() { effect?.reset() }
function lightning() { effect?.lightning() }

onMounted(() => {
  if (!host.value) return
  try {
    effect = new RainWindow(host.value, () => { error.value = '夜景图片加载失败，请刷新页面重试。' })
    effect.setRain(props.rain)
    effect.setPaused(props.paused)
  } catch {
    error.value = '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。'
  }
})

watch(() => props.rain, value => effect?.setRain(value))
watch(() => props.paused, value => effect?.setPaused(value))
onBeforeUnmount(() => effect?.dispose())
defineExpose({ wipeCenter, reset, lightning })
</script>

<template>
  <div class="rain-stage" role="button" tabindex="0" aria-label="按住并划过玻璃，擦出清晰的夜景" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @keydown.enter.prevent="wipeCenter" @keydown.space.prevent="wipeCenter">
    <div ref="host" class="rain-stage__canvas"></div>
    <div class="rain-stage__glass-edge" aria-hidden="true"></div>
    <span class="rain-stage__index">VISUAL EXPERIMENT <b>006</b></span>
    <span class="rain-stage__weather">NIGHT RAIN · 06</span>
    <span class="rain-stage__caption">按住并划过玻璃，擦出窗外的夜景</span>
    <span class="rain-stage__signal"><i></i> REALTIME RAIN</span>
    <div v-if="error" class="stage-message stage-message--error" role="alert">{{ error }}</div>
  </div>
</template>
