<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { CustomPhotoDepth, type CustomDepthFocus } from '../three/CustomPhotoDepth'
import { PhotoDepth, type DepthFocus } from '../three/PhotoDepth'

type Focus = DepthFocus | CustomDepthFocus
type Point = { x: number; y: number }
type Tool = 'foreground' | 'middle'
const W = 1024
const H = 768
const emit = defineEmits<{
  'focus-change': [focus: Focus]
  'mode-change': [mode: 'default' | 'custom', hasMiddle: boolean]
  'editing-change': [editing: boolean]
}>()

const host = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const editorCanvas = ref<HTMLCanvasElement | null>(null)
const error = ref('')
const uploadError = ref('')
const activeFocus = ref<Focus>('petals')
const exploded = ref(false)
const editing = ref(false)
const customMode = ref(false)
const hasMiddle = ref(false)
const tool = ref<Tool>('foreground')
const fileName = ref('')
const foregroundPath = ref<Point[]>([])
const middlePath = ref<Point[]>([])
let currentPath: Point[] = []
let sourceCanvas: HTMLCanvasElement | undefined
let effect: PhotoDepth | CustomPhotoDepth | undefined
let objectUrl = ''
let disposed = false
let strength = 1
let drawing = false
let pointer = { x: 0, y: 0, lastX: 0, lastY: 0, moved: false }

const flowerLabels: Record<DepthFocus, string> = { background: '暗色背景', leaves: '叶片', petals: '花瓣', spadix: '花蕊' }
const customLabels: Record<CustomDepthFocus, string> = { background: '背景', middle: '中景', foreground: '前景' }
const currentLabel = () => customMode.value
  ? customLabels[activeFocus.value as CustomDepthFocus]
  : flowerLabels[activeFocus.value as DepthFocus]

function createDefault() {
  if (!host.value) return
  effect = new PhotoDepth(host.value, focus => { activeFocus.value = focus; emit('focus-change', focus) }, () => { error.value = '照片加载失败，请刷新页面再试。' })
  effect.setStrength(strength)
}

function onPointerDown(event: PointerEvent) {
  if (editing.value || (event.pointerType === 'mouse' && event.button !== 0)) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  pointer = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false }
}
function onPointerMove(event: PointerEvent) {
  if (editing.value || !(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return
  const dx = event.clientX - pointer.lastX, dy = event.clientY - pointer.lastY
  if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) pointer.moved = true
  if (pointer.moved) effect?.movePointer(dx, dy)
  pointer.lastX = event.clientX
  pointer.lastY = event.clientY
}
function onPointerUp(event: PointerEvent) {
  if (editing.value || !(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  effect?.endPointer()
  if (!pointer.moved) effect?.focusAt(event.clientX, event.clientY)
}

function setFocus(focus: Focus) {
  if (customMode.value) (effect as CustomPhotoDepth | undefined)?.setFocus(focus as CustomDepthFocus)
  else (effect as PhotoDepth | undefined)?.setFocus(focus as DepthFocus)
}
function setExploded(value: boolean) { exploded.value = value; effect?.setExploded(value) }
function setStrength(value: number) { strength = value; effect?.setStrength(value) }
function reset() { exploded.value = false; effect?.reset() }
function openUpload() { fileInput.value?.click() }

// 统一到 1024×768：模糊 cover 图填充留白，清晰 contain 图保留完整主体，后续遮罩共用该像素空间。
function preparedCanvas(image: HTMLImageElement) {
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const cover = Math.max(W / image.naturalWidth, H / image.naturalHeight)
  const cw = image.naturalWidth * cover, ch = image.naturalHeight * cover
  context.filter = 'blur(38px) brightness(0.32)'
  context.drawImage(image, (W - cw) / 2, (H - ch) / 2, cw, ch)
  context.filter = 'none'
  const contain = Math.min(W / image.naturalWidth, H / image.naturalHeight)
  const iw = image.naturalWidth * contain, ih = image.naturalHeight * contain
  context.drawImage(image, (W - iw) / 2, (H - ih) / 2, iw, ih)
  return canvas
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploadError.value = ''
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { uploadError.value = '请选择 JPG、PNG 或 WebP 图片。'; return }
  if (file.size > 15 * 1024 * 1024) { uploadError.value = '图片请小于 15 MB。'; return }
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(file)
  const url = objectUrl
  const image = new Image()
  image.onload = async () => {
    URL.revokeObjectURL(url)
    if (objectUrl === url) objectUrl = ''
    if (disposed) return
    sourceCanvas = preparedCanvas(image)
    fileName.value = file.name
    foregroundPath.value = []; middlePath.value = []; currentPath = []
    tool.value = 'foreground'; editing.value = true
    emit('editing-change', true)
    await nextTick(); drawEditor()
  }
  image.onerror = () => {
    URL.revokeObjectURL(url)
    if (objectUrl === url) objectUrl = ''
    uploadError.value = '图片无法读取，请换一张再试。'
  }
  image.src = url
}

function drawPath(context: CanvasRenderingContext2D, path: Point[], fill: string, stroke: string, close = true) {
  if (path.length < 2) return
  context.beginPath(); context.moveTo(path[0].x, path[0].y)
  for (let i = 1; i < path.length; i++) context.lineTo(path[i].x, path[i].y)
  if (close && path.length > 2) { context.closePath(); context.fillStyle = fill; context.fill() }
  context.strokeStyle = stroke; context.lineWidth = 4; context.lineJoin = 'round'; context.lineCap = 'round'; context.stroke()
}
function drawEditor() {
  if (!sourceCanvas || !editorCanvas.value) return
  const canvas = editorCanvas.value
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
  const context = canvas.getContext('2d')!
  context.clearRect(0, 0, W, H); context.drawImage(sourceCanvas, 0, 0)
  drawPath(context, middlePath.value, '#71a9f451', '#8dc4ff')
  drawPath(context, foregroundPath.value, '#efa76d59', '#ffc18e')
  drawPath(context, currentPath, tool.value === 'foreground' ? '#efa76d59' : '#71a9f451', tool.value === 'foreground' ? '#ffc18e' : '#8dc4ff', false)
}
// 将编辑画布显示区域的 CSS 像素换算为固定尺寸像素；路径与遮罩均采用左上原点、Y 向下。
function editorPoint(event: PointerEvent): Point {
  const bounds = (event.currentTarget as HTMLCanvasElement).getBoundingClientRect()
  return { x: Math.max(0, Math.min(W, (event.clientX - bounds.left) / bounds.width * W)), y: Math.max(0, Math.min(H, (event.clientY - bounds.top) / bounds.height * H)) }
}
function onEditorDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  ;(event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId)
  drawing = true; uploadError.value = ''; currentPath = [editorPoint(event)]; drawEditor()
}
function onEditorMove(event: PointerEvent) {
  if (!drawing || !(event.currentTarget as HTMLCanvasElement).hasPointerCapture(event.pointerId)) return
  const point = editorPoint(event), last = currentPath[currentPath.length - 1]
  if (Math.hypot(point.x - last.x, point.y - last.y) > 3) { currentPath.push(point); drawEditor() }
}
function onEditorUp(event: PointerEvent) {
  if (!drawing || !(event.currentTarget as HTMLCanvasElement).hasPointerCapture(event.pointerId)) return
  ;(event.currentTarget as HTMLCanvasElement).releasePointerCapture(event.pointerId)
  drawing = false
  if (currentPath.length > 8) {
    if (tool.value === 'foreground') foregroundPath.value = [...currentPath]
    else middlePath.value = [...currentPath]
  } else uploadError.value = '请按住并沿着物体外轮廓画一圈。'
  currentPath = []; drawEditor()
}
function clearCurrentPath() {
  if (tool.value === 'foreground') foregroundPath.value = []
  else middlePath.value = []
  drawEditor()
}
// 闭合路径并以 2 像素模糊软化遮罩边缘，减轻分层后轮廓的硬切感。
function maskFromPath(path: Point[]) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.filter = 'blur(2px)'; context.fillStyle = '#fff'; context.beginPath(); context.moveTo(path[0].x, path[0].y)
  for (let i = 1; i < path.length; i++) context.lineTo(path[i].x, path[i].y)
  context.closePath(); context.fill()
  return canvas
}
function applyCustom() {
  if (!sourceCanvas || !host.value) return
  if (foregroundPath.value.length < 9) { uploadError.value = '先按住画面，沿前景主体外轮廓画一圈。'; return }
  const near = maskFromPath(foregroundPath.value)
  const middle = middlePath.value.length > 8 ? maskFromPath(middlePath.value) : undefined
  try {
    const previous = effect
    const next = new CustomPhotoDepth(host.value, sourceCanvas, near, middle, focus => { activeFocus.value = focus; emit('focus-change', focus) })
    previous?.dispose()
    effect = next
    effect.setStrength(strength)
    activeFocus.value = 'foreground'; exploded.value = false; customMode.value = true; hasMiddle.value = Boolean(middle); editing.value = false
    emit('mode-change', 'custom', hasMiddle.value); emit('focus-change', 'foreground'); emit('editing-change', false)
  } catch { error.value = '这张照片无法生成空间画面，请换一张再试。' }
}
async function editCustom() {
  if (!sourceCanvas) return
  editing.value = true; emit('editing-change', true)
  await nextTick(); drawEditor()
}
function cancelEdit() {
  editing.value = false
  if (!customMode.value) { sourceCanvas = undefined; foregroundPath.value = []; middlePath.value = [] }
  emit('editing-change', false)
}
function restoreDefault() {
  effect?.dispose(); sourceCanvas = undefined; foregroundPath.value = []; middlePath.value = []
  customMode.value = false; hasMiddle.value = false; editing.value = false; exploded.value = false; activeFocus.value = 'petals'; error.value = ''; uploadError.value = ''
  emit('mode-change', 'default', false); emit('focus-change', 'petals'); emit('editing-change', false)
  try { createDefault() } catch { error.value = '当前浏览器无法启动 WebGL。' }
}

onMounted(() => { try { createDefault() } catch { error.value = '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。' } })
onBeforeUnmount(() => { disposed = true; effect?.dispose(); if (objectUrl) URL.revokeObjectURL(objectUrl) })
defineExpose({ setFocus, setExploded, setStrength, reset, openUpload, editCustom, restoreDefault })
</script>

<template>
  <div class="depth-stage" :class="{ 'depth-stage--exploded': exploded, 'depth-stage--editing': editing }" :role="editing ? undefined : 'img'" :aria-label="editing ? undefined : '立体照片，拖动画面观察视差，点按切换对焦'" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
    <input ref="fileInput" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传照片" @change="onFileChange" />
    <div class="depth-stage__backdrop" aria-hidden="true"></div>
    <div ref="host" class="depth-stage__canvas"></div>
    <div class="depth-stage__grain" aria-hidden="true"></div>
    <div v-if="!editing" class="depth-stage__topline"><span>PHOTO DEPTH <b>011</b></span><span>{{ customMode ? '我的照片 / 空间分层' : '一张照片 / 四个空间平面' }}</span></div>
    <div v-if="!editing" class="depth-stage__index" aria-hidden="true">01 <span>/</span> {{ customMode ? (hasMiddle ? '03' : '02') : '04' }}</div>
    <div v-if="!editing" class="depth-stage__caption"><span>当前焦点</span><strong>{{ currentLabel() }}</strong><i></i><span>拖动视角 · 点按对焦</span></div>
    <div v-if="!editing" class="depth-stage__axis" aria-hidden="true"><span>FAR</span><i></i><span>NEAR</span></div>
    <div v-if="!editing" class="depth-stage__layers" aria-hidden="true">
      <template v-if="customMode"><span>01 背景</span><span v-if="hasMiddle">02 中景</span><span>{{ hasMiddle ? '03' : '02' }} 前景</span></template>
      <template v-else><span>01 背景</span><span>02 叶片</span><span>03 花瓣</span><span>04 花蕊</span></template>
    </div>
    <div v-if="editing" class="depth-editor" @pointerdown.stop @pointermove.stop @pointerup.stop>
      <div class="depth-editor__head"><div><span>BUILD YOUR DEPTH</span><strong>圈出照片里的前后层次</strong></div><button type="button" aria-label="关闭分层编辑" @click="cancelEdit">×</button></div>
      <div class="depth-editor__image-wrap"><canvas ref="editorCanvas" class="depth-editor__image" :width="W" :height="H" aria-label="在照片上按住并圈出前景或中景" @pointerdown="onEditorDown" @pointermove="onEditorMove" @pointerup="onEditorUp" @pointercancel="onEditorUp"></canvas></div>
      <div class="depth-editor__foot">
        <div class="depth-editor__tools"><button type="button" :class="{ 'is-active': tool === 'foreground' }" :aria-pressed="tool === 'foreground'" @click="tool = 'foreground'">01 圈前景 <i :class="{ 'is-done': foregroundPath.length > 8 }"></i></button><button type="button" :class="{ 'is-active': tool === 'middle' }" :aria-pressed="tool === 'middle'" @click="tool = 'middle'">02 圈中景 <small>可选</small><i :class="{ 'is-done': middlePath.length > 8 }"></i></button><button type="button" @click="clearCurrentPath">清除当前圈选</button></div>
        <button class="depth-editor__generate" type="button" @click="applyCustom">生成空间照片 ↗</button>
      </div>
      <p class="depth-editor__hint">按住画面沿主体外轮廓画一圈，松开自动闭合。中景可以跳过。<span>{{ fileName }}</span></p>
      <p v-if="uploadError" class="depth-editor__error" role="alert">{{ uploadError }}</p>
    </div>
    <div v-else-if="uploadError" class="depth-stage__upload-error" role="alert">{{ uploadError }}</div>
    <div v-if="error" class="stage-message stage-message--error" role="alert">{{ error }}</div>
  </div>
</template>
