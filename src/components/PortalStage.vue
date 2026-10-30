<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { PortalJourney } from '../three/PortalJourney'

const emit = defineEmits<{ stateChange: [state: 'ready' | 'travelling' | 'arrived' | 'returning'] }>()
const host = ref<HTMLElement | null>(null)
const flash = ref<HTMLElement | null>(null)
const state = ref<'ready' | 'travelling' | 'arrived' | 'returning'>('ready')
const error = ref('')
let effect: PortalJourney | undefined

function enter() {
  effect?.enter()
}

function reset() {
  effect?.reset()
}

function activate() {
  if (state.value === 'ready') enter()
  else if (state.value === 'arrived') reset()
}

function move(event: PointerEvent) {
  const element = host.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  effect?.setPointer(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -(((event.clientY - rect.top) / rect.height) * 2 - 1),
  )
}

onMounted(() => {
  if (!host.value) return
  try {
    effect = new PortalJourney(
      host.value,
      (next) => {
        state.value = next
        emit('stateChange', next)
      },
      (progress) => {
        if (flash.value) {
          const distance = (progress - 0.605) / 0.048
          flash.value.style.opacity = String(Math.exp(-distance * distance) * 0.82)
        }
      },
    )
  } catch {
    error.value = '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。'
  }
})

onBeforeUnmount(() => effect?.dispose())

defineExpose({ enter, reset })
</script>

<template>
  <div class="portal-stage" :class="`portal-stage--${state}`" role="button" tabindex="0" :aria-label="state === 'arrived' ? '点击返回传送门入口' : '点击穿越传送门'" @click="activate" @keydown.enter.prevent="activate" @keydown.space.prevent="activate" @pointermove="move" @pointerleave="effect?.setPointer(0, 0)">
    <div ref="host" class="portal-stage__canvas"></div>
    <div ref="flash" class="portal-stage__flash" aria-hidden="true"></div>
    <span class="portal-stage__index">VISUAL EXPERIMENT <b>004</b></span>
    <span class="portal-stage__coordinates" aria-hidden="true">43° 12′ N &nbsp; / &nbsp; 另一侧</span>
    <span class="portal-stage__caption">{{ state === 'arrived' ? '你已抵达 · 点击画面返回' : state === 'travelling' ? '正在穿越边界…' : state === 'returning' ? '正在返回起点…' : '移动鼠标观察 · 点击进入' }}</span>
    <span class="portal-stage__signal" aria-hidden="true"><i></i> {{ state === 'arrived' ? 'SIGNAL FOUND' : 'GATE ACTIVE' }}</span>
    <div v-if="error" class="stage-message stage-message--error" role="alert">{{ error }}</div>
  </div>
</template>
