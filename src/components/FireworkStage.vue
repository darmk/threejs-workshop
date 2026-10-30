<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TextFireworks } from '../three/TextFireworks'

const props = defineProps<{ text: string }>()
const host = ref<HTMLElement | null>(null)
const error = ref('')
let effect: TextFireworks | undefined
let autoplayTimer = 0

function launch() {
  window.clearTimeout(autoplayTimer)
  effect?.launch()
}

onMounted(() => {
  if (!host.value) return
  try {
    effect = new TextFireworks(host.value, props.text)
    autoplayTimer = window.setTimeout(launch, 1100)
  } catch {
    error.value = '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。'
  }
})

watch(() => props.text, (text) => {
  if (!effect || !text.trim()) return
  window.clearTimeout(autoplayTimer)
  effect.setText(text)
})

onBeforeUnmount(() => {
  window.clearTimeout(autoplayTimer)
  effect?.dispose()
})

defineExpose({ launch })
</script>

<template>
  <div class="firework-stage" role="button" tabindex="0" aria-label="点击让文字变成烟花" @click="launch" @keydown.enter.prevent="launch" @keydown.space.prevent="launch">
    <div ref="host" class="firework-stage__canvas"></div>
    <span class="firework-stage__index">VISUAL EXPERIMENT <b>003</b></span>
    <span class="firework-stage__caption">写下一句话，送它去夜空里。</span>
    <span class="firework-stage__hint">点击画面 · 再放一次 <span aria-hidden="true">↗</span></span>
    <div v-if="error" class="stage-message stage-message--error" role="alert">{{ error }}</div>
  </div>
</template>
