<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NebulaGalaxy, type GalaxyPalette } from '../three/NebulaGalaxy'

const props = defineProps<{
  palette: GalaxyPalette
  speed: number
  paused: boolean
}>()

const host = ref<HTMLElement | null>(null)
const error = ref('')
let effect: NebulaGalaxy | undefined

function down(event: PointerEvent) {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  effect?.pointerDown(event.pointerId, event.clientX, event.clientY)
}

function move(event: PointerEvent) {
  effect?.pointerMove(event.pointerId, event.clientX, event.clientY)
}

function up(event: PointerEvent) {
  effect?.pointerUp(event.pointerId)
}

function cancel(event: PointerEvent) {
  effect?.pointerUp(event.pointerId, true)
}

function wheel(event: WheelEvent) {
  effect?.zoom(event.deltaY * 0.008)
}

function pulse() {
  effect?.pulse()
}

function resetView() {
  effect?.resetView()
}

onMounted(() => {
  if (!host.value) return
  try {
    effect = new NebulaGalaxy(host.value)
    effect.setPalette(props.palette)
    effect.setSpeed(props.speed)
    effect.setPaused(props.paused)
  } catch {
    error.value = '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。'
  }
})

watch(() => props.palette, (value) => effect?.setPalette(value))
watch(() => props.speed, (value) => effect?.setSpeed(value))
watch(() => props.paused, (value) => effect?.setPaused(value))

onBeforeUnmount(() => effect?.dispose())

defineExpose({ pulse, resetView })
</script>

<template>
  <div class="galaxy-stage" role="button" tabindex="0" aria-label="拖动旋转银河，点击激起星尘波纹，滚轮缩放" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @wheel.prevent="wheel" @keydown.enter.prevent="pulse" @keydown.space.prevent="pulse">
    <div ref="host" class="galaxy-stage__canvas"></div>
    <span class="galaxy-stage__index">VISUAL EXPERIMENT <b>005</b></span>
    <span class="galaxy-stage__marker galaxy-stage__marker--left" aria-hidden="true">∞ / 05</span>
    <span class="galaxy-stage__marker galaxy-stage__marker--right" aria-hidden="true">DRAG · ZOOM · TOUCH</span>
    <span class="galaxy-stage__caption">拖动旋转 · 滚轮或双指缩放 · 轻点激起星尘</span>
    <span class="galaxy-stage__signal" aria-hidden="true"><i></i> GALAXY LIVE</span>
    <div v-if="error" class="stage-message stage-message--error" role="alert">{{ error }}</div>
  </div>
</template>
