<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { MiniatureCity } from '../three/MiniatureCity'

const emit = defineEmits<{ progress: [value: number] }>()
const host = ref<HTMLElement | null>(null)
const error = ref('')
const progress = ref(0)
let effect: MiniatureCity | undefined
let pointerId: number | null = null

function setProgress(value: number) { effect?.setProgress(value) }
function replay() { effect?.replay() }
function resetView() { effect?.resetView() }

function pointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  if (progress.value < 75) return
  pointerId = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  effect?.pointerDown(event.clientX, event.clientY)
}
function pointerMove(event: PointerEvent) {
  if (pointerId === event.pointerId) effect?.pointerMove(event.clientX, event.clientY)
}
function pointerUp(event: PointerEvent) {
  if (pointerId !== event.pointerId) return
  pointerId = null
  effect?.pointerUp()
}

onMounted(() => {
  if (!host.value) return
  try {
    effect = new MiniatureCity(host.value, value => {
      progress.value = value
      emit('progress', value)
    })
  } catch {
    error.value = '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。'
  }
})
onBeforeUnmount(() => effect?.dispose())
defineExpose({ replay, resetView, setProgress })
</script>

<template>
  <div class="city-stage" :class="{ 'city-stage--ready': progress >= 95 }" aria-label="城市照片逐渐立成可环视的微缩街道" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp">
    <div ref="host" class="city-stage__canvas"></div>
    <div class="city-stage__grain" aria-hidden="true"></div>
    <div class="city-stage__topline"><span>STREET STUDY <b>010</b></span><span>平面照片 → 微缩街区</span></div>
    <div class="city-stage__meter"><span>立体进度</span><strong>{{ String(progress).padStart(2, '0') }}%</strong><i :style="{ width: `${progress}%` }"></i></div>
    <div class="city-stage__caption">{{ progress < 10 ? '一张俯拍照片，一座尚未醒来的街区。' : progress < 95 ? '屋顶离开纸面，街道开始有了高度。' : '按住画面轻轻拖动，换个角度看看这座小城。' }}</div>
    <div class="city-stage__coordinates" aria-hidden="true">城市观察 &nbsp; / &nbsp; 16:9 街区标本</div>
    <div v-if="error" class="stage-message stage-message--error" role="alert">{{ error }}</div>
  </div>
</template>
