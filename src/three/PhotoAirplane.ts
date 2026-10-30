import {
  ACESFilmicToneMapping, BufferAttribute, BufferGeometry, CanvasTexture, Color,
  DirectionalLight, DoubleSide, Fog, FrontSide, BackSide,
  Group, HemisphereLight, Line, LineBasicMaterial, LineSegments, Matrix4, Mesh,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer, PCFSoftShadowMap,
} from 'three'

export type AirplanePhase = 'photo' | 'folding' | 'ready' | 'aiming' | 'flying' | 'away'
export type AirplaneState = { phase: AirplanePhase; progress: number; charge: number }
type Vertex = { p: Vector3; uv: Vector2 }
type Face = { vertices: Vertex[] }
const WIDTH = 4.2, HEIGHT = 5.94, KEEL = 0.19, PAPER_GAP = 0.004
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))
const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }
const clone = (v: Vertex): Vertex => ({ p: v.p.clone(), uv: v.uv.clone() })

// 按折痕的有符号距离裁剪多边形；交点同步插值原图 UV，避免折叠后纹理在切口处断裂。
function clip(face: Face, distance: (p: Vector3) => number, positive: boolean): Face | undefined {
  const result: Vertex[] = []
  const vertices = face.vertices
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length]
    const da = distance(a.p) * (positive ? 1 : -1)
    const db = distance(b.p) * (positive ? 1 : -1)
    if (da >= -1e-7) result.push(clone(a))
    if ((da > 1e-7 && db < -1e-7) || (da < -1e-7 && db > 1e-7)) {
      const t = da / (da - db)
      result.push({ p: a.p.clone().lerp(b.p, t), uv: a.uv.clone().lerp(b.uv, t) })
    }
  }
  return result.length >= 3 ? { vertices: result } : undefined
}

// 折痕为局部空间 a→b 轴，side 决定二维有符号距离的活动侧；angle 使用弧度并遵循右手旋转。
function fold(faces: Face[], a: Vector3, b: Vector3, side: number, angle: number): Face[] {
  if (Math.abs(angle) < 1e-6) return faces
  const axis = b.clone().sub(a).normalize()
  const distance = (p: Vector3) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) * side
  const result: Face[] = []
  for (const face of faces) {
    const fixed = clip(face, distance, false), moving = clip(face, distance, true)
    if (fixed) result.push(fixed)
    if (moving) {
      for (const vertex of moving.vertices) {
        vertex.p.sub(a).applyAxisAngle(axis, angle).add(a)
      }
      result.push(moving)
    }
  }
  return result
}

/**
 * 根据折叠进度生成纸张局部空间中的面片，保留原图 UV；仅沿折痕切分。
 * @param progress 约定为 0～1：0 为平纸，1 为完成折叠；各阶段分别缓动。
 * @returns 新建的面片及顶点；纸张初始位于 XY 平面，UV 左下为 (0, 0)。
 */
export function airplaneFaces(progress: number): Face[] {
  const top = HEIGHT / 2, bottom = -HEIGHT / 2
  let faces: Face[] = [{ vertices: [
    { p: new Vector3(-WIDTH / 2, bottom, 0), uv: new Vector2(0, 0) },
    { p: new Vector3(WIDTH / 2, bottom, 0), uv: new Vector2(1, 0) },
    { p: new Vector3(WIDTH / 2, top, 0), uv: new Vector2(1, 1) },
    { p: new Vector3(-WIDTH / 2, top, 0), uv: new Vector2(0, 1) },
  ] }]
  const corners = ease(progress / 0.31), dart = ease((progress - 0.32) / 0.30)
  // 折痕沿纸张局部 Z 轴抬高，层间距随顶点一起旋转，避免重叠面穿插。
  // 若在折叠开始时直接翻转 Z 层序，底层照片会突然盖过已折好的白色角片。
  const cornerHeight = PAPER_GAP / 2
  const cornerNose = new Vector3(0, top, cornerHeight)
  faces = fold(faces, cornerNose, new Vector3(-WIDTH / 2, top - WIDTH / 2, cornerHeight), -1, -Math.PI * corners)
  faces = fold(faces, cornerNose, new Vector3(WIDTH / 2, top - WIDTH / 2, cornerHeight), 1, Math.PI * corners)
  const dartHeight = PAPER_GAP * 1.5
  const dartNose = new Vector3(0, top, dartHeight)
  faces = fold(faces, dartNose, new Vector3(-WIDTH / 2, bottom, dartHeight), -1, -Math.PI * dart)
  faces = fold(faces, dartNose, new Vector3(WIDTH / 2, bottom, dartHeight), 1, Math.PI * dart)
  const body = ease((progress - 0.64) / 0.17), wings = ease((progress - 0.82) / 0.18)
  if (body > 0) {
    // 先沿三条纵向折痕切分，保证每个面片能按所属区域弯折机身或机翼。
    for (const x of [-KEEL, 0, KEEL]) {
      faces = faces.flatMap(face => [clip(face, p => p.x - x, false), clip(face, p => p.x - x, true)].filter((f): f is Face => Boolean(f)))
    }
    const bodyAngle = body * 1.32
    const wingAngle = bodyAngle * (1 - wings) + 0.065 * wings
    for (const face of faces) {
      const faceSide = Math.sign(face.vertices.reduce((sum, vertex) => sum + vertex.p.x, 0)) || 1
      const meanSpan = face.vertices.reduce((sum, vertex) => sum + Math.abs(vertex.p.x), 0) / face.vertices.length
      const surfaceAngle = meanSpan > KEEL + 1e-7 ? wingAngle : bodyAngle
      for (const vertex of face.vertices) {
        const sign = faceSide, s = Math.abs(vertex.p.x)
        const inner = Math.min(s, KEEL), outer = Math.max(0, s - KEEL)
        const offset = vertex.p.z
        vertex.p.x = sign * (inner * Math.cos(bodyAngle) + outer * Math.cos(wingAngle) - offset * Math.sin(surfaceAngle))
        vertex.p.z = inner * Math.sin(bodyAngle) + outer * Math.sin(wingAngle) + offset * Math.cos(surfaceAngle)
      }
    }
  }
  return faces
}

/** 管理照片纹理、纸张折叠和放飞状态；折叠在纸张局部空间完成，飞行由预设曲线驱动。 */
export class PhotoAirplane {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(33, 1, 0.1, 100)
  private root = new Group()
  private paper = new Group()
  private geometry = new BufferGeometry()
  private edges = new BufferGeometry()
  private positions = new Float32Array(18000)
  private normals = new Float32Array(18000)
  private uvs = new Float32Array(12000)
  private edgePositions = new Float32Array(24000)
  private front = new MeshStandardMaterial({ color: '#fffdf6', roughness: 0.87, side: FrontSide })
  private back = new MeshStandardMaterial({ color: '#f3eee0', roughness: 0.95, side: BackSide })
  private edgeMaterial = new LineBasicMaterial({ color: '#736454', transparent: true, opacity: 0.22 })
  private trailGeometry = new BufferGeometry()
  private trailPositions = new Float32Array(65 * 3)
  private trailMaterial = new LineBasicMaterial({ color: '#9c9b91', transparent: true, opacity: 0 })
  private trail = new Line(this.trailGeometry, this.trailMaterial)
  private floor: Mesh<PlaneGeometry, MeshStandardMaterial>
  private observer: ResizeObserver
  private frame = 0
  private disposed = false
  private phase: AirplanePhase = 'photo'
  private progress = 0
  private charge = 0
  private folding = false
  private flightTime = 0
  private lastTime = 0
  private lastReport = ''
  private imageToken = 0
  private loaded = false
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  private aim = new Vector2()
  private startPointer = new Vector2()
  private flightStrength = 0.65
  private flightAim = 0
  private trailPoints: Vector3[] = []
  private baseCamera = new Vector3(0.6, 8.4, 9.3)
  private background = new Color('#e8e1d5')

  constructor(private host: HTMLElement, source: string, private onState: (state: AirplaneState) => void, private onError: (message: string) => void) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.10
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    host.appendChild(this.renderer.domElement)
    this.scene.background = this.background
    this.scene.fog = new Fog('#e8e1d5', 25, 65)
    this.scene.add(new HemisphereLight('#fff9ee', '#b5a18a', 2.2))
    const light = new DirectionalLight('#fff5e4', 2.6)
    light.position.set(-5, 10, 4)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    light.shadow.camera.left = -10; light.shadow.camera.right = 10
    light.shadow.camera.top = 10; light.shadow.camera.bottom = -10
    light.shadow.normalBias = 0.025; light.shadow.bias = -0.0002
    light.shadow.radius = 5
    this.scene.add(light)
    this.floor = new Mesh(new PlaneGeometry(180, 180), new MeshStandardMaterial({ color: '#ded5c5', roughness: 1, side: DoubleSide }))
    this.floor.rotation.x = -Math.PI / 2
    this.floor.receiveShadow = true
    this.scene.add(this.floor)
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('normal', new BufferAttribute(this.normals, 3))
    this.geometry.setAttribute('uv', new BufferAttribute(this.uvs, 2))
    this.edges.setAttribute('position', new BufferAttribute(this.edgePositions, 3))
    this.trailGeometry.setAttribute('position', new BufferAttribute(this.trailPositions, 3))
    this.trailGeometry.setDrawRange(0, 0)
    this.trail.frustumCulled = false
    for (const material of [this.front, this.back]) {
      const mesh = new Mesh(this.geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      this.paper.add(mesh)
    }
    const edges = new LineSegments(this.edges, this.edgeMaterial)
    edges.frustumCulled = false
    this.paper.add(edges)
    this.paper.rotation.x = -Math.PI / 2
    this.root.add(this.paper)
    this.root.position.y = 0.045
    this.root.rotation.y = -0.22
    this.scene.add(this.root, this.trail)
    this.updatePaper()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
    this.setSource(source)
    this.frame = requestAnimationFrame(this.tick)
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.fov = width < 600 ? 44 : 33
    this.baseCamera.set(0.6, width < 600 ? 11.5 : 8.4, width < 600 ? 12 : 9.3)
    this.camera.updateProjectionMatrix()
  }

  /** 替换纸面照片；cover 裁切铺满，contain 完整居中。异步结果仅对当前 imageToken 生效。 */
  setSource(source: string, fit: 'cover' | 'contain' = 'cover') {
    const token = ++this.imageToken
    this.loaded = false
    const image = new Image()
    image.onload = () => {
      if (this.disposed || token !== this.imageToken) return
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 1024; canvas.height = 1448
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fcf9f0'; ctx.fillRect(0, 0, 1024, 1448)
        const x = 45, y = 45, w = 934, h = 1212
        const scale = (fit === 'cover' ? Math.max : Math.min)(w / image.naturalWidth, h / image.naturalHeight)
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
        ctx.drawImage(image, x + (w - image.naturalWidth * scale) / 2, y + (h - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale)
        ctx.restore()
        ctx.fillStyle = '#756655'; ctx.font = '24px "Microsoft YaHei", sans-serif'
        ctx.fillText('寄给下一阵风', 53, 1320)
        ctx.fillStyle = '#aca18e'; ctx.font = '14px sans-serif'
        ctx.fillText('A PHOTOGRAPH, A PAPER PLANE.', 55, 1360)
        ctx.textAlign = 'right'; ctx.fillText('013 / WIND LETTER', 969, 1360)
        const texture = new CanvasTexture(canvas)
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
        this.front.map?.dispose()
        this.front.map = texture; this.front.needsUpdate = true
        this.loaded = true
        this.onError('')
        this.resetPhoto()
      } catch { this.onError('这张照片无法读取，请换一张试试。') }
    }
    image.onerror = () => { if (!this.disposed && token === this.imageToken) this.onError('照片加载失败，请重新选择或恢复示例。') }
    image.src = source
  }

  private updatePaper() {
    const faces = airplaneFaces(this.progress)
    let vertexCount = 0, edgeCount = 0
    for (const face of faces) {
      const vertices = face.vertices.map(vertex => ({ p: vertex.p.clone(), uv: vertex.uv }))
      const normal = new Vector3()
      for (let i = 0; i < vertices.length; i++) normal.add(new Vector3().crossVectors(vertices[i].p, vertices[(i + 1) % vertices.length].p))
      normal.normalize()
      if (normal.lengthSq() < 0.1) continue
      for (let i = 1; i < vertices.length - 1; i++) {
        for (const vertex of [vertices[0], vertices[i], vertices[i + 1]]) {
          vertex.p.toArray(this.positions, vertexCount * 3)
          normal.toArray(this.normals, vertexCount * 3)
          vertex.uv.toArray(this.uvs, vertexCount * 2)
          vertexCount++
        }
      }
      for (let i = 0; i < vertices.length; i++) {
        vertices[i].p.toArray(this.edgePositions, edgeCount++ * 3)
        vertices[(i + 1) % vertices.length].p.toArray(this.edgePositions, edgeCount++ * 3)
      }
    }
    this.geometry.setDrawRange(0, vertexCount)
    this.edges.setDrawRange(0, edgeCount)
    for (const attribute of ['position', 'normal', 'uv']) this.geometry.getAttribute(attribute).needsUpdate = true
    this.edges.getAttribute('position').needsUpdate = true
  }

  fold() {
    if (!this.loaded || this.phase === 'flying') return
    this.resetPhoto()
    if (this.reducedMotion) { this.setProgress(1); return }
    this.phase = 'folding'; this.folding = true
    this.report()
  }
  setProgress(value: number) {
    if (!this.loaded || this.phase === 'flying') return
    this.folding = false
    this.progress = clamp(value)
    this.phase = this.progress >= 0.999 ? 'ready' : this.progress <= 0 ? 'photo' : 'folding'
    this.updatePaper(); this.report()
  }
  resetPhoto() {
    this.folding = false; this.progress = 0; this.phase = 'photo'; this.charge = 0
    this.flightTime = 0; this.trailPoints = []; this.trailMaterial.opacity = 0
    this.aim.set(0, 0)
    this.root.visible = true
    this.root.position.set(0, 0.045, 0); this.root.rotation.set(0, -0.22, 0); this.root.scale.setScalar(1)
    this.updatePaper(); this.report()
  }
  readyAgain() {
    this.resetPhoto(); this.setProgress(1)
  }
  pointerDown(x: number, y: number) {
    if (this.phase !== 'ready') return false
    this.startPointer.set(x, y); this.aim.set(0, 0); this.charge = 0; this.phase = 'aiming'; this.report()
    return true
  }
  pointerMove(x: number, y: number) {
    if (this.phase !== 'aiming') return
    this.aim.set(clamp((x - this.startPointer.x) / 180, -1, 1), clamp((y - this.startPointer.y) / 150, -0.5, 1))
    this.charge = clamp(Math.hypot(x - this.startPointer.x, y - this.startPointer.y) / 180)
    this.report()
  }
  pointerUp(cancel = false) {
    if (this.phase !== 'aiming') return
    if (cancel) { this.phase = 'ready'; this.charge = 0; this.report(); return }
    this.launch()
  }
  launch() {
    if (!['ready', 'aiming'].includes(this.phase)) return
    this.flightStrength = 0.5 + this.charge * 0.5
    this.flightAim = this.aim.x
    this.phase = 'flying'; this.flightTime = 0; this.folding = false; this.trailPoints = []
    this.report()
  }

  // t 是 0～1 的飞行进度，返回世界空间预设轨迹；正弦抬升与横向偏移用于表现滑翔，不模拟空气动力学。
  private flightPosition(t: number): Vector3 {
    const strength = this.flightStrength
    return new Vector3(
      t * 10 + Math.sin(t * Math.PI) * (1.3 + this.flightAim * 2.0),
      0.48 + Math.sin(t * Math.PI * 0.78) * (2.4 + strength * 2.2) + t * 0.7,
      -t * (14 + strength * 7) + Math.sin(t * Math.PI) * 1.5,
    )
  }

  private report() {
    const state = { phase: this.phase, progress: Math.round(this.progress * 100), charge: Math.round(this.charge * 100) }
    const key = `${state.phase}-${state.progress}-${state.charge}`
    if (key !== this.lastReport) { this.lastReport = key; this.onState(state) }
  }

  private tick = (now: number) => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.tick)
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.05) : 0
    this.lastTime = now
    if (document.hidden) return
    if (this.folding) {
      this.progress = Math.min(1, this.progress + dt / 8.8)
      this.updatePaper()
      if (this.progress >= 1) { this.folding = false; this.phase = 'ready' }
      this.report()
    }
    this.camera.position.copy(this.baseCamera)
    const target = new Vector3(0, 0.25, 0)
    if (this.phase === 'flying' || this.phase === 'away') {
      if (this.phase === 'flying') this.flightTime += dt
      const t = clamp(this.flightTime / (this.reducedMotion ? 2.0 : 4.8))
      const position = this.flightPosition(t)
      this.root.position.copy(position)
      this.root.scale.setScalar(1 - ease((t - 0.63) / 0.37) * 0.94)
      const tangent = this.flightPosition(t + 0.005).sub(position).normalize()
      this.root.quaternion.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), tangent, new Vector3(0, 1, 0)))
      this.root.rotateZ(-0.10 - Math.sin(t * Math.PI * 2) * 0.14 + this.flightAim * 0.12)
      this.camera.position.addScaledVector(position, 0.35)
      target.addScaledVector(position, 0.70)
      if (this.phase === 'flying') {
        this.trailPoints.push(position.clone())
        if (this.trailPoints.length > 65) this.trailPoints.shift()
        this.trailPoints.forEach((point, index) => point.toArray(this.trailPositions, index * 3))
        this.trailGeometry.setDrawRange(0, this.trailPoints.length)
        this.trailGeometry.getAttribute('position').needsUpdate = true
        this.trailMaterial.opacity = 0.20 * (1 - ease((t - 0.75) / 0.25))
        if (t >= 1) { this.phase = 'away'; this.root.visible = false; this.report() }
      }
    } else {
      const lift = ease((this.progress - 0.55) / 0.45)
      this.root.position.set(-this.aim.x * (this.phase === 'aiming' ? 0.15 : 0), 0.045 + lift * 0.44 + (this.phase === 'aiming' ? this.charge * 0.18 : 0), this.phase === 'aiming' ? this.charge * 0.65 : 0)
      this.root.rotation.set(0, -0.22 - lift * 0.30 + (this.phase === 'aiming' ? this.aim.x * 0.2 : 0), 0)
      if (this.phase === 'ready' && !this.reducedMotion) this.root.position.y += Math.sin(now * 0.0017) * 0.025
    }
    this.camera.lookAt(target)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true; this.imageToken++; cancelAnimationFrame(this.frame); this.observer.disconnect()
    // 正反面 Mesh 共用纸张几何，统一释放一次；照片纹理由正面材质单独持有。
    this.geometry.dispose(); this.edges.dispose(); this.front.map?.dispose(); this.front.dispose(); this.back.dispose(); this.edgeMaterial.dispose()
    this.trailGeometry.dispose(); this.trailMaterial.dispose(); this.floor.geometry.dispose(); this.floor.material.dispose()
    this.scene.traverse(object => { if (object instanceof DirectionalLight) object.shadow.dispose() })
    this.renderer.dispose(); this.renderer.domElement.remove()
  }
}
