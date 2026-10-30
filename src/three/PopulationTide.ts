import * as THREE from 'three'

export type PopulationLocation = 'world' | 'china' | 'india' | 'japan' | 'usa'

export type PopulationDataset = {
  firstYear: number
  lastYear: number
  lastEstimateYear: number
  locations: Record<PopulationLocation, {
    label: string
    /** 按 [年份 − firstYear][年龄] 索引，单位为千人；年龄 100 对应 100 岁及以上。 */
    populationThousands: number[][]
  }>
}

const YEARS_X = 10.7
const AGES_Z = 5.4
const FIRST_AGE = 0
const LAST_AGE = 100
const INK = new THREE.Color('#10242d')
const CREST = new THREE.Color('#5db8b0')

function makeGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(64, 64, 1, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,235,190,1)')
  gradient.addColorStop(.12, 'rgba(255,185,105,.88)')
  gradient.addColorStop(.38, 'rgba(255,127,65,.27)')
  gradient.addColorStop(1, 'rgba(255,127,65,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(canvas)
}

/** 将年份、年龄与人口数量映射为三维地形，并沿“年份 − 出生年份 = 年龄”读取同龄人口轨迹。 */
export class PopulationTide {
  private host: HTMLElement
  private dataset: PopulationDataset
  private onYear: (year: number, isPlaying: boolean) => void
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(39, 1, .1, 100)
  private renderer: THREE.WebGLRenderer
  private root = new THREE.Group()
  private surface?: THREE.Mesh
  private grid = new THREE.Group()
  private cohort = new THREE.Group()
  private activePath?: THREE.Mesh
  private lastPathMark = -1
  private peakValue = 1
  private pulse: THREE.Mesh
  private glow: THREE.Sprite
  private scanPlane: THREE.Mesh
  private scanEdge: THREE.Line
  private location: PopulationLocation = 'china'
  private birthYear = 1990
  private year = 1990
  private playing = false
  private lastFrame = 0
  private lastReportedYear = -1
  private raf = 0
  private resizeObserver: ResizeObserver
  private startX = 0
  private startY = 0
  private dragging = false
  private yaw = 0
  private pitch = 0
  private targetYaw = 0
  private targetPitch = 0
  private disposed = false

  constructor(host: HTMLElement, dataset: PopulationDataset, onYear: (year: number, isPlaying: boolean) => void) {
    this.host = host
    this.dataset = dataset
    this.onYear = onYear
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x09121a, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(this.renderer.domElement)

    this.camera.position.set(0, 6.6, 9.7)
    this.camera.lookAt(0, .5, 0)
    this.scene.add(this.root)

    const planeGeometry = new THREE.PlaneGeometry(AGES_Z, 2.85)
    const planeMaterial = new THREE.MeshBasicMaterial({ color: 0xf5b878, transparent: true, opacity: .075, side: THREE.DoubleSide, depthWrite: false })
    this.scanPlane = new THREE.Mesh(planeGeometry, planeMaterial)
    this.scanPlane.rotation.y = Math.PI / 2
    this.scanPlane.position.y = 1.15
    this.scanPlane.renderOrder = 3
    this.root.add(this.scanPlane)

    const edgeGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -.08, -AGES_Z / 2),
      new THREE.Vector3(0, -.08, AGES_Z / 2),
    ])
    this.scanEdge = new THREE.Line(edgeGeometry, new THREE.LineBasicMaterial({ color: 0xe9a66e, transparent: true, opacity: .75, depthTest: false }))
    this.scanEdge.renderOrder = 5
    this.root.add(this.scanEdge)

    this.pulse = new THREE.Mesh(new THREE.SphereGeometry(.065, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffedd4, depthTest: false }))
    this.pulse.renderOrder = 9
    this.root.add(this.pulse)
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xffbd80, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }))
    this.glow.scale.set(.83, .83, 1)
    this.glow.renderOrder = 8
    this.root.add(this.glow)
    this.root.add(this.grid, this.cohort)

    this.rebuild()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.resize()
    this.raf = requestAnimationFrame(this.animate)
  }

  private xForYear(year: number) {
    return -YEARS_X / 2 + (year - this.dataset.firstYear) / (this.dataset.lastYear - this.dataset.firstYear) * YEARS_X
  }

  private zForAge(age: number) {
    return AGES_Z / 2 - age / LAST_AGE * AGES_Z
  }

  private get rows() {
    return this.dataset.locations[this.location].populationThousands
  }

  private computePeak() {
    let max = 1
    for (const row of this.rows) for (const value of row) max = Math.max(max, value)
    return max
  }

  // 局部 X 为年份递增，Z 为年龄递减，Y 为人口高度；0.76 次幂是强化低值起伏的视觉映射。
  // 高度按当前地区峰值归一化，因此不同地区的山峰高度不能直接比较绝对人口。
  private point(year: number, age: number, peak: number, lift = 0) {
    const row = this.rows[Math.round(year) - this.dataset.firstYear]
    const value = row[Math.min(LAST_AGE, Math.max(FIRST_AGE, Math.round(age)))]
    const height = Math.pow(value / peak, .76) * 2.35
    return new THREE.Vector3(this.xForYear(year), height + lift, this.zForAge(age))
  }

  private disposeGroup(group: THREE.Group) {
    for (const object of [...group.children]) {
      group.remove(object)
      if (object instanceof THREE.Line || object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) material.dispose()
      }
    }
  }

  private rebuild() {
    if (this.surface) {
      this.root.remove(this.surface)
      this.surface.geometry.dispose()
      ;(this.surface.material as THREE.Material).dispose()
    }
    this.disposeGroup(this.grid)
    this.disposeGroup(this.cohort)
    this.activePath = undefined
    this.lastPathMark = -1

    const peak = this.peakValue = this.computePeak()
    const yearCount = this.dataset.lastYear - this.dataset.firstYear + 1
    const ageCount = LAST_AGE + 1
    const positions = new Float32Array(yearCount * ageCount * 3)
    const colors = new Float32Array(positions.length)
    const indices: number[] = []
    for (let yi = 0; yi < yearCount; yi++) {
      const year = this.dataset.firstYear + yi
      for (let age = 0; age < ageCount; age++) {
        const point = this.point(year, age, peak)
        const index = yi * ageCount + age
        positions[index * 3] = point.x
        positions[index * 3 + 1] = point.y
        positions[index * 3 + 2] = point.z
        const tint = INK.clone().lerp(CREST, Math.pow(point.y / 2.35, 1.65) * .88 + .08)
        colors[index * 3] = tint.r
        colors[index * 3 + 1] = tint.g
        colors[index * 3 + 2] = tint.b
        if (yi < yearCount - 1 && age < ageCount - 1) {
          const next = index + ageCount
          indices.push(index, index + 1, next, next, index + 1, next + 1)
        }
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    this.surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .94, side: THREE.DoubleSide, depthWrite: true }))
    this.root.add(this.surface)

    const makeLine = (points: THREE.Vector3[], color: number, opacity: number) => {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
      this.grid.add(line)
    }
    for (let age = 0; age <= LAST_AGE; age += 10) {
      const points: THREE.Vector3[] = []
      for (let year = this.dataset.firstYear; year <= this.dataset.lastYear; year++) points.push(this.point(year, age, peak, .014))
      makeLine(points, age % 20 === 0 ? 0x9bd2c8 : 0x5a9698, age % 20 === 0 ? .37 : .18)
    }
    for (let year = 1950; year <= 2026; year += 5) {
      const points: THREE.Vector3[] = []
      for (let age = 0; age <= LAST_AGE; age++) points.push(this.point(year, age, peak, .016))
      makeLine(points, year % 10 === 0 ? 0x8cc2bb : 0x54878a, year % 10 === 0 ? .27 : .12)
    }
    // 地形较低时仍保留基准网格，以便辨认年份与年龄两个维度。
    for (const age of [0, 20, 40, 60, 80, 100]) {
      makeLine([
        new THREE.Vector3(-YEARS_X / 2, -.035, this.zForAge(age)),
        new THREE.Vector3(YEARS_X / 2, -.035, this.zForAge(age)),
      ], 0x688c91, .3)
    }
    for (const year of [1950, 1970, 1990, 2010, 2026]) {
      makeLine([
        new THREE.Vector3(this.xForYear(year), -.035, -AGES_Z / 2),
        new THREE.Vector3(this.xForYear(year), -.035, AGES_Z / 2),
      ], 0x688c91, .3)
    }

    const path: THREE.Vector3[] = []
    for (let year = this.birthYear; year <= this.dataset.lastYear; year++) path.push(this.point(year, year - this.birthYear, peak, .105))
    if (path.length > 1) {
      const faint = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), Math.max(20, path.length * 3), .018, 5, false), new THREE.MeshBasicMaterial({ color: 0xffc68b, transparent: true, opacity: .35, depthTest: false, depthWrite: false }))
      faint.renderOrder = 6
      this.cohort.add(faint)
    }
    this.updateYearVisual()
  }

  // 沿 year - birthYear 读取各年的同龄人口，再在相邻年间插值；并非对同一批个体的连续追踪。
  private cohortPointAt(year: number) {
    const peak = this.peakValue
    const lower = Math.floor(year)
    const upper = Math.min(this.dataset.lastYear, lower + 1)
    const a = this.point(lower, lower - this.birthYear, peak, .13)
    if (lower === upper) return a
    const b = this.point(upper, upper - this.birthYear, peak, .13)
    return a.lerp(b, year - lower)
  }

  private updateYearVisual() {
    const x = this.xForYear(this.year)
    this.scanPlane.position.x = x
    this.scanEdge.position.x = x
    const at = this.cohortPointAt(this.year)
    this.pulse.position.copy(at)
    this.glow.position.copy(at)
    // 每跨半个数据年份才重建轨迹管道，减少连续播放时的几何分配；光点仍逐帧移动。
    const pathMark = Math.floor(this.year * 2)
    if (pathMark === this.lastPathMark) return
    this.lastPathMark = pathMark
    if (this.activePath) {
      this.cohort.remove(this.activePath)
      this.activePath.geometry.dispose()
      ;(this.activePath.material as THREE.Material).dispose()
      this.activePath = undefined
    }
    if (this.year > this.birthYear + .5) {
      const points: THREE.Vector3[] = []
      for (let year = this.birthYear; year <= Math.floor(this.year); year++) points.push(this.cohortPointAt(year))
      if (this.year % 1 > .01) points.push(at.clone())
      if (points.length > 1) {
        this.activePath = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(12, points.length * 3), .033, 6, false), new THREE.MeshBasicMaterial({ color: 0xffc48a, depthTest: false, depthWrite: false }))
        this.activePath.renderOrder = 7
        this.cohort.add(this.activePath)
      }
    }
  }

  private report(force = false) {
    const rounded = Math.min(this.dataset.lastYear, Math.max(this.birthYear, Math.round(this.year)))
    if (!force && rounded === this.lastReportedYear) return
    this.lastReportedYear = rounded
    this.onYear(rounded, this.playing)
  }

  private animate = (now: number) => {
    if (this.disposed) return
    const dt = Math.min((now - (this.lastFrame || now)) / 1000, .06)
    this.lastFrame = now
    if (this.playing) {
      const span = Math.max(1, this.dataset.lastYear - this.birthYear)
      this.year = Math.min(this.dataset.lastYear, this.year + dt * span / 9.5)
      const ended = this.year >= this.dataset.lastYear
      if (ended) this.playing = false
      this.updateYearVisual()
      this.report(ended)
    }
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 5)
    this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 5)
    this.root.rotation.y = this.yaw
    this.root.rotation.x = this.pitch
    const breath = 1 + Math.sin(now * .004) * .1
    this.glow.scale.set(.83 * breath, .83 * breath, 1)
    this.renderer.render(this.scene, this.camera)
    this.raf = requestAnimationFrame(this.animate)
  }

  setLocation(value: PopulationLocation) {
    if (value === this.location) return
    this.location = value
    this.rebuild()
  }

  setBirthYear(value: number) {
    this.birthYear = Math.min(this.dataset.lastYear, Math.max(this.dataset.firstYear, Math.round(value)))
    this.year = this.birthYear
    this.playing = this.birthYear < this.dataset.lastYear
    this.lastReportedYear = -1
    this.rebuild()
    this.report(true)
  }

  play() {
    if (this.year >= this.dataset.lastYear) this.seek(this.birthYear)
    this.playing = this.year < this.dataset.lastYear
    this.report(true)
  }

  pause() {
    this.playing = false
    this.report(true)
  }

  seek(year: number) {
    this.year = Math.min(this.dataset.lastYear, Math.max(this.birthYear, Math.round(year)))
    this.playing = false
    this.updateYearVisual()
    this.lastReportedYear = -1
    this.report()
  }

  resetView() {
    this.targetYaw = 0
    this.targetPitch = 0
  }

  pointerDown(x: number, y: number) {
    this.dragging = true
    this.startX = x
    this.startY = y
  }

  pointerMove(x: number, y: number) {
    if (!this.dragging) return
    this.targetYaw = THREE.MathUtils.clamp(this.targetYaw + (x - this.startX) * .003, -.55, .55)
    this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + (y - this.startY) * .0025, -.22, .22)
    this.startX = x
    this.startY = y
  }

  pointerUp() { this.dragging = false }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    const portrait = width < 650
    this.camera.aspect = width / height
    this.camera.fov = portrait ? 52 : 39
    // 竖屏时旋转地形，让年份方向沿屏幕纵向展开。
    this.camera.up.set(portrait ? 1 : 0, portrait ? 0 : 1, 0)
    this.camera.position.set(0, portrait ? 10 : 8.5, portrait ? 10 : 8.5)
    this.camera.lookAt(0, .5, 0)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.disposeGroup(this.grid)
    this.disposeGroup(this.cohort)
    if (this.surface) {
      this.surface.geometry.dispose()
      ;(this.surface.material as THREE.Material).dispose()
    }
    this.scanPlane.geometry.dispose()
    ;(this.scanPlane.material as THREE.Material).dispose()
    this.scanEdge.geometry.dispose()
    ;(this.scanEdge.material as THREE.Material).dispose()
    this.pulse.geometry.dispose()
    ;(this.pulse.material as THREE.Material).dispose()
    ;(this.glow.material as THREE.SpriteMaterial).map?.dispose()
    this.glow.material.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
