<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { SeasonGlass } from '../three/SeasonGlass'

const host = ref<HTMLElement | null>(null)
const phase = ref<'intact' | 'breaking' | 'open'>('intact')
const error = ref('')
const impact = ref({ x: 50, y: 50, key: 0 })
let effect: SeasonGlass | undefined

function breakAt(x: number, y: number) {
  if (!effect || phase.value !== 'intact') return
  impact.value = { x: x * 100, y: (1 - y) * 100, key: impact.value.key + 1 }
  effect.fracture(x, y)
}

function onPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  breakAt((event.clientX - bounds.left) / bounds.width, 1 - (event.clientY - bounds.top) / bounds.height)
}

function breakCenter() {
  if (phase.value === 'open') effect?.reset()
  breakAt(0.5, 0.52)
}

function reset() {
  effect?.reset()
  impact.value = { x: 50, y: 50, key: 0 }
}

onMounted(() => {
  if (!host.value) return
  try {
    effect = new SeasonGlass(host.value, value => { phase.value = value })
  } catch {
    error.value = '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。'
  }
})

onBeforeUnmount(() => effect?.dispose())
defineExpose({ breakCenter, reset })
</script>

<template>
  <div
    class="season-stage"
    :class="`season-stage--${phase}`"
    role="button"
    tabindex="0"
    :aria-label="phase === 'intact' ? '冬季玻璃窗，点击任意位置敲开春天' : '玻璃已经裂开，下面是同一处风景的春天'"
    @pointerdown="onPointerDown"
    @keydown.enter.prevent="breakCenter"
    @keydown.space.prevent="breakCenter"
  >
    <div ref="host" class="season-stage__canvas"></div>
    <div class="season-stage__sheen" aria-hidden="true"></div>
    <div class="season-stage__border" aria-hidden="true"></div>
    <div v-if="phase === 'breaking'" :key="impact.key" class="season-stage__impact" :style="{ left: `${impact.x}%`, top: `${impact.y}%` }" aria-hidden="true"></div>
    <div class="season-stage__topline"><span>SEASON STUDY <b>009</b></span><span>冬 / 春 · 同一处风景</span></div>
    <div class="season-stage__center-mark" aria-hidden="true"><span>轻触玻璃</span><i></i></div>
    <div class="season-stage__footer">
      <span>{{ phase === 'intact' ? '点击任意位置，敲开另一个季节' : phase === 'breaking' ? '裂纹正在向外蔓延' : '冰雪退去，春天就在后面' }}</span>
      <span class="season-stage__status"><i></i>{{ phase === 'intact' ? '冬季 · 封存' : phase === 'breaking' ? '季节交替中' : '春季 · 已抵达' }}</span>
    </div>
    <div v-if="error" class="stage-message stage-message--error" role="alert">{{ error }}</div>
  </div>
</template>
