<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { findCity, loadHeatCity, type HeatCity } from '../data/heatWall'
import { HeatWall } from '../three/HeatWall'
import { publicAsset } from '../utils/publicAsset'

const host = ref<HTMLElement | null>(null)
const query = ref('北京')
const city = ref<HeatCity | null>(null)
const selectedYear = ref(2025)
const selectedDay = ref<number | null>(null)
const hoverInfo = ref<{ year: number; day: number; temperature: number } | null>(null)
const tourPlaying = ref(false)
const focusYear = ref(false)
const loading = ref(true)
const error = ref('')
const status = ref('正在准备北京的 40 个夏天…')
const presets = ['北京', '上海', '广州', '重庆']
let wall: HeatWall | undefined
let controller: AbortController | undefined
let requestId = 0
let destroyed = false
let downX = 0
let downY = 0
let tourTimer: number | undefined
let tourStartTimer: number | undefined
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const summer = computed(() => city.value?.summers[selectedYear.value - 1986])
const hottest = computed(() => city.value?.summers.reduce((best, item) => item.meanMax > best.meanMax ? item : best))
const coolest = computed(() => city.value?.summers.reduce((best, item) => item.meanMax < best.meanMax ? item : best))
const earlyMean = computed(() => city.value ? city.value.summers.slice(0, 10).reduce((sum, item) => sum + item.meanMax, 0) / 10 : 0)
const lateMean = computed(() => city.value ? city.value.summers.slice(-10).reduce((sum, item) => sum + item.meanMax, 0) / 10 : 0)
const decadeDelta = computed(() => lateMean.value - earlyMean.value)
const maxHotDays = computed(() => Math.max(1, ...(city.value?.summers.map(item => item.hotDays) ?? [])))
const hottestYears = computed(() => [...(city.value?.summers ?? [])].sort((a, b) => b.hotDays - a.hotDays).slice(0, 3))
function dateLabel(year: number, day: number) {
  const start = city.value && city.value.latitude < 0 ? new Date(Date.UTC(year - 1, 11, 1)) : new Date(Date.UTC(year, 5, 1))
  start.setUTCDate(start.getUTCDate() + day)
  return `${start.getUTCMonth() + 1} 月 ${start.getUTCDate()} 日`
}
const selectedDayLabel = computed(() => selectedDay.value === null ? '' : dateLabel(selectedYear.value, selectedDay.value))

function stopTour() {
  window.clearInterval(tourTimer)
  window.clearTimeout(tourStartTimer)
  tourTimer = undefined
  tourStartTimer = undefined
  tourPlaying.value = false
}

function setYear(year: number, manual = true) {
  if (manual) stopTour()
  if (manual) { focusYear.value = true; wall?.setFocused(true) }
  selectedYear.value = Math.max(1986, Math.min(2025, Math.round(year)))
  selectedDay.value = null
  wall?.selectYear(selectedYear.value)
}

function startTour() {
  if (!city.value) return
  stopTour()
  focusYear.value = false
  wall?.setFocused(false)
  setYear(1986, false)
  tourPlaying.value = true
  tourTimer = window.setInterval(() => {
    if (selectedYear.value >= 2025) { stopTour(); return }
    setYear(selectedYear.value + 1, false)
  }, 170)
}

function scheduleTour() {
  stopTour()
  focusYear.value = false
  wall?.setFocused(false)
  if (reducedMotion) return
  setYear(1986, false)
  tourStartTimer = window.setTimeout(startTour, 1900)
}

function returnOverview() {
  focusYear.value = false
  selectedDay.value = null
  hoverInfo.value = null
  wall?.setFocused(false)
}

async function useCity(name: string) {
  const trimmed = name.trim()
  if (!trimmed) {
    error.value = '请输入城市名称。'
    return
  }
  controller?.abort()
  stopTour()
  controller = new AbortController()
  const current = ++requestId
  loading.value = true
  error.value = ''
  status.value = `正在寻找${trimmed}并读取历史气温…`
  try {
    const location = await findCity(trimmed, controller.signal)
    const result = await loadHeatCity(location, controller.signal)
    if (destroyed || current !== requestId) return
    city.value = result
    query.value = result.name
    selectedYear.value = 2025
    selectedDay.value = null
    wall?.setCity(result)
    scheduleTour()
    status.value = `${result.name}的 40 个夏天已加载。`
  } catch (cause) {
    if (destroyed || current !== requestId || controller.signal.aborted) return
    error.value = cause instanceof Error ? cause.message : '加载失败，请稍后重试。'
    status.value = error.value
  } finally {
    if (!destroyed && current === requestId) loading.value = false
  }
}

function onSubmit() { void useCity(query.value) }
function onPreset(name: string) { query.value = name; void useCity(name) }
function pointerDown(event: PointerEvent) {
  stopTour()
  downX = event.clientX
  downY = event.clientY
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  wall?.pointerDown(event)
}
function pointerUp(event: PointerEvent) {
  wall?.pointerUp()
  if (Math.hypot(event.clientX - downX, event.clientY - downY) < 8) wall?.pointerClick(event)
}
function pointerMove(event: PointerEvent) { wall?.pointerMove(event) }
function hovered(value: { year: number; day: number; temperature: number } | null) {
  if (value && !hoverInfo.value) stopTour()
  hoverInfo.value = value
  if (value && selectedYear.value !== value.year) selectedYear.value = value.year
}

onMounted(async () => {
  try {
    if (!host.value) return
    wall = new HeatWall(host.value, ({ year, day }) => {
      focusYear.value = true
      selectedYear.value = year
      selectedDay.value = day
      status.value = `${year} 年 ${dateLabel(year, day)}，最高气温 ${city.value?.summers[year - 1986]?.days[day]?.toFixed(1) ?? '未知'} 摄氏度。`
    }, hovered)
    const response = await fetch(publicAsset('data/heat-wall-beijing.json'))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json() as HeatCity
    if (destroyed) return
    city.value = data
    wall.setCity(data)
    scheduleTour()
    status.value = '北京的 40 个夏天已加载。'
  } catch (cause) {
    if (destroyed) return
    error.value = cause instanceof Error && /WebGL/i.test(cause.message) ? '当前浏览器无法启动 WebGL。' : '默认气温数据加载失败，请刷新重试。'
    status.value = error.value
  } finally {
    if (!destroyed) loading.value = false
  }
})
onBeforeUnmount(() => {
  destroyed = true
  controller?.abort()
  stopTour()
  wall?.dispose()
})
</script>

<template>
  <div class="heat-wall-workspace">
    <div class="heat-wall-stage" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="wall?.pointerUp()" @pointerleave="wall?.pointerLeave()" @lostpointercapture="wall?.pointerUp()">
      <div ref="host" class="heat-wall-canvas"></div>
      <div class="heat-wall-stage__top"><span>HEAT ARCHIVE / 017</span><span>ERA5 · 1986—2025</span></div>
      <div class="heat-wall-stage__headline"><small>{{ city?.country || '历史气温' }} / {{ city?.name || '北京' }}</small><strong>40 个夏天<br /><em>叠成一堵墙。</em></strong></div>
      <div class="heat-wall-stage__side">一列 = 一个夏天　·　一格 = 一天</div>
      <div class="heat-wall-stage__years"><span>1986</span><span>1995</span><span>2005</span><span>2015</span><span>2025</span></div>
      <div v-if="city && !focusYear" class="heat-wall-stage__delta"><small>后十个夏天 对比 前十个</small><strong>{{ decadeDelta >= 0 ? '+' : '' }}{{ decadeDelta.toFixed(1) }}<span>°C</span></strong><p>夏季日最高气温均值</p></div>
      <div v-if="focusYear && summer" class="heat-wall-stage__delta heat-wall-stage__delta--focus"><small>从 40 个夏天里抽出这一年</small><strong>{{ selectedYear }}<span> 年</span></strong><p>≥35°C 的日子有 {{ summer.hotDays }} 天</p></div>
      <div v-if="hoverInfo" class="heat-wall-stage__hover"><span>{{ hoverInfo.year }} 年 · {{ dateLabel(hoverInfo.year, hoverInfo.day) }}</span><strong>{{ hoverInfo.temperature.toFixed(1) }}°C</strong><small>当天最高气温</small></div>
      <button class="heat-wall-stage__play" type="button" :disabled="!city" @pointerdown.stop @pointerup.stop @click.stop="tourPlaying ? stopTour() : startTour()">{{ tourPlaying ? '暂停巡览 Ⅱ' : '播放 40 个夏天 ▶' }}</button>
      <button v-if="focusYear" class="heat-wall-stage__overview" type="button" @pointerdown.stop @pointerup.stop @click.stop="returnOverview">返回 40 年全貌 ↗</button>
      <div v-if="loading && !city" class="heat-wall-stage__message" role="status">{{ status }}</div>
    </div>

    <div class="heat-wall-controls">
      <div class="heat-wall-overview"><div class="heat-wall-overview__heading"><div><span class="heat-wall-kicker">40 SUMMERS / 年度高温日</span><strong>哪一年，热得更久？</strong></div><p>每根柱子 = 当年最高气温达到 35°C 的天数。<br />拖动柱状图选择年份。</p></div><div class="heat-wall-bars"><span v-for="item in city?.summers ?? []" :key="item.year" :class="{ active: selectedYear === item.year }"><i :style="{ height: `${Math.max(4, item.hotDays / maxHotDays * 100)}%` }"></i></span><label for="heat-year" class="visually-hidden">在高温日柱状图上选择年份</label><input id="heat-year" type="range" min="1986" max="2025" step="1" :value="selectedYear" :disabled="!city" @input="setYear(Number(($event.target as HTMLInputElement).value))" /></div><div class="heat-wall-overview__axis"><span>1986</span><span>1995</span><span>2005</span><span>2015</span><span>2025</span></div><div class="heat-wall-overview__quick"><span>高温日最多的年份</span><button v-for="item in hottestYears" :key="item.year" type="button" @click="setYear(item.year)">{{ item.year }} 年 <b>{{ item.hotDays }} 天</b></button></div></div>
      <div class="heat-wall-controls__search">
        <div><span class="heat-wall-kicker">把你熟悉的城市放进来</span><p>有些夏天，<br />隔着屏幕也觉得热。</p></div>
        <form class="heat-wall-form" @submit.prevent="onSubmit">
          <label for="heat-city">输入城市</label>
          <div><input id="heat-city" v-model="query" name="city" type="search" required maxlength="60" autocomplete="off" placeholder="例如：北京、上海、东京" :aria-invalid="!!error" aria-describedby="heat-city-help" /><button type="submit" :disabled="loading">{{ loading ? '读取中…' : '生成热度墙 ↗' }}</button></div>
          <small id="heat-city-help">中文或英文城市名均可；同名城市可加国家。需要联网读取历史数据。</small>
        </form>
      </div>
      <div class="heat-wall-presets"><span>试试这些城市</span><button v-for="name in presets" :key="name" type="button" :disabled="loading" @click="onPreset(name)">{{ name }}</button></div>
      <div class="heat-wall-readout">
        <div class="heat-wall-readout__year"><span>正在看</span><strong>{{ selectedYear }}</strong><span>年夏天</span></div>
        <div class="heat-wall-readout__metric"><small>日最高气温均值</small><strong>{{ summer?.meanMax.toFixed(1) ?? '—' }}<sup>°C</sup></strong></div>
        <div class="heat-wall-readout__metric"><small>≥35°C 的天数</small><strong>{{ summer?.hotDays ?? '—' }}<sup>天</sup></strong></div>
        <div class="heat-wall-readout__metric"><small>单日最高</small><strong>{{ summer?.peak.toFixed(1) ?? '—' }}<sup>°C</sup></strong></div>
      </div>
      <div class="heat-wall-legend"><span>凉</span><div aria-hidden="true"></div><span>热</span><small>≤22°C</small><small>≥39°C</small></div>
      <div class="heat-wall-bottom"><p v-if="selectedDay !== null && summer"><b>{{ selectedYear }} 年 {{ selectedDayLabel }}</b> · 当日最高 {{ summer.days[selectedDay]?.toFixed(1) }}°C</p><p v-else>点一块色片看某一天；拖动画面换个角度。</p><p v-if="hottest && coolest" class="heat-wall-bottom__compare">这 40 年里，按夏季日最高气温均值：<b>{{ hottest.year }} 年最高</b>，{{ coolest.year }} 年最低。</p></div>
      <p v-if="error" class="heat-wall-error" role="alert">{{ error }}</p><span class="visually-hidden" role="status">{{ status }}</span>
    </div>
  </div>
</template>

<style scoped>
.heat-wall-workspace{border:1px solid #3a312e;background:#111016;color:#f6e9db;overflow:hidden}
.heat-wall-stage{position:relative;height:620px;overflow:hidden;background:radial-gradient(ellipse at 59% 54%,#48241e 0%,#1a1720 38%,#0b0e16 77%);touch-action:pan-y;cursor:grab}
.heat-wall-stage:active{cursor:grabbing}
.heat-wall-stage:after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(8,10,17,.72),transparent 28%,transparent 78%,rgba(8,10,17,.17)),linear-gradient(0deg,rgba(8,10,17,.8),transparent 21%,transparent 72%,rgba(8,10,17,.5))}
.heat-wall-canvas{position:absolute;inset:0}
.heat-wall-canvas :deep(canvas){display:block;width:100%;height:100%}
.heat-wall-stage__top,.heat-wall-stage__headline,.heat-wall-stage__side,.heat-wall-stage__years,.heat-wall-stage__message{position:absolute;z-index:1;pointer-events:none}
.heat-wall-stage__top{top:24px;left:32px;right:32px;display:flex;justify-content:space-between;color:#b6a4a0;font-size:10px;letter-spacing:.19em}
.heat-wall-stage__headline{left:5.8%;top:16%;display:flex;flex-direction:column;gap:14px}
.heat-wall-stage__headline small{color:#e8ad8d;font-size:11px;letter-spacing:.18em}
.heat-wall-stage__headline strong{font-weight:550;font-size:clamp(26px,3.2vw,51px);line-height:1.18;letter-spacing:-.07em;text-shadow:0 3px 30px #080a12}
.heat-wall-stage__headline em{font-style:normal;color:#f7a66e}
.heat-wall-stage__side{right:28px;top:50%;writing-mode:vertical-rl;color:#c5aea0;font-size:10px;letter-spacing:.15em}
.heat-wall-stage__years{bottom:20px;left:10%;right:9%;display:flex;justify-content:space-between;color:#bcaeaa;font-size:11px;font-variant-numeric:tabular-nums}
.heat-wall-stage__message{inset:0;display:grid;place-items:center;background:#111016d9;color:#f3bd99;font-size:14px}
.heat-wall-stage__delta,.heat-wall-stage__hover,.heat-wall-stage__play{position:absolute;z-index:2}.heat-wall-stage__delta{top:92px;right:6%;padding:16px 19px;background:#141319d9;border-left:2px solid #efaa75;pointer-events:none;box-shadow:0 12px 35px #08091088}.heat-wall-stage__delta small{display:block;color:#d6aa8a;font-size:10px;letter-spacing:.08em}.heat-wall-stage__delta strong{display:block;margin-top:7px;color:#ffe1ae;font:500 45px Georgia,serif}.heat-wall-stage__delta strong span{font-size:18px}.heat-wall-stage__delta p{margin:0;color:#c4a597;font-size:10px}.heat-wall-stage__hover{right:6%;bottom:80px;min-width:180px;padding:13px 16px;background:#1d1717ed;border:1px solid #d99165;pointer-events:none;box-shadow:0 12px 35px #08091099}.heat-wall-stage__hover span,.heat-wall-stage__hover small{display:block;color:#dbc0ae;font-size:11px}.heat-wall-stage__hover strong{display:block;margin:4px 0;color:#ffe0aa;font:500 32px Georgia,serif}.heat-wall-stage__play{top:245px;left:5.8%;min-height:44px;padding:0 20px;border:1px solid #f3ad78;background:#f3ad78;color:#291815;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 8px 26px #0008}.heat-wall-stage__play:hover{background:#ffd0a2}.heat-wall-stage__play:focus-visible,.heat-wall-overview__quick button:focus-visible,.heat-wall-bars input:focus-visible{outline:2px solid #fff0c5;outline-offset:3px}
.heat-wall-stage__delta--focus{background:#231713eb;border-color:#ffce92}.heat-wall-stage__delta--focus strong{font-size:39px}.heat-wall-stage__overview{position:absolute;z-index:2;top:301px;left:5.8%;min-height:42px;padding:0 18px;border:1px solid #c69b7f;background:#19161ad9;color:#ffe0c5;font-size:11px}.heat-wall-stage__overview:hover{background:#3b2521}.heat-wall-stage__overview:focus-visible{outline:2px solid #ffe1a0;outline-offset:3px}
.heat-wall-controls{padding:28px 34px 30px;background:#1b191b}
.heat-wall-overview{margin-bottom:30px;padding:20px 24px 17px;background:#13151a;border:1px solid #51413a}.heat-wall-overview__heading{display:flex;justify-content:space-between;align-items:end;gap:20px}.heat-wall-overview__heading strong{display:block;margin-top:7px;color:#f9dcc2;font-size:20px;font-weight:550;letter-spacing:-.04em}.heat-wall-overview__heading p{margin:0;color:#ac9c95;font-size:10px;line-height:1.6;text-align:right}.heat-wall-bars{position:relative;display:grid;grid-template-columns:repeat(40,minmax(0,1fr));align-items:end;gap:3px;height:86px;margin-top:20px;border-bottom:1px solid #766055}.heat-wall-bars>span{height:100%;display:flex;align-items:end;background:#27232a}.heat-wall-bars i{display:block;width:100%;min-height:3px;background:linear-gradient(0deg,#a94d35,#f0a262);transition:height .25s ease}.heat-wall-bars>span.active{background:#624337;outline:1px solid #ffcf92;outline-offset:1px}.heat-wall-bars>span.active i{background:linear-gradient(0deg,#f17c47,#ffe0a4)}.heat-wall-bars input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:ew-resize}.heat-wall-overview__axis{display:flex;justify-content:space-between;margin-top:7px;color:#a99992;font-size:10px}.heat-wall-overview__quick{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px}.heat-wall-overview__quick>span{margin-right:7px;color:#aa9991;font-size:10px}.heat-wall-overview__quick button{min-height:32px;padding:5px 9px;border:1px solid #6b4a3f;background:#2b2020;color:#f5d4bc;font-size:10px}.heat-wall-overview__quick button:hover{border-color:#efad78}.heat-wall-overview__quick b{margin-left:4px;color:#ffb77e}
.heat-wall-controls__search{display:grid;grid-template-columns:1fr minmax(360px,1.4fr);gap:25px;align-items:end}
.heat-wall-kicker{font-size:10px;letter-spacing:.18em;color:#e9a374}
.heat-wall-controls__search p{margin:8px 0 0;font-size:19px;line-height:1.45;letter-spacing:-.05em}
.heat-wall-form label{display:block;margin-bottom:9px;color:#ead5c5;font-size:12px}
.heat-wall-form>div{display:flex;gap:8px}
.heat-wall-form input{width:100%;min-width:0;min-height:48px;padding:0 14px;border:1px solid #74665f;border-radius:0;background:#100f13;color:#fff;font-size:16px}
.heat-wall-form input:focus-visible,.heat-wall-form button:focus-visible,.heat-wall-presets button:focus-visible,.heat-wall-timeline input:focus-visible{outline:2px solid #ffbc82;outline-offset:3px}
.heat-wall-form button{min-height:48px;padding:0 20px;border:0;background:#e99a63;color:#1f1512;font-weight:700;white-space:nowrap}
.heat-wall-form button:hover{background:#ffb37b}
.heat-wall-form button:disabled,.heat-wall-presets button:disabled{opacity:.6;cursor:wait}
.heat-wall-form small{display:block;margin-top:8px;color:#a99b95;font-size:10px;line-height:1.6}
.heat-wall-presets{display:flex;gap:8px;align-items:center;margin-top:20px}
.heat-wall-presets span{margin-right:7px;color:#9d918c;font-size:10px}
.heat-wall-presets button{min-width:58px;padding:7px 10px;border:1px solid #5a4a46;background:transparent;color:#e5cabc;font-size:11px}
.heat-wall-presets button:hover{border-color:#edaa7b;color:#ffca9f}
.heat-wall-readout{display:grid;grid-template-columns:1.25fr repeat(3,1fr);gap:14px;margin-top:26px;padding:22px 0;border-top:1px solid #51423d;border-bottom:1px solid #51423d}
.heat-wall-readout__year{display:flex;align-items:baseline;gap:7px;color:#b8a59b;font-size:11px}
.heat-wall-readout__year strong{color:#ffd0a1;font:500 clamp(32px,3.2vw,48px) Georgia,serif}
.heat-wall-readout__metric{display:flex;flex-direction:column;gap:8px}
.heat-wall-readout__metric small{color:#afa19a;font-size:11px}
.heat-wall-readout__metric strong{color:#fff1dc;font:500 clamp(25px,2.7vw,37px) Georgia,serif;font-variant-numeric:tabular-nums}
.heat-wall-readout__metric sup{padding-left:3px;font:400 11px sans-serif;color:#d4b19c;vertical-align:baseline}
.heat-wall-legend{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:4px 12px;margin-top:18px;color:#baa99f;font-size:10px}.heat-wall-legend>div{height:8px;background:linear-gradient(90deg,#213c54,#6f6b68,#c58b55,#ed633a,#ffca75)}.heat-wall-legend small{grid-row:2;color:#968880;font-size:9px}.heat-wall-legend small:nth-of-type(1){grid-column:2;justify-self:start}.heat-wall-legend small:nth-of-type(2){grid-column:2;justify-self:end}
.heat-wall-timeline{margin-top:23px}.heat-wall-timeline label{display:flex;justify-content:space-between;color:#dfc3b1;font-size:11px}.heat-wall-timeline label b{color:#ffbf8d}.heat-wall-timeline input{display:block;width:100%;margin:11px 0 4px;accent-color:#f0a16e}.heat-wall-timeline>div{display:flex;justify-content:space-between;color:#907e78;font-size:10px}
.heat-wall-bottom{display:flex;justify-content:space-between;gap:18px;color:#b4a6a0;font-size:11px;line-height:1.6}.heat-wall-bottom b{color:#ffd2ab;font-weight:600}.heat-wall-bottom__compare{text-align:right}.heat-wall-error{margin:13px 0 0;color:#ffb1a2;font-size:12px}
@media(max-width:800px){.heat-wall-stage{height:560px}.heat-wall-controls__search{grid-template-columns:1fr}.heat-wall-stage__headline{top:13%}.heat-wall-readout{grid-template-columns:repeat(2,1fr)}.heat-wall-stage__delta{top:160px;right:20px}.heat-wall-stage__hover{right:20px}}
@media(max-width:600px){.heat-wall-stage{height:680px}.heat-wall-stage__top{top:18px;left:18px;right:18px;font-size:8px}.heat-wall-stage__top span:last-child{display:none}.heat-wall-stage__headline{top:61px;left:20px}.heat-wall-stage__headline strong{font-size:29px}.heat-wall-stage__side{right:14px;top:42%;font-size:9px}.heat-wall-stage__years{display:none}.heat-wall-controls{padding:22px 18px 25px}.heat-wall-controls__search p{font-size:17px}.heat-wall-form>div{flex-wrap:wrap}.heat-wall-form button{width:100%}.heat-wall-presets{flex-wrap:wrap}.heat-wall-presets span{width:100%}.heat-wall-presets button{flex:1}.heat-wall-readout{gap:18px 9px}.heat-wall-readout__year strong{font-size:36px}.heat-wall-bottom{display:block}.heat-wall-bottom__compare{text-align:left}}
@media(max-width:600px){.heat-wall-stage__delta{top:160px;right:14px;padding:10px 12px}.heat-wall-stage__delta strong{font-size:29px}.heat-wall-stage__hover{bottom:88px;right:14px;min-width:145px;padding:9px 12px}.heat-wall-stage__hover strong{font-size:24px}.heat-wall-stage__play{top:auto;bottom:30px;left:50%;transform:translateX(-50%)}.heat-wall-overview{padding:16px 13px}.heat-wall-overview__heading{display:block}.heat-wall-overview__heading p{text-align:left;margin-top:8px}.heat-wall-bars{gap:1px}.heat-wall-overview__quick>span{width:100%}}
@media(max-width:600px){.heat-wall-stage__overview{top:auto;bottom:83px;left:50%;transform:translateX(-50%);white-space:nowrap}.heat-wall-stage__delta--focus strong{font-size:29px}}
</style>
