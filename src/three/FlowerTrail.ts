import {
  ACESFilmicToneMapping, BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3,
  Color, DirectionalLight, DoubleSide, DynamicDrawUsage, Fog, HemisphereLight,
  InstancedBufferAttribute, InstancedMesh, Mesh, MeshDepthMaterial,
  MeshStandardMaterial, Object3D, PCFSoftShadowMap, PerspectiveCamera, Plane,
  PlaneGeometry, Raycaster, RepeatWrapping, RGBADepthPacking, Scene, SphereGeometry, SRGBColorSpace,
  TubeGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

export type FlowerPalette = 'meadow' | 'twilight'
export type FlowerTrailState = { flowers: number; demonstrating: boolean; full: boolean }
type Pool = {
  mesh: InstancedMesh<BufferGeometry, MeshStandardMaterial>
  birth: InstancedBufferAttribute
  tint: InstancedBufferAttribute
  phase: InstancedBufferAttribute
  depth: MeshDepthMaterial
  cursor: number
  count: number
}
const CAPACITY = 280
const MAX_FLOWERS = CAPACITY * 3
const TAU = Math.PI * 2
const groundHeight = (x: number, z: number) => Math.sin(x * 0.53 + z * 0.27) * 0.055 + Math.sin(z * 0.92 - x * 0.16) * 0.035
const palettes: Record<FlowerPalette, string[][]> = {
  meadow: [['#fff4d8', '#fffdf1', '#ffe7a1'], ['#e46d43', '#ed9664', '#c94d37'], ['#edb2b4', '#d8869c', '#f4d3c4']],
  twilight: [['#f8f4e5', '#fff0ba', '#eee9db'], ['#8b85bc', '#a69acb', '#8176b2'], ['#c58cae', '#e8b5c7', '#ba799d']],
}

// 合并花茎、弯曲叶片和杯状花瓣，得到可实例化的单株几何，避免为每朵花创建独立场景对象。
function flowerGeometry(species: number) {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], parts: number[] = []
  const color = new Color()
  function append(geometry: BufferGeometry, part: number, tint: string | ((p: Vector3) => Color)) {
    const data = geometry.index ? geometry.toNonIndexed() : geometry
    const p = data.getAttribute('position'), n = data.getAttribute('normal')
    const v = new Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
      const c = typeof tint === 'string' ? color.set(tint) : tint(v)
      positions.push(v.x, v.y, v.z); normals.push(n.getX(i), n.getY(i), n.getZ(i))
      colors.push(c.r, c.g, c.b); parts.push(part)
    }
    if (data !== geometry) data.dispose()
    geometry.dispose()
  }
  const curve = new CatmullRomCurve3([
    new Vector3(0, 0, 0), new Vector3(0.035, 0.33, 0.015),
    new Vector3(-0.025, 0.68, -0.01), new Vector3(0, 1, 0),
  ])
  append(new TubeGeometry(curve, 7, species === 1 ? 0.012 : 0.009, 5, false), 0, '#506341')

  // 通过网格顶点构造弯曲叶面、中央叶脉与收尖轮廓，而非仅用平面贴图。
  function blade(length: number, width: number, height: number, angle: number, grass: boolean) {
    const geometry = new PlaneGeometry(1, 1, 3, 7)
    const p = geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) * 2, t = p.getY(i) + 0.5
      const spread = Math.pow(Math.sin(Math.PI * t), grass ? 0.7 : 0.85)
      const across = u * spread * width
      const forward = t * length
      const y = height + (grass ? 0.4 : 0.29) * Math.sin(t * Math.PI * 0.85)
        - Math.abs(u) * spread * 0.025
      p.setXYZ(i, Math.sin(angle) * forward + Math.cos(angle) * across, y,
        Math.cos(angle) * forward - Math.sin(angle) * across)
    }
    geometry.computeVertexNormals()
    append(geometry, 1, p => new Color().setRGB(0.12 + p.y * 0.07, 0.21 + p.y * 0.09, 0.065 + p.y * 0.035))
  }
  blade(0.31, 0.055, 0.28, 1.0, false)
  blade(0.25, 0.047, 0.55, 4.0, false)
  for (let j = 0; j < 3; j++) blade(0.24 + j * 0.045, 0.013, 0.015, j * 2.4, true)

  const petalCount = species === 0 ? 15 : species === 1 ? 6 : 8
  const radius = species === 0 ? 0.235 : species === 1 ? 0.29 : 0.265
  const halfWidth = species === 0 ? 0.044 : species === 1 ? 0.155 : 0.108
  for (let petal = 0; petal < petalCount; petal++) {
    const angle = petal / petalCount * TAU
    const geometry = new PlaneGeometry(1, 1, species === 0 ? 3 : 5, 6)
    const p = geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) * 2, t = p.getY(i) + 0.5
      const shape = Math.pow(Math.sin(Math.PI * t * 0.97), species === 0 ? 0.45 : 0.6)
      const r = 0.027 + t * radius
      const across = u * halfWidth * shape
      const cup = species === 1 ? 0.13 : species === 2 ? 0.055 : -0.01
      const y = 1 + cup * t * t + 0.035 * Math.sin(t * Math.PI)
        + u * u * 0.026 * shape + Math.sin(t * 9 + petal) * 0.005 * t
      p.setXYZ(i, Math.cos(angle) * r - Math.sin(angle) * across, y,
        Math.sin(angle) * r + Math.cos(angle) * across)
    }
    geometry.computeVertexNormals()
    append(geometry, 2, p => {
      const t = Math.min(1, Math.hypot(p.x, p.z) / radius)
      return new Color().setRGB(0.73 + t * 0.27, 0.64 + t * 0.35, 0.52 + t * 0.46)
    })
  }
  const center = new SphereGeometry(species === 1 ? 0.055 : 0.059, 10, 6)
  center.scale(1, species === 1 ? 0.55 : 0.5, 1); center.translate(0, 1.035, 0)
  append(center, 3, species === 1 ? '#3d3829' : '#d39b35')
  // 用凸起的小颗粒表现花粉，让花心能接收立体光照。
  for (let i = 0; i < 10; i++) {
    const a = i * 2.39996, r = Math.sqrt(i / 10) * 0.045
    const grain = new SphereGeometry(0.007, 3, 2)
    grain.translate(Math.cos(a) * r, 1.058 + (1 - r / 0.05) * 0.009, Math.sin(a) * r)
    append(grain, 3, species === 1 ? '#b18a43' : '#f3c460')
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setAttribute('aPart', new BufferAttribute(new Float32Array(parts), 1))
  const indexed = mergeVertices(geometry)
  geometry.dispose()
  return indexed
}

// aBirth 为实例出生秒数，aPhase 为风摆相位（弧度），aPart 标记花茎、叶片、花瓣与花心。
// uGardenTime 与 aBirth 使用同一累计秒时钟，uBreeze 为 0/1 风开关；变形在实例矩阵应用前执行。
const growthDefinitions = /* glsl */`
  attribute float aBirth;
  attribute float aPhase;
  attribute float aPart;
  uniform float uGardenTime;
  uniform float uBreeze;
`
const growthTransform = /* glsl */`
  #include <begin_vertex>
  float age = max(0.0, uGardenTime - aBirth);
  float stem = smoothstep(0.0, 0.82, age);
  float bloom = smoothstep(0.48, 1.65, age);
  if (aPart > 1.5) {
    transformed = vec3(0.0, 1.0, 0.0) + (position - vec3(0.0, 1.0, 0.0))
      * vec3(0.08 + 0.92 * bloom, 0.75 + 0.25 * bloom, 0.08 + 0.92 * bloom);
    transformed.y += (1.0 - bloom) * length(position.xz) * 1.35;
  }
  transformed.y *= max(0.001, stem);
  transformed.xz *= 0.2 + 0.8 * stem;
  float sway = sin(uGardenTime * 1.15 + aPhase) * 0.027
    + sin(uGardenTime * 0.61 + aPhase * 0.7) * 0.018;
  transformed.x += sway * position.y * position.y * uBreeze * stem;
  transformed.z += cos(uGardenTime * 0.83 + aPhase) * 0.014
    * position.y * position.y * uBreeze * stem;
`

/** 将指针轨迹投射到地面，使用有容量上限的实例池种花，并由 Shader 驱动生长和风摆。 */
export class FlowerTrail {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(39, 1, 0.1, 80)
  private pools: Pool[] = []
  private ground: Mesh<PlaneGeometry, MeshStandardMaterial>
  private stones: InstancedMesh
  private patches: InstancedMesh<PlaneGeometry, MeshStandardMaterial>
  private textures: CanvasTexture[] = []
  private observer: ResizeObserver
  private frame = 0
  private disposed = false
  private clock = 0
  private lastTime = 0
  private uniforms = { uGardenTime: { value: 0 }, uBreeze: { value: 1 } }
  private raycaster = new Raycaster()
  private plane = new Plane(new Vector3(0, 1, 0), 0)
  private ndc = new Vector2()
  private hit = new Vector3()
  private lastPoint: Vector3 | null = null
  private dummy = new Object3D()
  private color = new Color()
  private palette: FlowerPalette = 'meadow'
  private width = 0.85
  private patchCursor = 0
  private seed = 76193
  private demoStarted: number | null = 0.4
  private demoPrevious = -1
  private lastReport = ''
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(private host: HTMLElement, private onState: (state: FlowerTrailState) => void) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    host.appendChild(this.renderer.domElement)
    this.scene.background = new Color('#d7d1c5')
    this.scene.fog = new Fog('#d7d1c5', 21, 48)
    this.scene.add(new HemisphereLight('#fff7e8', '#78725c', 2.1))
    const light = new DirectionalLight('#fff4e1', 2.8)
    light.position.set(-5, 9, -4)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    light.shadow.camera.left = -13; light.shadow.camera.right = 13
    light.shadow.camera.top = 11; light.shadow.camera.bottom = -11
    light.shadow.normalBias = 0.025; light.shadow.bias = -0.0003
    light.shadow.radius = 3
    this.scene.add(light)

    const soil = this.soilTexture()
    const terrain = new PlaneGeometry(48, 42, 100, 80)
    terrain.rotateX(-Math.PI / 2)
    const pos = terrain.getAttribute('position')
    for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)))
    terrain.computeVertexNormals()
    this.ground = new Mesh(terrain, new MeshStandardMaterial({ color: '#dbd4c5', map: soil, bumpMap: soil, bumpScale: 0.025, roughness: 1 }))
    this.ground.receiveShadow = true
    this.scene.add(this.ground)

    const stoneGeometry = new SphereGeometry(1, 5, 3)
    const stoneMaterial = new MeshStandardMaterial({ color: '#a1937d', roughness: 1 })
    this.stones = new InstancedMesh(stoneGeometry, stoneMaterial, 500)
    for (let i = 0; i < 500; i++) {
      const x = (this.random() - 0.5) * 29, z = (this.random() - 0.5) * 22
      const r = 0.017 + this.random() ** 3 * 0.08
      this.dummy.position.set(x, groundHeight(x, z) + r * 0.2, z)
      this.dummy.scale.set(r * 1.4, r * 0.55, r)
      this.dummy.rotation.set(this.random(), this.random() * TAU, this.random())
      this.dummy.updateMatrix(); this.stones.setMatrixAt(i, this.dummy.matrix)
      this.stones.setColorAt(i, this.color.setHSL(0.09, 0.12, 0.39 + this.random() * 0.17))
    }
    this.stones.receiveShadow = true
    this.scene.add(this.stones)

    const patch = this.patchTexture()
    const patchGeometry = new PlaneGeometry(1, 1)
    patchGeometry.rotateX(-Math.PI / 2)
    this.patches = new InstancedMesh(patchGeometry, new MeshStandardMaterial({ color: '#6e7950', map: patch, transparent: true, opacity: 0.24, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }), MAX_FLOWERS)
    this.patches.instanceMatrix.setUsage(DynamicDrawUsage)
    this.patches.count = 0; this.patches.frustumCulled = false
    this.scene.add(this.patches)

    for (let species = 0; species < 3; species++) {
      const geometry = flowerGeometry(species)
      const birth = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(DynamicDrawUsage)
      const tint = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(DynamicDrawUsage)
      const phase = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(DynamicDrawUsage)
      geometry.setAttribute('aBirth', birth); geometry.setAttribute('aTint', tint); geometry.setAttribute('aPhase', phase)
      const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: DoubleSide })
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, this.uniforms)
        shader.vertexShader = growthDefinitions + '\nattribute vec3 aTint;\n' + shader.vertexShader
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', growthTransform)
          .replace('#include <color_vertex>', '#include <color_vertex>\n vColor.xyz *= mix(vec3(1.0), aTint, step(1.5, aPart) * (1.0 - step(2.5, aPart)));')
      }
      material.customProgramCacheKey = () => 'flower-trail-growth-v1'
      const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide })
      depth.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, this.uniforms)
        shader.vertexShader = growthDefinitions + shader.vertexShader
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', growthTransform)
      }
      depth.customProgramCacheKey = () => 'flower-trail-depth-v1'
      const mesh = new InstancedMesh(geometry, material, CAPACITY)
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.customDepthMaterial = depth
      mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false
      this.pools.push({ mesh, birth, tint, phase, depth, cursor: 0, count: 0 })
      this.scene.add(mesh)
    }
    if (this.reducedMotion) this.uniforms.uBreeze.value = 0
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host); this.resize(); this.report()
    this.frame = requestAnimationFrame(this.tick)
  }

  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  private soilTexture() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#a59c8a'; ctx.fillRect(0, 0, 512, 512)
    const data = ctx.getImageData(0, 0, 512, 512)
    for (let i = 0; i < data.data.length; i += 4) {
      const grain = (this.random() - 0.5) * 22
      data.data[i] += grain; data.data[i + 1] += grain; data.data[i + 2] += grain
    }
    ctx.putImageData(data, 0, 0)
    // 土壤裂缝保持细碎、低对比，避免纹理在视觉上抢过花朵。
    ctx.strokeStyle = '#756b5533'; ctx.lineWidth = 0.7
    for (let i = 0; i < 65; i++) {
      let x = this.random() * 512, y = this.random() * 512, angle = this.random() * TAU
      ctx.beginPath(); ctx.moveTo(x, y)
      for (let j = 0; j < 4; j++) {
        angle += (this.random() - 0.5) * 1.4
        x += Math.cos(angle) * (4 + this.random() * 12); y += Math.sin(angle) * (4 + this.random() * 12)
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.wrapS = texture.wrapT = RepeatWrapping
    texture.repeat.set(4, 3.5)
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.textures.push(texture); return texture
  }

  private patchTexture() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 31)
    gradient.addColorStop(0, '#ffffffaa'); gradient.addColorStop(0.5, '#ffffff66'); gradient.addColorStop(1, '#ffffff00')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64)
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace
    this.textures.push(texture); return texture
  }

  private resize() {
    const width = Math.max(this.host.clientWidth, 1), height = Math.max(this.host.clientHeight, 1)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    // 竖屏时抬高并拉远相机，让花路仍有足够的可见地面。
    this.camera.position.set(0, width < 600 ? 12.9 : 10.3, width < 600 ? 13.8 : 11.8)
    this.camera.fov = width < 600 ? 49 : 39
    this.camera.lookAt(0, 0, -0.25); this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
  }

  setPalette(value: FlowerPalette) { this.palette = value }
  setWidth(value: number) { this.width = Math.max(0.3, Math.min(1.5, value)) }
  setBreeze(value: boolean) { this.uniforms.uBreeze.value = value ? 1 : 0 }
  endStroke() { this.lastPoint = null }

  /** 视口 CSS 像素坐标经 NDC 射线投到世界 Y=0 平面，取 XZ 后按地表高度放置花株。 */
  paint(clientX: number, clientY: number) {
    const rect = this.host.getBoundingClientRect()
    this.ndc.set((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) { this.endStroke(); return }
    if (Math.abs(this.hit.x) > 12 || Math.abs(this.hit.z) > 9) { this.endStroke(); return }
    if (this.demoStarted !== null) this.lastPoint = null
    this.demoStarted = null
    this.paintWorld(this.hit.x, this.hit.z)
    this.report()
  }

  private paintWorld(x: number, z: number) {
    const target = new Vector3(x, 0, z)
    if (!this.lastPoint) {
      this.cluster(x, z, 7); this.lastPoint = target; return
    }
    const distance = this.lastPoint.distanceTo(target)
    if (distance < 0.15) return
    // 按世界空间距离补点，减少快速移动造成的断层；离开或重新进入时由 endStroke 清除连接起点。
    const steps = Math.min(55, Math.ceil(distance / 0.17))
    const from = this.lastPoint.clone()
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      this.cluster(from.x + (x - from.x) * t, from.z + (z - from.z) * t, 3)
    }
    this.lastPoint.copy(target)
  }

  private cluster(x: number, z: number, amount: number) {
    for (let i = 0; i < amount; i++) {
      const angle = this.random() * TAU, radius = Math.sqrt(this.random()) * this.width * 0.57
      this.plant(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius)
    }
  }

  private plant(x: number, z: number) {
    const pick = this.random(), species = pick < 0.43 ? 0 : pick < 0.7 ? 1 : 2
    // 每种花独立循环复用实例槽位，容量满后覆盖该种最早实例，避免 GPU 缓冲无限增长。
    const pool = this.pools[species], index = pool.cursor++ % CAPACITY
    const height = 0.45 + this.random() ** 0.7 * 0.65
    this.dummy.position.set(x, groundHeight(x, z) + 0.01, z)
    this.dummy.rotation.set((this.random() - 0.5) * 0.16, this.random() * TAU, (this.random() - 0.5) * 0.16)
    this.dummy.scale.setScalar(height)
    this.dummy.updateMatrix(); pool.mesh.setMatrixAt(index, this.dummy.matrix)
    const choices = palettes[this.palette][species]
    this.color.set(choices[Math.floor(this.random() * choices.length)])
    pool.tint.setXYZ(index, this.color.r, this.color.g, this.color.b)
    pool.birth.setX(index, this.clock - (this.reducedMotion ? 2 : this.random() * 0.12))
    pool.phase.setX(index, this.random() * TAU)
    pool.count = Math.min(pool.count + 1, CAPACITY); pool.mesh.count = pool.count
    pool.mesh.instanceMatrix.needsUpdate = true
    pool.birth.needsUpdate = pool.tint.needsUpdate = pool.phase.needsUpdate = true
    const patch = this.patchCursor++ % MAX_FLOWERS
    this.dummy.position.set(x, groundHeight(x, z) + 0.014, z)
    this.dummy.rotation.set(0, this.random() * TAU, 0)
    this.dummy.scale.setScalar(0.4 + height * 0.5)
    this.dummy.updateMatrix(); this.patches.setMatrixAt(patch, this.dummy.matrix)
    this.patches.count = Math.min(this.patchCursor, MAX_FLOWERS)
    this.patches.instanceMatrix.needsUpdate = true
  }

  plantCenter() {
    this.demoStarted = null; this.cluster(0, 0, 19); this.lastPoint = null; this.report()
  }

  clear() {
    this.demoStarted = null; this.lastPoint = null; this.patchCursor = 0
    this.patches.count = 0
    for (const pool of this.pools) { pool.cursor = 0; pool.count = 0; pool.mesh.count = 0 }
    this.report()
  }

  demonstrate() {
    this.clear(); this.demoStarted = this.clock + 0.15; this.demoPrevious = -1; this.report()
  }

  private report() {
    const flowers = this.pools.reduce((sum, pool) => sum + pool.count, 0)
    const state = { flowers, demonstrating: this.demoStarted !== null, full: flowers === MAX_FLOWERS }
    const key = `${flowers}/${state.demonstrating}`
    if (key !== this.lastReport) { this.lastReport = key; this.onState(state) }
  }

  private tick = (now: number) => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.tick)
    const delta = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.2) : 0
    this.lastTime = now
    if (document.hidden) return
    this.clock += delta; this.uniforms.uGardenTime.value = this.clock
    if (this.demoStarted !== null && this.clock >= this.demoStarted) {
      const t = Math.min(1, (this.clock - this.demoStarted) / (this.reducedMotion ? 0.05 : 5.2))
      const index = Math.floor(t * 100)
      if (index !== this.demoPrevious) {
        // 补齐尚未绘制的路径采样点，避免低帧率导致自动示范的花路变稀。
        for (let i = this.demoPrevious + 1; i <= index; i++) {
          const u = i / 100
          const x = (u - 0.5) * (this.camera.aspect < 0.8 ? 6.2 : 13.6)
          const z = Math.sin(u * TAU - 1.15) * 1.75 + 0.8
          this.paintWorld(x, z)
        }
        this.demoPrevious = index
      }
      if (t >= 1) { this.demoStarted = null; this.endStroke() }
      this.report()
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.observer.disconnect()
    // 主材质与阴影深度材质均由实例池持有；两者使用一致的生长变形，销毁时需分别释放。
    for (const pool of this.pools) { pool.mesh.geometry.dispose(); pool.mesh.material.dispose(); pool.depth.dispose(); pool.mesh.dispose() }
    this.ground.geometry.dispose(); this.ground.material.dispose()
    this.stones.geometry.dispose()
    const stoneMaterial = this.stones.material
    if (Array.isArray(stoneMaterial)) stoneMaterial.forEach(material => material.dispose()); else stoneMaterial.dispose()
    this.stones.dispose(); this.patches.geometry.dispose(); this.patches.material.dispose(); this.patches.dispose()
    this.textures.forEach(texture => texture.dispose())
    this.scene.traverse(object => { if (object instanceof DirectionalLight) object.shadow.dispose() })
    this.renderer.dispose(); this.renderer.domElement.remove()
  }
}
