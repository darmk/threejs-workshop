<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LiquidPoster } from '../three/LiquidPoster'

const props = defineProps<{ source: string; isDefault: boolean; strength: number }>()
const host = ref<HTMLElement | null>(null)
const loading = ref(true)
const error = ref('')
let effect: LiquidPoster | undefined
let loadId = 0

async function load(source: string, isDefault: boolean) {
  if (!effect) return
  const id = ++loadId
  loading.value = true
  error.value = ''
  try {
    await effect.setImage(source, isDefault)
    if (id !== loadId) return
    loading.value = false
  } catch (cause) {
    if (id !== loadId) return
    loading.value = false
    error.value = cause instanceof Error ? cause.message : '图片读取失败。'
  }
}

function splash() {
  effect?.splash()
}

function clear() {
  effect?.clear()
}

onMounted(() => {
  if (!host.value) return
  try {
    effect = new LiquidPoster(host.value)
    effect.setStrength(props.strength)
    void load(props.source, props.isDefault)
  } catch {
    loading.value = false
    error.value = '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。'
  }
})

watch(() => [props.source, props.isDefault] as const, ([source, isDefault]) => void load(source, isDefault))
watch(() => props.strength, (strength) => effect?.setStrength(strength))

onBeforeUnmount(() => {
  loadId++
  effect?.dispose()
})

defineExpose({ splash, clear })
</script>

<template>
  <div class="liquid-stage" aria-label="鼠标拨动的液态海报，移动或点击画面可产生水波">
    <div ref="host" class="liquid-stage__canvas"></div>
    <div v-if="loading" class="liquid-stage__message" role="status">正在铺开海报...</div>
    <div v-if="error" class="liquid-stage__message liquid-stage__message--error" role="alert">{{ error }}</div>
  </div>
</template>
