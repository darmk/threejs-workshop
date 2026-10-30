<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { publicAsset } from '../utils/publicAsset'
import { PopulationTide, type PopulationDataset, type PopulationLocation } from '../three/PopulationTide'

const host = ref<HTMLElement | null>(null)
const dataset = ref<PopulationDataset | null>(null)
const error = ref('')
const loading = ref(true)
const birthYear = ref(1990)
const yearInput = ref('1990')
const location = ref<PopulationLocation>('china')
const currentYear = ref(1990)
const playing = ref(false)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let effect: PopulationTide | undefined
let pointerId: number | null = null
let destroyed = false

const locations: Array<{ id: PopulationLocation; label: string }> = [
  { id: 'china', label: '中国' },
  { id: 'world', label: '世界' },
  { id: 'india', label: '印度' },
  { id: 'japan', label: '日本' },
  { id: 'usa', label: '美国' },
]
const presets = [1960, 1975, 1985, 1995, 2005, 2015]
const age = computed(() => currentYear.value - birthYear.value)
const isProjection = computed(() => currentYear.value > 2023)
const populationThousands = computed(() => {
  const data = dataset.value
  if (!data) return 0
  return data.locations[location.value].populationThousands[currentYear.value - data.firstYear]?.[age.value] ?? 0
})
const populationLabel = computed(() => {
  const people = populationThousands.value * 1000
  if (people >= 100_000_000) return `${(people / 100_000_000).toFixed(2)} 亿`
  if (people >= 10_000) return `${(people / 10_000).toFixed(1)} 万`
  return people.toLocaleString('zh-CN')
})
const shareLabel = computed(() => {
  const data = dataset.value
  if (!data) return '—'
  const row = data.locations[location.value].populationThousands[currentYear.value - data.firstYear]
  if (!row) return '—'
  return `${(populationThousands.value / row.reduce((sum, value) => sum + value, 0) * 100).toFixed(2)}%`
})

function commitYear() {
  const raw = Number(yearInput.value)
  const next = Number.isFinite(raw) ? Math.min(2026, Math.max(1950, Math.round(raw))) : birthYear.value
  birthYear.value = next
  yearInput.value = String(next)
  currentYear.value = next
  effect?.setBirthYear(next)
  if (reducedMotion) {
    effect?.seek(2026)
    playing.value = false
  } else {
    playing.value = next < 2026
  }
}

function choosePreset(year: number) {
  yearInput.value = String(year)
  commitYear()
}

function changeLocation(event: Event) {
  location.value = (event.target as HTMLSelectElement).value as PopulationLocation
  effect?.setLocation(location.value)
}

function togglePlayback() {
  if (!effect) return
  if (playing.value) {
    effect.pause()
    playing.value = false
  } else {
    effect.play()
    playing.value = birthYear.value < 2026
  }
}

function seek(event: Event) {
  const year = Number((event.target as HTMLInputElement).value)
  effect?.seek(year)
  currentYear.value = year
  playing.value = false
}

function pointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
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

onMounted(async () => {
  try {
    const response = await fetch(publicAsset('data/population-cohorts.json'))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json() as PopulationDataset
    if (destroyed || !host.value) return
    dataset.value = data
    effect = new PopulationTide(host.value, data, (year, isPlaying) => {
      currentYear.value = year
      playing.value = isPlaying
    })
    if (reducedMotion) effect.seek(2026)
    else effect.setBirthYear(birthYear.value)
    loading.value = false
  } catch (cause) {
    loading.value = false
    error.value = cause instanceof Error && /WebGL|context/i.test(cause.message)
      ? '当前浏览器无法启动 WebGL，请换用支持 WebGL 的浏览器。'
      : '人口数据加载失败，请检查网络后刷新页面。'
  }
})
onBeforeUnmount(() => {
  destroyed = true
  effect?.dispose()
})
</script>

<template>
  <div class="population-workspace">
    <div class="population-stage" aria-label="三维人口地形，横向是年份，纵深是年龄，高度表示人口数量。拖动画面可以稍微改变视角。" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp">
      <div ref="host" class="population-stage__canvas"></div>
      <div class="population-stage__shade" aria-hidden="true"></div>
      <div class="population-stage__topline"><span>POPULATION / TIDE <b>012</b></span><span>UN WPP 2024 · 1950—2026</span></div>
      <div class="population-stage__year"><small>{{ isProjection ? '中方案预测 / PROJECTION' : '人口估计 / ESTIMATE' }}</small><strong>{{ currentYear }}</strong><span>年</span></div>
      <div class="population-stage__card">
        <span class="population-stage__card-kicker"><i></i> {{ birthYear }} 年出生 / {{ location === 'world' ? '世界' : dataset?.locations[location].label ?? '中国' }}</span>
        <p>这一年，{{ age }} 岁的人有</p>
        <strong>{{ loading ? '读取中…' : populationLabel }}</strong>
        <div><span>占当年总人口</span><b>{{ shareLabel }}</b></div>
      </div>
      <div class="population-stage__axis" aria-hidden="true"><span>年份 →</span><span>↗ 年龄</span><span>高度 = 人数</span></div>
      <div class="population-stage__legend"><i></i> 暖色轨迹：所选出生年份对应的年龄</div>
      <div v-if="loading" class="population-stage__message" role="status">正在读取人口数据…</div>
      <div v-if="error" class="population-stage__message population-stage__message--error" role="alert">{{ error }}</div>
    </div>

    <div class="population-controls">
      <div class="population-controls__top">
        <div class="population-controls__intro"><span>人口切片 / 12</span><p>同一年出生，<br />会经过怎样的人口浪潮？</p></div>
        <label class="population-controls__entry"><span>输入出生年份</span><div><input v-model="yearInput" type="number" inputmode="numeric" min="1950" max="2026" step="1" aria-label="出生年份，1950 到 2026" @change="commitYear" @keydown.enter.prevent="commitYear" /><b>年</b></div></label>
        <label class="population-controls__place"><span>选择地区</span><select :value="location" @change="changeLocation"><option v-for="item in locations" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
      </div>
      <div class="population-controls__presets"><span>试试这些年份</span><button v-for="year in presets" :key="year" type="button" :aria-pressed="birthYear === year" :class="{ active: birthYear === year }" @click="choosePreset(year)">{{ year }}</button></div>
      <div class="population-controls__timeline">
        <button type="button" class="population-controls__play" :disabled="loading || !!error" @click="togglePlayback">{{ playing ? '暂停' : currentYear >= 2026 ? '重播' : '播放' }} <span aria-hidden="true">{{ playing ? 'Ⅱ' : '▶' }}</span></button>
        <label><span>观察年份 <b>{{ currentYear }}</b></span><input type="range" :min="birthYear" max="2026" step="1" :value="currentYear" :disabled="loading || !!error" aria-label="拖动观察年份" @input="seek" /><small>{{ birthYear }} 出生</small><small>2026 现在</small></label>
        <button type="button" class="population-controls__reset" :disabled="loading || !!error" @click="effect?.resetView()">复位视角 ↗</button>
      </div>
    </div>
  </div>
</template>
