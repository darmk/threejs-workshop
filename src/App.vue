<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref } from 'vue'
import { experimentCategories, experiments, type ExperimentCategory, type ExperimentId } from './data/experiments'
import { publicAsset } from './utils/publicAsset'
import type { GalaxyPalette } from './three/NebulaGalaxy'
import type { TunnelPalette } from './three/NeonTunnel'
import type { DepthFocus } from './three/PhotoDepth'
import type { CustomDepthFocus } from './three/CustomPhotoDepth'

const PhotoStage = defineAsyncComponent(() => import('./components/PhotoStage.vue'))
const LiquidStage = defineAsyncComponent(() => import('./components/LiquidStage.vue'))
const FireworkStage = defineAsyncComponent(() => import('./components/FireworkStage.vue'))
const PortalStage = defineAsyncComponent(() => import('./components/PortalStage.vue'))
const GalaxyStage = defineAsyncComponent(() => import('./components/GalaxyStage.vue'))
const RainWindowStage = defineAsyncComponent(() => import('./components/RainWindowStage.vue'))
const HolographicEarthStage = defineAsyncComponent(() => import('./components/HolographicEarthStage.vue'))
const NeonTunnelStage = defineAsyncComponent(() => import('./components/NeonTunnelStage.vue'))
const SeasonGlassStage = defineAsyncComponent(() => import('./components/SeasonGlassStage.vue'))
const MiniatureCityStage = defineAsyncComponent(() => import('./components/MiniatureCityStage.vue'))
const PhotoDepthStage = defineAsyncComponent(() => import('./components/PhotoDepthStage.vue'))
const PopulationTideStage = defineAsyncComponent(() => import('./components/PopulationTideStage.vue'))
const PhotoAirplaneStage = defineAsyncComponent(() => import('./components/PhotoAirplaneStage.vue'))
const FlowerTrailStage = defineAsyncComponent(() => import('./components/FlowerTrailStage.vue'))

const defaultPhoto = publicAsset('images/anthurium.webp')
const defaultPoster = publicAsset('images/liquid-poster.png')
type Page = 'home' | ExperimentId
function pageFromHash(): Page {
  return experiments.find(experiment => experiment.href === window.location.hash)?.id ?? 'home'
}
const currentPage = ref<Page>(pageFromHash())
const activeCategory = ref<'all' | ExperimentCategory>('all')
const searchQuery = ref('')
const newestFirst = ref(true)
const featuredExperiment = experiments.find(experiment => experiment.id === 'season')!
const filteredExperiments = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  const matches = experiments.filter(experiment => {
    const inCategory = activeCategory.value === 'all' || experiment.category === activeCategory.value
    const text = [experiment.number, experiment.title, experiment.summary, experiment.categoryLabel, ...experiment.tags].join(' ').toLocaleLowerCase()
    return inCategory && (!query || text.includes(query))
  })
  return newestFirst.value ? matches.reverse() : matches
})
const photoSource = ref(defaultPhoto)
const uploadError = ref('')
const stage = ref<{ replay: () => void } | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
let objectUrl = ''
const posterSource = ref(defaultPoster)
const posterError = ref('')
const posterStage = ref<{ splash: () => void; clear: () => void } | null>(null)
const posterFileInput = ref<HTMLInputElement | null>(null)
const posterStrength = ref(1)
let posterObjectUrl = ''
const fireworkText = ref('好事正在发生')
const fireworkStage = ref<{ launch: () => void } | null>(null)
const portalStage = ref<{ enter: () => void; reset: () => void } | null>(null)
const portalState = ref<'ready' | 'travelling' | 'arrived' | 'returning'>('ready')
const galaxyStage = ref<{ pulse: () => void; resetView: () => void } | null>(null)
const galaxyPalette = ref<GalaxyPalette>('violet')
const galaxySpeed = ref(1)
const galaxyPaused = ref(false)
const rainStage = ref<{ wipeCenter: () => void; reset: () => void; lightning: () => void } | null>(null)
const rainIntensity = ref(1)
const rainPaused = ref(false)
const earthStage = ref<{ ping: () => void; resetView: () => void } | null>(null)
const earthSpeed = ref(1)
const earthPaused = ref(false)
const tunnelStage = ref<{ pulse: () => void; reset: () => void } | null>(null)
const tunnelSpeed = ref(1)
const tunnelPaused = ref(false)
const tunnelPalette = ref<TunnelPalette>('afterglow')
const seasonStage = ref<{ breakCenter: () => void; reset: () => void } | null>(null)
const cityStage = ref<{ replay: () => void; resetView: () => void; setProgress: (value: number) => void } | null>(null)
const cityProgress = ref(0)
type AnyDepthFocus = DepthFocus | CustomDepthFocus
const depthStage = ref<{ setFocus: (focus: AnyDepthFocus) => void; setExploded: (value: boolean) => void; setStrength: (value: number) => void; reset: () => void; openUpload: () => void; editCustom: () => void; restoreDefault: () => void } | null>(null)
const depthFocus = ref<AnyDepthFocus>('petals')
const depthExploded = ref(false)
const depthStrength = ref(1)
const depthMode = ref<'default' | 'custom'>('default')
const depthHasMiddle = ref(false)
const depthEditing = ref(false)
const depthFocusOptions = computed<Array<[AnyDepthFocus, string]>>(() => depthMode.value === 'default'
  ? [['background', '背景'], ['leaves', '叶片'], ['petals', '花瓣'], ['spadix', '花蕊']]
  : depthHasMiddle.value ? [['background', '背景'], ['middle', '中景'], ['foreground', '前景']] : [['background', '背景'], ['foreground', '前景']])

function onDepthModeChange(mode: 'default' | 'custom', hasMiddle: boolean) {
  depthMode.value = mode
  depthHasMiddle.value = hasMiddle
  depthFocus.value = mode === 'default' ? 'petals' : 'foreground'
  depthExploded.value = false
  depthStrength.value = 1
  depthStage.value?.setStrength(1)
}

function toggleDepthLayers() {
  depthExploded.value = !depthExploded.value
  depthStage.value?.setExploded(depthExploded.value)
}

function resetDepth() {
  depthExploded.value = false
  depthStrength.value = 1
  depthStage.value?.setStrength(1)
  depthStage.value?.reset()
}

function activatePortal() {
  if (portalState.value === 'ready') portalStage.value?.enter()
  else if (portalState.value === 'arrived') portalStage.value?.reset()
}

function chooseFireworkText(value: string) {
  fireworkText.value = value
  void nextTick(() => fireworkStage.value?.launch())
}

function resetTunnel() {
  tunnelSpeed.value = 1
  tunnelPaused.value = false
  tunnelPalette.value = 'afterglow'
  tunnelStage.value?.reset()
}

function syncRoute() {
  currentPage.value = pageFromHash()
  window.scrollTo(0, 0)
}

function jumpToExperiment(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  const experiment = experiments.find(item => item.id === id)
  if (experiment) window.location.hash = experiment.href
}

function browseExperiments() {
  document.getElementById('experiments')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openUpload() {
  fileInput.value?.click()
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadError.value = ''
  if (!file.type.startsWith('image/')) {
    uploadError.value = '请选择图片文件。'
  } else if (file.size > 15 * 1024 * 1024) {
    uploadError.value = '图片请小于 15 MB。'
  } else {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = URL.createObjectURL(file)
    photoSource.value = objectUrl
  }
  input.value = ''
}

function restorePhoto() {
  photoSource.value = defaultPhoto
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
  uploadError.value = ''
}

function openPosterUpload() {
  posterFileInput.value?.click()
}

function onPosterFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  posterError.value = ''
  if (!file.type.startsWith('image/')) {
    posterError.value = '请选择图片文件。'
  } else if (file.size > 15 * 1024 * 1024) {
    posterError.value = '图片请小于 15 MB。'
  } else {
    if (posterObjectUrl) URL.revokeObjectURL(posterObjectUrl)
    posterObjectUrl = URL.createObjectURL(file)
    posterSource.value = posterObjectUrl
  }
  input.value = ''
}

function restorePoster() {
  posterSource.value = defaultPoster
  if (posterObjectUrl) {
    URL.revokeObjectURL(posterObjectUrl)
    posterObjectUrl = ''
  }
  posterError.value = ''
}

window.addEventListener('hashchange', syncRoute)
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', syncRoute)
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  if (posterObjectUrl) URL.revokeObjectURL(posterObjectUrl)
})
</script>

<template>
  <div class="app-shell">
    <header class="site-header">
      <a class="brand" href="#/" aria-label="视觉实验室首页">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span>视觉实验室</span>
      </a>
      <nav class="top-nav" aria-label="主导航">
        <a href="#/" :class="{ active: currentPage === 'home' }">全部实验</a>
        <label class="nav-jump">
          <span class="visually-hidden">快速跳转到实验</span>
          <select :value="currentPage === 'home' ? '' : currentPage" @change="jumpToExperiment">
            <option value="" disabled>快速跳转</option>
            <option v-for="experiment in experiments" :key="experiment.id" :value="experiment.id">{{ experiment.number }} · {{ experiment.title }}</option>
          </select>
        </label>
      </nav>
      <span class="header-note">{{ experiments.length }} 个实验 / 持续更新</span>
    </header>

    <main v-if="currentPage === 'home'" class="home-page">
      <section class="catalog-hero" aria-labelledby="catalog-hero-title">
        <div class="catalog-hero__copy">
          <p class="catalog-kicker"><span>VISUAL LAB / THREE.JS × VUE</span><span>001—{{ String(experiments.length).padStart(3, '0') }}</span></p>
          <h1 id="catalog-hero-title">看见它。<br /><em>亲手改变它。</em></h1>
          <p class="catalog-hero__lede">从照片粒子到微缩街道。这里的每个画面，都可以点开、拖动、亲自试一遍。</p>
          <div class="catalog-hero__actions">
            <button class="catalog-hero__browse" type="button" @click="browseExperiments">浏览全部实验 <span aria-hidden="true">↓</span></button>
            <span>{{ experiments.length }} 个可玩的画面，持续增加</span>
          </div>
          <div class="catalog-hero__index"><span>实验正在进行</span><span>SCROLL TO EXPLORE <b aria-hidden="true">↘</b></span></div>
        </div>
        <a class="catalog-feature" :href="featuredExperiment.href" :aria-label="`打开精选实验：${featuredExperiment.title}`">
          <img :src="featuredExperiment.image" :alt="featuredExperiment.imageAlt" fetchpriority="high" />
          <span class="catalog-feature__top">本期精选 <b>{{ featuredExperiment.number }}</b></span>
          <span class="catalog-feature__bottom"><span><small>点击画面，冬天会裂开</small><strong>{{ featuredExperiment.title }}</strong></span><b aria-hidden="true">↗</b></span>
        </a>
      </section>

      <section id="experiments" class="catalog" aria-labelledby="catalog-title">
        <div class="catalog-heading">
          <div><p class="catalog-kicker">INDEX / 视觉实验索引</p><h2 id="catalog-title">挑一个画面，<br />进去试试。<sup>{{ experiments.length }}</sup></h2></div>
          <p>每期都是一个独立的交互实验。看图挑选，或按主题、关键词寻找。</p>
        </div>
        <div class="catalog-toolbar">
          <div class="catalog-filters" role="group" aria-label="按主题筛选实验">
            <button v-for="category in experimentCategories" :key="category.id" type="button" :class="{ active: activeCategory === category.id }" :aria-pressed="activeCategory === category.id" @click="activeCategory = category.id">{{ category.label }}</button>
          </div>
          <div class="catalog-toolbar__right">
            <label class="catalog-search"><span class="visually-hidden">搜索实验</span><span aria-hidden="true">⌕</span><input v-model="searchQuery" type="search" placeholder="搜索实验、效果或关键词" /></label>
            <button class="catalog-sort" type="button" :aria-label="newestFirst ? '当前最新优先，点击改为从第一期开始' : '当前从第一期开始，点击改为最新优先'" @click="newestFirst = !newestFirst">{{ newestFirst ? '最新优先' : '从第一期开始' }} <span aria-hidden="true">↕</span></button>
          </div>
        </div>
        <p class="catalog-count" aria-live="polite">显示 {{ filteredExperiments.length }} / {{ experiments.length }} 个实验</p>
        <div v-if="filteredExperiments.length" class="catalog-grid">
          <a v-for="experiment in filteredExperiments" :key="experiment.id" class="catalog-card" :href="experiment.href">
            <div class="catalog-card__image"><img :src="experiment.image" :alt="experiment.imageAlt" loading="lazy" width="900" height="600" /><span>{{ experiment.number }} / {{ String(experiments.length).padStart(2, '0') }}</span></div>
            <div class="catalog-card__body">
              <p>{{ experiment.categoryLabel }} <span aria-hidden="true">/</span> {{ experiment.tags.slice(0, 2).join(' · ') }}</p>
              <h3>{{ experiment.title }}</h3>
              <div><span>{{ experiment.summary }}</span><b aria-hidden="true">↗</b></div>
            </div>
          </a>
        </div>
        <div v-else class="catalog-empty"><strong>没有找到对应的实验。</strong><p>换个关键词，或返回全部主题继续逛。</p><button type="button" @click="searchQuery = ''; activeCategory = 'all'">查看全部实验 ↗</button></div>
        <p class="catalog-end">还会继续更新。下一个画面，正在制作中。</p>
      </section>
    </main>

    <main v-else-if="currentPage === 'particle'" class="demo-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 01 / 图像与粒子</span>
      </div>

      <div class="demo-heading">
        <div>
          <p class="eyebrow">PHOTO TO PARTICLES</p>
          <h1>照片粒子<br /><em>消散与重组</em></h1>
        </div>
        <p>一张完整的照片，在鼠标下散成细小的色点。试着点击画面，看它再聚回来。</p>
      </div>

      <section class="demo-workspace" aria-label="照片粒子交互示例">
        <div class="workspace-stage">
          <PhotoStage ref="stage" :source="photoSource" />
        </div>
        <div class="workspace-toolbar">
          <div class="toolbar-hint"><span class="hint-dot"></span> 移动鼠标拨开照片 · 点击画面触发消散</div>
          <div class="toolbar-actions">
            <button class="toolbar-button toolbar-button--outline" type="button" @click="openUpload">上传照片</button>
            <button v-if="photoSource !== defaultPhoto" class="toolbar-button toolbar-button--text" type="button" @click="restorePhoto">恢复示例</button>
            <button class="toolbar-button toolbar-button--primary" type="button" @click="stage?.replay()">重新播放 <span aria-hidden="true">↗</span></button>
          </div>
        </div>
        <p v-if="uploadError" class="upload-error" role="alert">{{ uploadError }}</p>
        <input ref="fileInput" class="visually-hidden" type="file" accept="image/*" aria-label="选择一张图片" @change="onFileChange" />
      </section>

      <div class="demo-footnote">
        <span>你的图片只会在当前浏览器中读取，不会上传。</span>
        <span>建议使用主体清晰、对比明显的照片。</span>
      </div>
    </main>

    <main v-else-if="currentPage === 'liquid'" class="demo-page liquid-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 02 / 图像与水波</span>
      </div>

      <div class="demo-heading liquid-heading">
        <div>
          <p class="eyebrow">LIQUID POSTER</p>
          <h1>鼠标拨动的<br /><em>液态海报</em></h1>
        </div>
        <p>把鼠标放到海报上，慢慢划过。文字与画面会一起弯曲，水纹从指尖向外扩散。</p>
      </div>

      <section class="liquid-workspace" aria-label="液态海报交互示例">
        <div class="liquid-workspace__visual">
          <div class="liquid-workspace__intro">
            <span class="liquid-workspace__number">02 / 交互实验</span>
            <p>画面像水面一样，<br />会记住你的每一次触碰。</p>
            <span class="liquid-workspace__instruction">在海报上移动鼠标，或轻点屏幕 <span aria-hidden="true">↗</span></span>
          </div>
          <LiquidStage ref="posterStage" :source="posterSource" :is-default="posterSource === defaultPoster" :strength="posterStrength" />
          <div class="liquid-workspace__side">DRAG TO DISTORT <span>—</span> 2026</div>
        </div>

        <div class="liquid-controls">
          <div class="liquid-controls__slider">
            <label for="liquid-strength">折射强度 <strong>{{ posterStrength.toFixed(1) }}×</strong></label>
            <input id="liquid-strength" v-model.number="posterStrength" type="range" min="0.4" max="2" step="0.1" />
          </div>
          <div class="toolbar-actions">
            <button class="toolbar-button toolbar-button--outline" type="button" @click="openPosterUpload">换张图片</button>
            <button v-if="posterSource !== defaultPoster" class="toolbar-button toolbar-button--text" type="button" @click="restorePoster">恢复示例</button>
            <button class="toolbar-button toolbar-button--outline" type="button" @click="posterStage?.clear()">清空水波</button>
            <button class="toolbar-button toolbar-button--primary" type="button" @click="posterStage?.splash()">激起水纹 <span aria-hidden="true">↗</span></button>
          </div>
        </div>
        <p v-if="posterError" class="upload-error" role="alert">{{ posterError }}</p>
        <input ref="posterFileInput" class="visually-hidden" type="file" accept="image/*" aria-label="选择海报图片" @change="onPosterFileChange" />
      </section>

      <div class="demo-footnote">
        <span>替换图片只在当前浏览器中读取，不会上传。</span>
        <span>默认示例的中文字和背景在同一张纹理上，因此会一起变形。</span>
      </div>
    </main>

    <main v-else-if="currentPage === 'fireworks'" class="demo-page fireworks-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 03 / 文字与光</span>
      </div>

      <div class="demo-heading fireworks-heading">
        <div>
          <p class="eyebrow">WORDS TO FIREWORKS</p>
          <h1>文字变成<br /><em>烟花</em></h1>
        </div>
        <p>写下一句话。它会从字形里飞起，在夜空里开成几束光，然后回到原来的位置。</p>
      </div>

      <section class="fireworks-workspace" aria-label="文字变成烟花交互示例">
        <FireworkStage ref="fireworkStage" :text="fireworkText.trim() || '好事正在发生'" />
        <div class="fireworks-controls">
          <div class="fireworks-controls__entry">
            <label for="firework-text">写下你的话 <span>最多 12 个字</span></label>
            <input id="firework-text" v-model="fireworkText" type="text" maxlength="12" placeholder="写一句想送给夜空的话" @blur="fireworkText = fireworkText.trim() || '好事正在发生'" @keydown.enter.prevent="fireworkStage?.launch()" />
          </div>
          <button class="toolbar-button toolbar-button--primary fireworks-launch" type="button" @click="fireworkStage?.launch()">点燃文字 <span aria-hidden="true">↗</span></button>
        </div>
        <div class="fireworks-presets" aria-label="示例文案">
          <span>试试这些</span>
          <button type="button" @click="chooseFireworkText('好事正在发生')">好事正在发生</button>
          <button type="button" @click="chooseFireworkText('生日快乐')">生日快乐</button>
          <button type="button" @click="chooseFireworkText('今晚有光')">今晚有光</button>
        </div>
      </section>

      <div class="demo-footnote">
        <span>文字在当前浏览器里采样成光点，不会发送到服务器。</span>
        <span>点击夜空或按回车，也可以重新播放。</span>
      </div>
    </main>

    <main v-else-if="currentPage === 'portal'" class="demo-page portal-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 04 / 空间与穿越</span>
      </div>

      <div class="demo-heading portal-heading">
        <div>
          <p class="eyebrow">STEP THROUGH THE UNKNOWN</p>
          <h1>穿越<br /><em>传送门</em></h1>
        </div>
        <p>眼前的圆环通向另一片天空。移动鼠标看它轻轻偏转，点击穿过边界，看看门后是什么。</p>
      </div>

      <section class="portal-workspace" aria-label="穿越传送门交互示例">
        <PortalStage ref="portalStage" @state-change="portalState = $event" />
        <div class="portal-controls">
          <div class="portal-controls__steps" aria-hidden="true">
            <span><b>01</b> 靠近光环</span>
            <i></i>
            <span><b>02</b> 穿过边界</span>
            <i></i>
            <span><b>03</b> 抵达另一侧</span>
          </div>
          <div class="toolbar-actions">
            <button class="toolbar-button toolbar-button--primary portal-enter" type="button" :disabled="portalState === 'travelling' || portalState === 'returning'" @click="activatePortal">{{ portalState === 'arrived' ? '返回起点' : portalState === 'travelling' ? '正在穿越' : portalState === 'returning' ? '正在返回' : '开始穿越' }} <span aria-hidden="true">↗</span></button>
          </div>
        </div>
      </section>

      <div class="demo-footnote">
        <span>圆环、门内景象和另一侧的场景均由 Three.js 实时绘制。</span>
        <span>支持鼠标、触摸点击与键盘操作；可随时返回入口重新体验。</span>
      </div>
    </main>

    <main v-else-if="currentPage === 'galaxy'" class="demo-page galaxy-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 05 / 星云与粒子</span>
      </div>

      <div class="demo-heading galaxy-heading">
        <div>
          <p class="eyebrow">NEBULA IN MOTION</p>
          <h1>可交互的<br /><em>星云银河</em></h1>
        </div>
        <p>这片银河不只是背景。拖动画面看旋臂的侧面，靠近星核，再轻点一下，让光从中心向外传开。</p>
      </div>

      <section class="galaxy-workspace" aria-label="可交互的星云银河示例">
        <GalaxyStage ref="galaxyStage" :palette="galaxyPalette" :speed="galaxySpeed" :paused="galaxyPaused" />
        <div class="galaxy-controls">
          <fieldset class="galaxy-palettes">
            <legend>星云色谱</legend>
            <button type="button" :aria-pressed="galaxyPalette === 'violet'" :class="{ active: galaxyPalette === 'violet' }" @click="galaxyPalette = 'violet'"><i class="galaxy-swatch galaxy-swatch--violet"></i> 紫罗兰</button>
            <button type="button" :aria-pressed="galaxyPalette === 'aurora'" :class="{ active: galaxyPalette === 'aurora' }" @click="galaxyPalette = 'aurora'"><i class="galaxy-swatch galaxy-swatch--aurora"></i> 极光蓝</button>
            <button type="button" :aria-pressed="galaxyPalette === 'ember'" :class="{ active: galaxyPalette === 'ember' }" @click="galaxyPalette = 'ember'"><i class="galaxy-swatch galaxy-swatch--ember"></i> 赤焰金</button>
          </fieldset>
          <div class="galaxy-controls__right">
            <div class="galaxy-speed">
              <label for="galaxy-speed">旋转速度 <strong>{{ galaxySpeed.toFixed(1) }}×</strong></label>
              <input id="galaxy-speed" v-model.number="galaxySpeed" type="range" min="0.2" max="2" step="0.1" />
            </div>
            <div class="toolbar-actions">
              <button class="toolbar-button toolbar-button--outline" type="button" @click="galaxyPaused = !galaxyPaused">{{ galaxyPaused ? '继续旋转' : '暂停旋转' }}</button>
              <button class="toolbar-button toolbar-button--outline" type="button" @click="galaxyStage?.resetView()">重置视角</button>
              <button class="toolbar-button toolbar-button--primary galaxy-pulse" type="button" @click="galaxyStage?.pulse()">点亮星尘 <span aria-hidden="true">↗</span></button>
            </div>
          </div>
        </div>
      </section>

      <div class="demo-footnote">
        <span>银河由实时生成的粒子和着色器组成；切换色谱不会重新创建粒子。</span>
        <span>鼠标拖拽、滚轮缩放；触屏可拖动、双指缩放。</span>
      </div>
    </main>

    <main v-else-if="currentPage === 'rain'" class="demo-page rain-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 06 / 雨、水与折射</span>
      </div>

      <div class="demo-heading rain-heading">
        <div>
          <p class="eyebrow">AFTER DARK, BEFORE DAWN</p>
          <h1>雨夜<br /><em>玻璃窗</em></h1>
        </div>
        <p>雨滴沿着窗面缓缓滑落。按住玻璃划过一道痕迹，模糊的城市会在指尖短暂清晰。</p>
      </div>

      <section class="rain-workspace" aria-label="雨夜玻璃窗交互示例">
        <RainWindowStage ref="rainStage" :rain="rainIntensity" :paused="rainPaused" />
        <div class="rain-controls">
          <div class="rain-controls__intro"><span class="rain-controls__eyebrow">窗边手记 / 06</span><p>街道还亮着。<br />雨把灯光慢慢拉长。</p></div>
          <div class="rain-controls__right">
            <div class="rain-intensity">
              <label for="rain-intensity">雨势 <strong>{{ rainIntensity < 0.7 ? '细雨' : rainIntensity > 1.3 ? '大雨' : '中雨' }}</strong></label>
              <input id="rain-intensity" v-model.number="rainIntensity" type="range" min="0.35" max="1.7" step="0.05" />
            </div>
            <div class="toolbar-actions">
              <button class="toolbar-button toolbar-button--outline" type="button" @click="rainPaused = !rainPaused">{{ rainPaused ? '继续下雨' : '暂停雨滴' }}</button>
              <button class="toolbar-button toolbar-button--outline" type="button" @click="rainStage?.reset()">重新凝结</button>
              <button class="toolbar-button toolbar-button--outline" type="button" @click="rainStage?.lightning()">一瞬闪电</button>
              <button class="toolbar-button toolbar-button--primary rain-wipe" type="button" @click="rainStage?.wipeCenter()">擦亮玻璃 <span aria-hidden="true">↗</span></button>
            </div>
          </div>
        </div>
      </section>

      <div class="demo-footnote">
        <span>按住鼠标或手指在窗上划动，可以擦出清晰的夜景；痕迹会慢慢重新被雨覆盖。</span>
        <span>雨滴与水痕实时生成，窗外夜景使用本项目中的图片素材。</span>
      </div>
    </main>

    <main v-else-if="currentPage === 'earth'" class="demo-page earth-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 07 / 地球与扫描</span>
      </div>

      <div class="demo-heading earth-heading">
        <div>
          <p class="eyebrow">PLANET UNDER OBSERVATION</p>
          <h1>扫描中的<br /><em>全息地球</em></h1>
        </div>
        <p>卫星影像铺满球面，云层在上方缓缓漂移，扫描光掠过海洋与陆地。拖动地球换个角度，轻点球面留下定位波纹。</p>
      </div>

      <section class="earth-workspace" aria-label="扫描中的全息地球交互示例">
        <HolographicEarthStage ref="earthStage" :speed="earthSpeed" :paused="earthPaused" />
        <div class="earth-controls">
          <div class="earth-controls__intro"><span>观测记录 / 07</span><p>在昼夜交界处，<br />重新看见这颗星球。</p></div>
          <div class="earth-controls__right">
            <div class="earth-speed">
              <label for="earth-speed">扫描速度 <strong>{{ earthSpeed.toFixed(1) }}×</strong></label>
              <input id="earth-speed" v-model.number="earthSpeed" type="range" min="0.35" max="2" step="0.05" />
            </div>
            <div class="toolbar-actions">
              <button class="toolbar-button toolbar-button--outline" type="button" @click="earthPaused = !earthPaused">{{ earthPaused ? '继续扫描' : '暂停扫描' }}</button>
              <button class="toolbar-button toolbar-button--outline" type="button" @click="earthStage?.resetView()">重置视角</button>
              <button class="toolbar-button toolbar-button--primary earth-ping" type="button" @click="earthStage?.ping()">发起定位波纹 <span aria-hidden="true">↗</span></button>
            </div>
          </div>
        </div>
      </section>

      <div class="demo-footnote">
        <span>地表、夜光与云层影像来自 NASA；陆地掩膜使用 Natural Earth 数据。扫描与交互由 Three.js 实时绘制。</span>
        <span>拖动或触摸旋转，滚轮或双指缩放；点击球面可读取经纬度。</span>
      </div>
    </main>

    <main v-else-if="currentPage === 'tunnel'" class="demo-page tunnel-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 08 / 光与速度</span>
      </div>

      <div class="demo-heading tunnel-heading">
        <div>
          <p class="eyebrow">NO END IN SIGHT</p>
          <h1>无限延伸的<br /><em>霓虹隧道</em></h1>
        </div>
        <p>灯框从远处一层层迎面而来，路始终没有尽头。移动指针稍稍改变方向，轻点画面，让一道能量脉冲冲向前方。</p>
      </div>

      <section class="tunnel-workspace" aria-label="无限延伸的霓虹隧道交互示例">
        <NeonTunnelStage ref="tunnelStage" :speed="tunnelSpeed" :paused="tunnelPaused" :palette="tunnelPalette" />
        <div class="tunnel-controls">
          <div class="tunnel-controls__intro"><span>夜行记录 / 08</span><p>每经过一道光，<br />远处又出现一道。</p></div>
          <div class="tunnel-controls__right">
            <div class="tunnel-palettes" role="group" aria-label="隧道配色">
              <span>灯光色谱</span>
              <div>
                <button type="button" :aria-pressed="tunnelPalette === 'afterglow'" :class="{ active: tunnelPalette === 'afterglow' }" @click="tunnelPalette = 'afterglow'"><i class="palette-dot palette-dot--afterglow"></i>余辉</button>
                <button type="button" :aria-pressed="tunnelPalette === 'ultraviolet'" :class="{ active: tunnelPalette === 'ultraviolet' }" @click="tunnelPalette = 'ultraviolet'"><i class="palette-dot palette-dot--ultraviolet"></i>极光</button>
                <button type="button" :aria-pressed="tunnelPalette === 'ember'" :class="{ active: tunnelPalette === 'ember' }" @click="tunnelPalette = 'ember'"><i class="palette-dot palette-dot--ember"></i>熔光</button>
              </div>
            </div>
            <div class="tunnel-speed">
              <label for="tunnel-speed">前进速度 <strong>{{ tunnelSpeed.toFixed(1) }}×</strong></label>
              <input id="tunnel-speed" v-model.number="tunnelSpeed" type="range" min="0.4" max="2.5" step="0.1" />
            </div>
            <div class="toolbar-actions">
              <button class="toolbar-button toolbar-button--outline" type="button" @click="tunnelPaused = !tunnelPaused">{{ tunnelPaused ? '继续前进' : '暂停前进' }}</button>
              <button class="toolbar-button toolbar-button--outline" type="button" @click="resetTunnel">回到起点</button>
              <button class="toolbar-button toolbar-button--primary tunnel-pulse" type="button" @click="tunnelStage?.pulse()">发射能量脉冲 <span aria-hidden="true">↗</span></button>
            </div>
          </div>
        </div>
      </section>

      <div class="demo-footnote">
        <span>灯框与粒子在 Three.js 中循环运动；到达镜头前的灯框会从远处再次出现。</span>
        <span>移动鼠标或手指可改变视角，点击画面触发脉冲；速度、暂停和配色可在下方调整。</span>
      </div>
    </main>

    <main v-else-if="currentPage === 'season'" class="demo-page season-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 09 / 裂纹与换季</span>
      </div>

      <div class="demo-heading season-heading">
        <div>
          <p class="eyebrow">THE OTHER SIDE OF WINTER</p>
          <h1>敲开玻璃，<br /><em>看见春天。</em></h1>
        </div>
        <p>同一座桥，同一间湖边小亭。轻点冬景中的任意位置，让裂纹沿玻璃蔓延；碎片散开，暖色的春天从背后显露。</p>
      </div>

      <section class="season-workspace" aria-label="玻璃裂开后切换季节的交互示例">
        <SeasonGlassStage ref="seasonStage" />
        <div class="season-controls">
          <div class="season-controls__intro"><span>时序标本 / 09</span><p>隔着一层玻璃，<br />是另一个季节。</p></div>
          <div class="season-controls__instruction"><span>01 · 选一个落点</span><span>02 · 看裂纹扩散</span><span>03 · 让春天出现</span></div>
          <div class="toolbar-actions">
            <button class="toolbar-button toolbar-button--outline" type="button" @click="seasonStage?.reset()">复原玻璃</button>
            <button class="toolbar-button toolbar-button--primary season-break" type="button" @click="seasonStage?.breakCenter()">敲开春天 <span aria-hidden="true">↗</span></button>
          </div>
        </div>
      </section>

      <div class="demo-footnote">
        <span>两张季节图使用相同构图；裂纹分区、碎片运动与画面合成由 Three.js 实时完成。</span>
        <span>点击画面的不同位置会改变裂纹中心；可复原玻璃后再次尝试。系统开启减少动态效果时将直接切换。</span>
      </div>
    </main>

    <main v-else-if="currentPage === 'city'" class="demo-page city-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 10 / 照片与微缩城市</span>
      </div>

      <div class="demo-heading city-heading">
        <div>
          <p class="eyebrow">A CITY RISING FROM A PHOTOGRAPH</p>
          <h1>一张城市照片，<br /><em>慢慢立成街道。</em></h1>
        </div>
        <p>先看见屋顶，再看见街道的高度。沿着照片里的十字路口，楼房、树和小车缓缓长出纸面，最后留下一座可以轻轻环视的微缩城市。</p>
      </div>

      <section class="city-workspace" aria-label="城市照片立成微缩街道的交互示例">
        <MiniatureCityStage ref="cityStage" @progress="cityProgress = $event" />
        <div class="city-controls">
          <div class="city-controls__intro"><span>城市标本 / 10</span><p>把俯拍的平面，<br />折成一座小城。</p></div>
          <label class="city-controls__scrub"><span>立体进度 <b>{{ cityProgress }}%</b></span><input type="range" min="0" max="100" step="1" :value="cityProgress" aria-label="调整城市从照片变成立体模型的进度" @input="cityStage?.setProgress(Number(($event.target as HTMLInputElement).value))" /><small>照片</small><small>微缩城市</small></label>
          <div class="toolbar-actions">
            <button class="toolbar-button toolbar-button--outline" type="button" @click="cityStage?.resetView()">回到正面</button>
            <button class="toolbar-button toolbar-button--primary city-replay" type="button" @click="cityStage?.replay()">重新放映 <span aria-hidden="true">↗</span></button>
          </div>
        </div>
      </section>

      <div class="demo-footnote">
        <span>屋顶纹理取自底图对应位置，建筑立起时仍能认出原来那张照片；立面、树和车辆由 Three.js 实时生成。</span>
        <span>自动播放约 4.7 秒；可拖动进度条查看过程，完成后在画面上拖动视角。系统开启减少动态效果时直接显示完成态。</span>
      </div>
    </main>

    <main v-else-if="currentPage === 'depth'" class="demo-page depth-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 11 / 照片的空间层次</span>
      </div>

      <div class="demo-heading depth-heading">
        <div>
          <p class="eyebrow">A PHOTOGRAPH WITH REAL DEPTH</p>
          <h1>一张照片，<br /><em>真的有了前后层次。</em></h1>
        </div>
        <p>原本贴在同一平面的花蕊、花瓣与叶片，被放进不同的空间位置。也可以上传自己的照片，圈出前景，再亲手决定它的空间层次。</p>
      </div>

      <section class="depth-workspace" aria-label="照片分层与景深的交互示例">
        <div class="depth-sourcebar">
          <div><span>照片来源</span><strong>{{ depthMode === 'default' ? '内置花卉素材' : '我的照片' }}</strong><small>仅在当前浏览器中处理</small></div>
          <div class="depth-sourcebar__actions">
            <button type="button" class="toolbar-button toolbar-button--primary depth-upload" @click="depthStage?.openUpload()">上传自己的照片 <span aria-hidden="true">↗</span></button>
            <button v-if="depthMode === 'custom'" type="button" class="toolbar-button toolbar-button--outline" @click="depthStage?.editCustom()">重新圈选</button>
            <button v-if="depthMode === 'custom'" type="button" class="toolbar-button toolbar-button--outline" @click="depthStage?.restoreDefault()">恢复示例</button>
          </div>
        </div>
        <PhotoDepthStage ref="depthStage" @focus-change="depthFocus = $event" @mode-change="onDepthModeChange" @editing-change="depthEditing = $event" />
        <div class="depth-controls">
          <div class="depth-controls__intro"><span>空间标本 / 11</span><p>{{ depthEditing ? '先圈出前景，生成后就能拖动视角。' : depthMode === 'custom' ? '你圈出的主体，已经来到照片前方。' : '从一张平面照片，走进层与层之间。' }}</p></div>
          <fieldset v-if="!depthEditing" class="depth-controls__focus">
            <legend>选择焦点</legend>
            <button v-for="item in depthFocusOptions" :key="item[0]" type="button" :class="{ 'is-active': depthFocus === item[0] }" :aria-pressed="depthFocus === item[0]" @click="depthStage?.setFocus(item[0])">{{ item[1] }}</button>
          </fieldset>
          <label v-if="!depthEditing" class="depth-controls__strength"><span>视差强度 <b>{{ depthStrength.toFixed(1) }}×</b></span><input v-model.number="depthStrength" type="range" min="0.2" max="2" step="0.1" aria-label="调整照片视差强度" @input="depthStage?.setStrength(depthStrength)" /></label>
          <div v-if="!depthEditing" class="depth-controls__actions">
            <button class="toolbar-button toolbar-button--outline" type="button" @click="resetDepth">复位视角</button>
            <button class="toolbar-button toolbar-button--primary depth-explode" type="button" :aria-pressed="depthExploded" @click="toggleDepthLayers">{{ depthExploded ? '合上照片' : '拆开看看' }} <span aria-hidden="true">↗</span></button>
          </div>
        </div>
      </section>

      <div class="demo-footnote">
        <span>{{ depthMode === 'default' ? '内置示例从同一张照片提取四个内容层，放置在不同 Z 轴位置。' : '自选照片由你圈定前景与可选的中景；各层在 Three.js 中占据不同空间位置。' }}</span>
        <span>照片仅在浏览器中读取和处理。拖动观察视差，点按切换焦点；“拆开看看”会展开实际图层。</span>
      </div>
    </main>

    <main v-else-if="currentPage === 'population'" class="demo-page population-page">
      <div class="demo-topline">
        <a class="back-link" href="#/">← 返回目录</a>
        <span>实验 12 / 数据与叙事</span>
      </div>

      <div class="demo-heading population-heading">
        <div>
          <p class="eyebrow">WHERE A GENERATION MEETS THE TIDE</p>
          <h1>输入出生年份，<br /><em>看你这一代人穿过人口潮。</em></h1>
        </div>
        <p>人口从来不是一串静止的数字。选一个出生年份，看对应年龄的人群怎样穿过半个多世纪的起伏。</p>
      </div>

      <PopulationTideStage />

      <div class="demo-footnote population-footnote">
        <span>数据来自联合国《世界人口展望 2024》：1950—2023 年为估计，2024—2026 年为中方案预测。人数是各年 7 月 1 日的单岁人口，按千人取整。</span>
        <span>画面沿“出生年份 + 年龄”读取每年的人口估计，并非逐人追踪的真实出生队列。地区人口变化也包含迁移等因素。<a href="https://population.un.org/wpp/" target="_blank" rel="noopener noreferrer">查看数据来源 ↗</a></span>
      </div>
    </main>

    <main v-else-if="currentPage === 'airplane'" class="demo-page airplane-page">
      <div class="demo-topline"><a class="back-link" href="#/">← 返回目录</a><span>实验 13 / 照片与折纸</span></div>
      <div class="demo-heading airplane-heading">
        <div><p class="eyebrow">A LITTLE FOLD. A LONG WAY.</p><h1>把这一张照片，<br /><em>折成下一阵风。</em></h1></div>
        <p>照片沿着折痕收起，露出纸背，展开双翼。折好后，按住向后拉，再松手。照片里的那一刻，也跟着飞远一点。</p>
      </div>
      <PhotoAirplaneStage />
      <div class="demo-footnote"><span>可以换上自己的照片。纸张的正反面、折痕与投影，由 Three.js 实时绘制。</span><span>照片仅在当前浏览器中处理。支持鼠标拖动和触屏操作。</span></div>
    </main>

    <main v-else-if="currentPage === 'flowers'" class="demo-page flower-page">
      <div class="demo-topline"><a class="back-link" href="#/">← 返回目录</a><span>实验 14 / 沿途生花</span></div>
      <div class="demo-heading flower-heading">
        <div><p class="eyebrow">LEAVE A LITTLE SPRING BEHIND.</p><h1>鼠标经过，<br /><em>荒地上长出一条花路。</em></h1></div>
        <p>不用按下鼠标，也不用画得工整。轻轻经过，花茎就会从土里长出来，花瓣依次展开。你离开以后，春天还留在这里。</p>
      </div>
      <FlowerTrailStage />
      <div class="demo-footnote"><span>试着画一条弯弯的小径，或用两种花色拼出自己的花园。手机上按住画面划动。</span><span>花会留在原地，清空后可以重新开始。也可以用“在中央种一簇花”按钮操作。</span></div>
    </main>

    <footer class="site-footer">
      <span>视觉实验室</span>
      <span>用代码，让画面动起来。</span>
    </footer>
  </div>
</template>

<style>
.flower-page .eyebrow, .flower-page .demo-heading h1 em { color: #b7c695; }
.flower-page .flower-heading h1 { font-size: clamp(35px, 4.1vw, 66px); }
@media(max-width: 600px) { .flower-page .flower-heading h1 { font-size: clamp(31px, 7.7vw, 46px); } }
</style>
