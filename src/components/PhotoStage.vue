<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ParticlePhoto } from '../three/ParticlePhoto'

const props = withDefaults(defineProps<{ source: string; autoplay?: boolean }>(), {
  autoplay: false,
})

const host = ref<HTMLElement | null>(null)
const loading = ref(true)
const error = ref('')
let effect: ParticlePhoto | undefined
let autoplayTimer = 0
let loadId = 0

async function load(source: string) {
  if (!effect) return
  const currentLoad = ++loadId
  loading.value = true
  error.value = ''
  try {
    await effect.setImage(source)
    if (currentLoad !== loadId) return
    loading.value = false
    if (props.autoplay) {
      window.clearTimeout(autoplayTimer)
      autoplayTimer = window.setTimeout(() => effect?.burst(), 650)
    }
  } catch (cause) {
    if (currentLoad !== loadId) return
    loading.value = false
    error.value = cause instanceof Error ? cause.message : '图片加载失败。'
  }
}

function replay() {
  effect?.burst()
}

onMounted(() => {
  if (!host.value) return
  try {
    effect = new ParticlePhoto(host.value)
    void load(props.source)
  } catch {
    loading.value = false
    error.value = '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。'
  }
})

watch(() => props.source, (source) => void load(source))

onBeforeUnmount(() => {
  loadId++
  window.clearTimeout(autoplayTimer)
  effect?.dispose()
})

defineExpose({ replay })
</script>

<template>
  <div class="photo-stage" role="button" tabindex="0" aria-label="点击让照片消散并重组" @click="replay" @keydown.enter.prevent="replay" @keydown.space.prevent="replay">
    <div ref="host" class="photo-stage__canvas"></div>
    <div v-if="loading" class="stage-message" role="status">正在读取图片像素...</div>
    <div v-if="error" class="stage-message stage-message--error" role="alert">{{ error }}</div>
    <div class="stage-corner stage-corner--tl"></div>
    <div class="stage-corner stage-corner--tr"></div>
    <div class="stage-corner stage-corner--bl"></div>
    <div class="stage-corner stage-corner--br"></div>
  </div>
</template>
