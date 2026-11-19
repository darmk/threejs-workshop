import * as THREE from 'three'
import type { HeatCity } from '../data/heatWall'

const YEARS = 40
const WALL_WIDTH = 18.4
const WALL_HEIGHT = 8.45
const CELL_X = WALL_WIDTH / YEARS
const CELL_Y = WALL_HEIGHT / 92

type Selection = { year: number; day: number; temperature: number }

/** 将 40 个夏天排成局部坐标中的 X 年份、Y 夏季日序、Z 温度凸起；输入值为摄氏度。 */
export class HeatWall {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(38, 1, .1, 100)
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  private readonly root = new THREE.Group()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly observer: ResizeObserver
  private readonly geometry = new THREE.BoxGeometry(CELL_X * .82, CELL_Y * .69, 1)
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: .6, metalness: .12, emissive: 0x301108, emissiveIntensity: .16 })
  private readonly mutedMaterial = new THREE.MeshStandardMaterial({ roughness: .8, metalness: .05, transparent: true, opacity: .13, depthWrite: false, color: 0x7d7781 })
  private readonly columns: THREE.InstancedMesh[] = []
  private readonly columnHeights: number[] = []
  private readonly guides: THREE.Object3D[] = []
  private hotMesh: THREE.InstancedMesh | undefined
  private readonly hotGeometry = new THREE.BoxGeometry(CELL_X * .9, CELL_Y * .82, .045)
  private readonly hotMaterial = new THREE.MeshBasicMaterial({ color: 0xffc177, transparent: true, opacity: .72, depthWrite: false, blending: THREE.AdditiveBlending })
  private readonly selection: THREE.Mesh
  private readonly dayCursor: THREE.Mesh
  private frame = 0
  private lastTime = 0
  private elapsed = 0
  private selectedYear = 2025
  private focused = false
  private city: HeatCity | null = null
  private disposed = false
  private dragging = false
  private previousX = 0
  private tilt = -.19
  private targetTilt = -.19
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(private readonly host: HTMLElement, private readonly onSelect: (value: Selection) => void, private readonly onHover: (value: Selection | null) => void) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x080b12, 0)
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    host.appendChild(this.renderer.domElement)
    this.camera.position.set(0, .2, 19)
    this.camera.lookAt(0, 0, 0)
    this.scene.add(new THREE.AmbientLight(0xffe2c8, 1.65))
    const key = new THREE.DirectionalLight(0xffad72, 2.8)
    key.position.set(-4, 7, 10)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0xff5439, 1.4)
    rim.position.set(6, -2, -5)
    this.scene.add(rim)
    this.scene.add(this.root)
    this.root.rotation.y = this.tilt
    this.root.rotation.x = -.065

    const frame = new THREE.BoxGeometry(CELL_X * 1.1, WALL_HEIGHT + .2, .025)
    const frameMaterial = new THREE.MeshBasicMaterial({ color: 0xffd09a, transparent: true, opacity: .18, side: THREE.DoubleSide, depthWrite: false })
    this.selection = new THREE.Mesh(frame, frameMaterial)
    this.selection.position.z = -.16
    this.root.add(this.selection)
    this.dayCursor = new THREE.Mesh(new THREE.BoxGeometry(CELL_X * .92, CELL_Y * .84, .035), new THREE.MeshBasicMaterial({ color: 0xffedc6, transparent: true, opacity: .9, depthTest: false, depthWrite: false }))
    this.dayCursor.visible = false
    this.dayCursor.renderOrder = 8
    this.root.add(this.dayCursor)
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
    this.frame = requestAnimationFrame(this.animate)
  }

  private resize() {
    const width = this.host.clientWidth
    const height = this.host.clientHeight
    if (width <= 0 || height <= 0) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    const narrow = width < 680
    this.camera.fov = narrow ? 44 : 38
    this.camera.position.z = narrow ? 25 : 19
    this.camera.updateProjectionMatrix()
    this.root.rotation.z = narrow ? -Math.PI / 2 : 0
    this.root.scale.setScalar(1)
  }

  private clear() {
    for (const column of this.columns) this.root.remove(column)
    this.columns.length = 0
    this.columnHeights.length = 0
    if (this.hotMesh) { this.root.remove(this.hotMesh); this.hotMesh = undefined }
    for (const guide of this.guides) {
      this.root.remove(guide)
      if (guide instanceof THREE.Line) {
        guide.geometry.dispose()
        ;(guide.material as THREE.Material).dispose()
      }
    }
    this.guides.length = 0
  }

  /** 固定色标让城市间可比较；32°C 以上加大色差，使高温日能从墙上跳出来。 */
  private colorFor(value: number) {
    const marks = [22, 28, 32, 35, 39]
    const stops = [new THREE.Color('#294b65'), new THREE.Color('#6c7890'), new THREE.Color('#dfa45f'), new THREE.Color('#ed603c'), new THREE.Color('#ffe098')]
    const upper = marks.findIndex(mark => value <= mark)
    if (upper <= 0) return stops[0]
    if (upper < 0) return stops[stops.length - 1]
    const ratio = THREE.MathUtils.clamp((value - marks[upper - 1]) / (marks[upper] - marks[upper - 1]), 0, 1)
    return stops[upper - 1].lerp(stops[upper], ratio)
  }

  setCity(city: HeatCity) {
    if (this.disposed) return
    this.clear()
    this.city = city
    this.focused = false
    this.dayCursor.visible = false
    this.elapsed = this.reducedMotion ? 100 : 0
    const matrix = new THREE.Matrix4()
    const color = new THREE.Color()
    const hotCells: Array<{ x: number; y: number; z: number; scaleY: number }> = []
    for (let yi = 0; yi < YEARS; yi++) {
      const summer = city.summers[yi]
      // 固定映射：0–92 个高温日对应 2.6–8.3 个局部单位，跨城市仍可读同一高度含义。
      const columnHeight = 2.6 + 5.7 * Math.sqrt(summer.hotDays / 92)
      this.columnHeights.push(columnHeight)
      const dayHeight = columnHeight / summer.days.length
      const column = new THREE.InstancedMesh(this.geometry, this.material, summer.days.length)
      column.userData.year = summer.year
      column.position.y = -WALL_HEIGHT / 2
      for (let di = 0; di < summer.days.length; di++) {
        const value = summer.days[di]
        const depth = .08 + Math.max(0, value - 22) / 20 * 1.55
        const x = -WALL_WIDTH / 2 + (yi + .5) * CELL_X
        const y = (di + .5) * dayHeight
        matrix.makeScale(1, dayHeight / CELL_Y, depth)
        matrix.setPosition(0, y, depth / 2)
        column.setMatrixAt(di, matrix)
        color.copy(this.colorFor(value))
        column.setColorAt(di, color)
        if (value >= 35) hotCells.push({ x, y: -WALL_HEIGHT / 2 + y, z: depth + .035, scaleY: dayHeight / CELL_Y })
      }
      column.instanceMatrix.needsUpdate = true
      if (column.instanceColor) column.instanceColor.needsUpdate = true
      column.position.x = -WALL_WIDTH / 2 + (yi + .5) * CELL_X
      column.scale.y = this.reducedMotion ? 1 : .001
      this.root.add(column)
      this.columns.push(column)
    }
    this.hotMesh = new THREE.InstancedMesh(this.hotGeometry, this.hotMaterial, hotCells.length)
    for (let i = 0; i < hotCells.length; i++) {
      const cell = hotCells[i]
      matrix.makeScale(1, cell.scaleY, 1)
      matrix.setPosition(cell.x, cell.y, cell.z)
      this.hotMesh.setMatrixAt(i, matrix)
    }
    this.hotMesh.instanceMatrix.needsUpdate = true
    this.hotMesh.renderOrder = 4
    this.hotMesh.visible = this.reducedMotion
    this.root.add(this.hotMesh)
    // 五年刻度放在墙底，避免密集年份标签遮住色块。
    for (let yi = 0; yi <= YEARS; yi += 5) {
      const x = -WALL_WIDTH / 2 + yi * CELL_X
      const points = [new THREE.Vector3(x, -WALL_HEIGHT / 2 - .26, .01), new THREE.Vector3(x, -WALL_HEIGHT / 2 - .06, .01)]
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xd5b9a0, transparent: true, opacity: .62 }))
      this.root.add(line)
      this.guides.push(line)
    }
    this.selectYear(this.selectedYear)
  }

  selectYear(year: number) {
    this.selectedYear = THREE.MathUtils.clamp(Math.round(year), 1986, 2025)
    const index = this.selectedYear - 1986
    const height = this.columnHeights[index] ?? WALL_HEIGHT
    this.selection.position.x = -WALL_WIDTH / 2 + (this.selectedYear - 1986 + .5) * CELL_X
    this.selection.position.y = -WALL_HEIGHT / 2 + height / 2
    this.selection.position.z = this.focused ? 1.34 : .42
    this.selection.scale.x = this.focused ? 2.15 : 1
    this.selection.scale.y = height / WALL_HEIGHT
    for (let i = 0; i < this.columns.length; i++) {
      const active = i === index
      this.columns[i].position.z = active ? (this.focused ? 1.8 : .9) : 0
      this.columns[i].scale.x = active && this.focused ? 2.15 : 1
      this.columns[i].material = this.focused && !active ? this.mutedMaterial : this.material
    }
    if (this.hotMesh) this.hotMesh.visible = !this.focused && (this.reducedMotion || this.elapsed > 1.55)
  }

  setFocused(value: boolean) {
    this.focused = value
    this.dayCursor.visible = false
    this.selectYear(this.selectedYear)
  }

  pointerDown(event: PointerEvent) {
    this.dragging = true
    this.previousX = event.clientX
  }

  pointerMove(event: PointerEvent) {
    if (this.dragging) {
      this.targetTilt = THREE.MathUtils.clamp(this.targetTilt + (event.clientX - this.previousX) * .003, -.43, .32)
      this.previousX = event.clientX
      return
    }
    const hit = this.hitAt(event)
    if (!hit || (this.focused && hit.year !== this.selectedYear)) { this.pointerLeave(); return }
    this.placeDayCursor(hit)
    this.selectYear(hit.year)
    this.onHover(hit)
  }

  pointerUp() { this.dragging = false }

  pointerLeave() {
    if (!this.dayCursor.visible) return
    this.dayCursor.visible = false
    this.onHover(null)
  }

  private hitAt(event: PointerEvent): Selection | null {
    if (!this.city) return null
    const rect = this.host.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1))
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.columns, false)[0]
    if (!hit || hit.instanceId === undefined) return null
    const year = Number(hit.object.userData.year)
    const day = hit.instanceId
    const temperature = this.city.summers[year - 1986]?.days[day]
    if (temperature === undefined) return null
    return { year, day, temperature }
  }

  private placeDayCursor(value: Selection) {
    const depth = .08 + Math.max(0, value.temperature - 22) / 20 * 1.55
    const height = this.columnHeights[value.year - 1986] ?? WALL_HEIGHT
    const dayCount = this.city?.summers[value.year - 1986]?.days.length ?? 92
    this.dayCursor.scale.y = height / dayCount / CELL_Y
    this.dayCursor.scale.x = this.focused ? 2.15 : 1
    this.dayCursor.position.set(-WALL_WIDTH / 2 + (value.year - 1986 + .5) * CELL_X, -WALL_HEIGHT / 2 + (value.day + .5) * height / dayCount, depth + (this.focused ? 1.88 : .98))
    this.dayCursor.visible = true
  }

  pointerClick(event: PointerEvent) {
    const hit = this.hitAt(event)
    if (!hit) return
    this.focused = true
    this.placeDayCursor(hit)
    this.selectYear(hit.year)
    this.onSelect(hit)
  }

  private animate = (time: number) => {
    if (this.disposed) return
    const dt = Math.min((time - (this.lastTime || time)) / 1000, .06)
    this.lastTime = time
    this.elapsed += dt
    if (this.city && !this.reducedMotion && this.elapsed < 2) {
      // 逐列抬起，每列仅缩放已有实例，不在帧循环中重建几何体。
      for (let i = 0; i < this.columns.length; i++) {
        const progress = THREE.MathUtils.clamp((this.elapsed - i * .035) / .55, 0, 1)
        this.columns[i].scale.y = Math.max(.001, 1 - Math.pow(1 - progress, 3))
      }
    }
    if (this.hotMesh && !this.hotMesh.visible && !this.focused && this.elapsed > 1.55) this.hotMesh.visible = true
    this.tilt += (this.targetTilt - this.tilt) * Math.min(1, dt * 5)
    this.root.rotation.y = this.tilt
    this.renderer.render(this.scene, this.camera)
    this.frame = requestAnimationFrame(this.animate)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.clear()
    this.geometry.dispose()
    this.material.dispose()
    this.mutedMaterial.dispose()
    this.hotGeometry.dispose()
    this.hotMaterial.dispose()
    this.selection.geometry.dispose()
    ;(this.selection.material as THREE.Material).dispose()
    this.dayCursor.geometry.dispose()
    ;(this.dayCursor.material as THREE.Material).dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
