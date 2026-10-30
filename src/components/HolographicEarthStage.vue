<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { HolographicEarth, type EarthSelection } from '../three/HolographicEarth'

const props = defineProps<{ speed: number; paused: boolean }>()
const host = ref<HTMLElement | null>(null)
const error = ref('')
const coordinate = ref('点击地球，读取经纬度')
let effect: HolographicEarth | undefined

function selected(value: EarthSelection) {
  const lat = `${Math.abs(value.latitude).toFixed(1)}°${value.latitude >= 0 ? 'N' : 'S'}`
  const lon = `${Math.abs(value.longitude).toFixed(1)}°${value.longitude >= 0 ? 'E' : 'W'}`
  coordinate.value = `${lat} / ${lon}`
}

function down(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  effect?.pointerDown(event.pointerId, event.clientX, event.clientY)
}
function move(event: PointerEvent) { effect?.pointerMove(event.pointerId, event.clientX, event.clientY) }
function up(event: PointerEvent) { effect?.pointerUp(event.pointerId, event.clientX, event.clientY) }
function cancel(event: PointerEvent) { effect?.pointerUp(event.pointerId, event.clientX, event.clientY, true) }
function wheel(event: WheelEvent) { effect?.zoom(event.deltaY * 0.008) }
function ping() { effect?.ping() }
function resetView() { effect?.resetView(); coordinate.value = '点击地球，读取经纬度' }

onMounted(() => {
  if (!host.value) return
  try {
    effect = new HolographicEarth(host.value, selected, () => { error.value = '地球轮廓数据加载失败，请刷新页面重试。' })
    effect.setSpeed(props.speed)
    effect.setPaused(props.paused)
  } catch {
    error.value = '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。'
  }
})

watch(() => props.speed, value => effect?.setSpeed(value))
watch(() => props.paused, value => effect?.setPaused(value))
onBeforeUnmount(() => effect?.dispose())
defineExpose({ ping, resetView })
</script>

<template>
  <div class="holo-stage" role="button" tabindex="0" aria-label="拖动旋转全息地球，点击表面读取经纬度，滚轮或双指缩放" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @wheel.prevent="wheel" @keydown.enter.prevent="ping" @keydown.space.prevent="ping">
    <div ref="host" class="holo-stage__canvas"></div>
    <div class="holo-stage__reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="holo-stage__corner holo-stage__corner--tl" aria-hidden="true"></div>
    <div class="holo-stage__corner holo-stage__corner--tr" aria-hidden="true"></div>
    <div class="holo-stage__corner holo-stage__corner--bl" aria-hidden="true"></div>
    <div class="holo-stage__corner holo-stage__corner--br" aria-hidden="true"></div>
    <span class="holo-stage__index">VISUAL EXPERIMENT <b>007</b></span>
    <span class="holo-stage__mode">HOLOGRAPHIC / EARTH 01</span>
    <div class="holo-stage__readout" aria-hidden="true">
      <span>地表扫描 <b>ACTIVE</b></span>
      <span>经纬网 <b>15°</b></span>
      <span>轮廓数据 <b>110M</b></span>
      <span class="holo-stage__bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
    </div>
    <span class="holo-stage__coordinate">{{ coordinate }}</span>
    <span class="holo-stage__caption">拖动旋转 · 滚轮或双指缩放 · 点击定位</span>
    <span class="holo-stage__signal"><i></i> SCAN IN PROGRESS</span>
    <div v-if="error" class="stage-message stage-message--error" role="alert">{{ error }}</div>
  </div>
</template>
