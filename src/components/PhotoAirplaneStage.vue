<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { PhotoAirplane, type AirplaneState } from '../three/PhotoAirplane'
import { publicAsset } from '../utils/publicAsset'

const host = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const state = ref<AirplaneState>({ phase: 'photo', progress: 0, charge: 0 })
const error = ref('')
const loading = ref(true)
const selected = ref('landscape')
const photoName = ref('山野来信')
const photoLayout = ref<'contain' | 'cover'>('cover')
let effect: PhotoAirplane | undefined
let objectUrl = ''
let currentSource = publicAsset('images/seasons/spring-lake.jpg')
let activePointer: number | null = null
const busy = computed(() => state.value.phase === 'flying')
const steps = ['铺开照片', '收起两角', '折出机身', '展开双翼']
const currentStep = computed(() => state.value.progress < 1 ? 0 : state.value.progress < 33 ? 1 : state.value.progress < 82 ? 2 : 3)
const phaseLabel = computed(() => ({ photo: '一张照片，准备出发。', folding: '沿着折痕，把风的形状折出来。', ready: '飞机折好了，按住画面向后拉。', aiming: '松手，交给下一阵风。', flying: '照片还在，只是飞向了远处。', away: '有些照片，值得再放飞一次。' })[state.value.phase])
const actionLabel = computed(() => ({ photo: '开始折纸', folding: '重新折一遍', ready: '直接放飞', aiming: '松手放飞', flying: '正在飞行…', away: '再飞一次' })[state.value.phase])

function primaryAction() {
  if (state.value.phase === 'away') { effect?.readyAgain(); effect?.launch() }
  else if (state.value.phase === 'ready') effect?.launch()
  else effect?.fold()
}
function preset(id: 'landscape' | 'flower') {
  if (!effect || busy.value) return
  loading.value = true; error.value = ''; selected.value = id
  photoName.value = id === 'landscape' ? '山野来信' : '花的一页'
  currentSource = publicAsset(id === 'landscape' ? 'images/seasons/spring-lake.jpg' : 'images/anthurium.webp')
  photoLayout.value = 'cover'
  effect.setSource(currentSource)
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = '' }
}
function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]; input.value = ''
  if (!file || !effect) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { error.value = '请选择 JPG、PNG 或 WebP 照片。'; return }
  if (file.size > 15 * 1024 * 1024) { error.value = '照片请小于 15 MB。'; return }
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(file)
  selected.value = 'custom'; photoName.value = file.name
  loading.value = true; error.value = ''
  currentSource = objectUrl; photoLayout.value = 'contain'
  effect.setSource(currentSource, 'contain')
}
function layout(value: 'contain' | 'cover') {
  photoLayout.value = value; loading.value = true; error.value = ''
  effect?.setSource(currentSource, value)
}
function down(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  if (!effect?.pointerDown(event.clientX, event.clientY)) return
  activePointer = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) { if (activePointer === event.pointerId) effect?.pointerMove(event.clientX, event.clientY) }
function up(event: PointerEvent) {
  if (activePointer !== event.pointerId) return
  activePointer = null
  const element = event.currentTarget as HTMLElement
  if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
  effect?.pointerUp(event.type === 'pointercancel')
}
function lostCapture() { if (activePointer !== null) { activePointer = null; effect?.pointerUp(true) } }
onMounted(() => {
  if (!host.value) return
  try {
    effect = new PhotoAirplane(host.value, publicAsset('images/seasons/spring-lake.jpg'), value => { state.value = value }, message => { error.value = message; loading.value = false })
  } catch { loading.value = false; error.value = '当前浏览器无法启动 WebGL，请使用支持 WebGL 的浏览器。' }
})
onBeforeUnmount(() => { effect?.dispose(); if (objectUrl) URL.revokeObjectURL(objectUrl) })
</script>

<template>
  <section class="airplane-workspace" aria-label="照片折成纸飞机的交互示例">
    <div class="airplane-source">
      <div><span>这次，送哪一张？</span><button :class="{ active: selected === 'landscape' }" :disabled="busy || loading" @click="preset('landscape')">山野来信</button><button :class="{ active: selected === 'flower' }" :disabled="busy || loading" @click="preset('flower')">花的一页</button></div>
      <div v-if="selected === 'custom'" class="airplane-layout"><button :class="{ active: photoLayout === 'contain' }" :disabled="busy || loading" @click="layout('contain')">完整照片</button><button :class="{ active: photoLayout === 'cover' }" :disabled="busy || loading" @click="layout('cover')">铺满纸面</button></div>
      <button class="airplane-upload" :disabled="busy" @click="fileInput?.click()">换成我的照片 <span aria-hidden="true">↗</span></button>
      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" class="visually-hidden" aria-label="上传折纸照片" @change="upload" />
    </div>
    <div class="airplane-stage" :class="[`airplane-stage--${state.phase}`, { 'airplane-stage--interactive': state.phase === 'ready' || state.phase === 'aiming' }]" role="img" aria-label="照片纸张沿折痕变成纸飞机，折好后按住向后拉、松手放飞" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="lostCapture">
      <div ref="host" class="airplane-stage__canvas"></div>
      <div class="airplane-stage__top"><span>WIND LETTER <b>013</b></span><span>一张照片 / 一次远行</span></div>
      <div class="airplane-stage__note" aria-hidden="true"><span>TO THE NEXT WIND</span><strong>寄给<br />下一阵风。</strong><small>{{ photoName }}</small></div>
      <div class="airplane-stage__steps" aria-label="折纸步骤"><span v-for="(step, index) in steps" :key="step" :class="{ active: currentStep === index, done: currentStep > index }"><b>0{{ index + 1 }}</b>{{ step }}</span></div>
      <div v-if="state.phase === 'aiming'" class="airplane-stage__charge"><span>放飞力度 <b>{{ state.charge }}%</b></span><i><b :style="{ width: `${Math.max(8, state.charge)}%` }"></b></i></div>
      <div v-if="state.phase === 'away'" class="airplane-stage__away"><span>DELIVERED TO THE WIND</span><strong>替你，把这一刻送远一点。</strong><button @pointerdown.stop @pointerup.stop @click="effect?.readyAgain()">取回纸飞机 ↙</button></div>
      <div class="airplane-stage__caption"><i></i><span>{{ phaseLabel }}</span></div>
      <div v-if="loading" class="airplane-stage__loading" role="status">正在把照片铺到纸上…</div>
      <p v-if="error" class="airplane-error" role="alert">{{ error }}</p>
    </div>
    <div class="airplane-controls">
      <div class="airplane-controls__intro"><span>一张纸的旅行 / 13</span><p>折起来，再让它飞。</p></div>
      <label class="airplane-scrub"><span>折叠进度 <b>{{ state.progress }}%</b></span><input type="range" min="0" max="100" step="1" :value="state.progress" :disabled="busy || loading || state.phase === 'away'" aria-label="逐步查看照片折叠进度" @input="effect?.setProgress(Number(($event.target as HTMLInputElement).value) / 100)" /><small>一张照片</small><small>一架纸飞机</small></label>
      <div class="airplane-controls__actions"><button class="airplane-reset" :disabled="loading" @click="effect?.resetPhoto()">重新铺开</button><button class="airplane-primary" :disabled="busy || loading || Boolean(error)" @click="primaryAction">{{ actionLabel }} <span aria-hidden="true">↗</span></button></div>
    </div>
    <div class="airplane-instruction"><span>01 选照片</span><i></i><span>02 沿折痕折好</span><i></i><span>03 按住向后拉，松手放飞</span><small>也可以拖动进度，慢慢看每一折。</small></div>
  </section>
</template>
