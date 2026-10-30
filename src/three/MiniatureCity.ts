import {
  AmbientLight, BoxGeometry, CanvasTexture, DirectionalLight, Group,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, PlaneGeometry,
  Scene, SphereGeometry, SRGBColorSpace, Texture, TextureLoader, Vector2,
  WebGLRenderer, type Material,
} from 'three'
import { publicAsset } from '../utils/publicAsset'

type Building = {
  body: Mesh
  roof: Mesh
  shadow: Mesh
  height: number
  delay: number
  chimney?: Mesh
}

const PHOTO_WIDTH = 16
const PHOTO_DEPTH = 9
const GROUND_Y = 0.14
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const ease = (value: number) => { const x = clamp(value); return x * x * (3 - 2 * x) }

function facadeTexture(base: string, dark: string, lit: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 256, 256)
  for (let floor = 0; floor < 5; floor++) {
    const y = floor * 50 + 11
    ctx.fillStyle = '#554c3a'
    ctx.globalAlpha = 0.2
    ctx.fillRect(0, y + 37, 256, 3)
    ctx.globalAlpha = 1
    for (let col = 0; col < 5; col++) {
      const x = col * 50 + 12
      ctx.fillStyle = '#e9d2a4'
      ctx.fillRect(x - 3, y - 3, 29, 35)
      ctx.fillStyle = (floor + col) % 4 === 0 ? lit : dark
      ctx.fillRect(x, y, 23, 27)
      ctx.fillStyle = '#e6d0a8'
      ctx.fillRect(x + 10, y, 2, 27)
      ctx.fillRect(x, y + 13, 23, 2)
      ctx.fillStyle = '#40392d'
      ctx.globalAlpha = 0.26
      ctx.fillRect(x - 5, y + 28, 32, 3)
      ctx.globalAlpha = 1
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

// 屋顶平面随后转到 XZ 地面方向，局部 +Y 对应世界 -Z；UV 因此按照片所在位置反算。
function roofGeometry(width: number, depth: number, x: number, z: number) {
  const geometry = new PlaneGeometry(width, depth)
  const positions = geometry.getAttribute('position')
  const uvs = geometry.getAttribute('uv')
  for (let i = 0; i < positions.count; i++) {
    const worldX = x + positions.getX(i)
    const worldZ = z - positions.getY(i)
    uvs.setXY(i, (worldX + PHOTO_WIDTH / 2) / PHOTO_WIDTH, (PHOTO_DEPTH / 2 - worldZ) / PHOTO_DEPTH)
  }
  uvs.needsUpdate = true
  return geometry
}

/** 按预设街区布局将照片过渡为微缩城市；建筑位置和高度并非从任意照片自动推断。 */
export class MiniatureCity {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new OrthographicCamera(-9, 9, 5, -5, 0.1, 100)
  private photo: Texture
  private facadeTextures: Texture[]
  private facadeMaterials: MeshStandardMaterial[]
  private roofMaterial: MeshBasicMaterial
  private sharedGeometries: Array<BoxGeometry | SphereGeometry> = []
  private city = new Group()
  private buildings: Building[] = []
  private trees: Array<{ group: Group; delay: number }> = []
  private cars: Group[] = []
  private observer: ResizeObserver
  private frame = 0
  private playStart = 0
  private running = false
  private progress = 0
  private orbit = new Vector2()
  private targetOrbit = new Vector2()
  private dragging = false
  private lastPointer = new Vector2()
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private disposed = false

  constructor(private host: HTMLElement, private onProgress: (value: number) => void) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 650 ? 1 : 1.5))
    this.renderer.setClearColor(0x10171b)
    this.host.appendChild(this.renderer.domElement)
    this.camera.up.set(0, 0, -1)
    this.scene.add(this.city)

    this.photo = new TextureLoader().load(publicAsset('images/miniature-city/aerial.jpg'), () => this.render())
    this.photo.colorSpace = SRGBColorSpace
    this.photo.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.roofMaterial = new MeshBasicMaterial({ map: this.photo, side: 2 })
    this.facadeTextures = [
      facadeTexture('#c9ae82', '#3b4040', '#e3b371'),
      facadeTexture('#a99579', '#303a40', '#dcb785'),
      facadeTexture('#ddd0ae', '#364047', '#f0c890'),
      facadeTexture('#a6765d', '#32383b', '#d4a876'),
    ]
    this.facadeMaterials = this.facadeTextures.map(map => new MeshStandardMaterial({ map, roughness: 0.91, metalness: 0 }))

    this.addLights()
    this.addPhotoBoard()
    this.addBuildings()
    this.addStreetLife()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(this.host)
    this.resize()
    this.setProgress(this.reducedMotion ? 1 : 0)
    if (!this.reducedMotion) window.setTimeout(() => { if (!this.disposed) this.replay() }, 600)
  }

  private addLights() {
    this.scene.add(new AmbientLight(0xfff2d8, 2.15))
    const sun = new DirectionalLight(0xffd39a, 2.3)
    sun.position.set(-9, 18, -7)
    this.scene.add(sun)
  }

  private addPhotoBoard() {
    const baseGeometry = new BoxGeometry(16.28, 0.32, 9.28)
    this.sharedGeometries.push(baseGeometry)
    const base = new Mesh(baseGeometry, new MeshStandardMaterial({ color: 0x28343b, roughness: 0.82, metalness: 0.1 }))
    base.position.y = -0.03
    this.city.add(base)
    const ground = new Mesh(new PlaneGeometry(PHOTO_WIDTH, PHOTO_DEPTH), new MeshBasicMaterial({ map: this.photo }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = GROUND_Y
    ground.receiveShadow = true
    this.city.add(ground)
    const edge = new Mesh(new BoxGeometry(16.04, 0.025, 9.04), new MeshBasicMaterial({ color: 0xd3ad77 }))
    edge.position.y = 0.125
    this.city.add(edge)
    ground.position.y = 0.143
  }

  private addBuildings() {
    let seed = 8113
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const shadowMaterial = new MeshBasicMaterial({ color: 0x22201c, transparent: true, opacity: 0, depthWrite: false })
    const chimneyGeometry = new BoxGeometry(0.1, 0.18, 0.1)
    this.sharedGeometries.push(chimneyGeometry)
    // 街道布局对应默认照片中的十字道路；屋顶 UV 采样建筑所在位置的照片区域。
    for (const side of [-1, 1]) {
      for (const half of [-1, 1]) {
        const x0 = side < 0 ? -7.78 : 0.9
        const x1 = side < 0 ? -0.94 : 7.78
        const z0 = half < 0 ? -4.29 : 0.57
        const z1 = half < 0 ? -0.58 : 4.28
        let x = x0
        while (x < x1 - 0.5) {
          const width = Math.min(x1 - x - 0.08, 0.76 + random() * 0.7)
          if (width < 0.48) break
          let z = z0
          while (z < z1 - 0.42) {
            const depth = Math.min(z1 - z - 0.08, 0.62 + random() * 0.62)
            if (depth < 0.42) break
            const cx = x + width / 2
            const cz = z + depth / 2
            const plaza = side > 0 && half > 0 && cx > 3.0 && cx < 6.4 && cz > 1.1 && cz < 3.9
            if (!plaza && random() > 0.095) {
              const height = 0.48 + random() * 0.78 + (random() > 0.87 ? 0.35 : 0)
              const body = new Mesh(new BoxGeometry(width, 1, depth), this.facadeMaterials[Math.floor(random() * this.facadeMaterials.length)])
              body.position.set(cx, GROUND_Y, cz)
              this.city.add(body)
              const roof = new Mesh(roofGeometry(width, depth, cx, cz), this.roofMaterial)
              roof.rotation.x = -Math.PI / 2
              roof.position.set(cx, GROUND_Y + 0.004, cz)
              this.city.add(roof)
              const shadow = new Mesh(new PlaneGeometry(width + 0.18, depth + 0.18), shadowMaterial.clone())
              shadow.rotation.x = -Math.PI / 2
              shadow.position.set(cx + 0.06, GROUND_Y + 0.005, cz + 0.06)
              this.city.add(shadow)
              let chimney: Mesh | undefined
              if (random() > 0.76) {
                chimney = new Mesh(chimneyGeometry, new MeshStandardMaterial({ color: 0xa38265, roughness: 1 }))
                chimney.position.set(cx + width * 0.2, GROUND_Y, cz - depth * 0.16)
                this.city.add(chimney)
              }
              const distance = Math.hypot(cx / 8, cz / 4.5)
              const delay = 0.08 + distance * 0.27 + random() * 0.12
              this.buildings.push({ body, roof, shadow, height, delay, chimney })
            }
            z += depth + 0.075 + random() * 0.08
          }
          x += width + 0.07 + random() * 0.09
        }
      }
    }
    shadowMaterial.dispose()
  }

  private addStreetLife() {
    const trunkGeometry = new BoxGeometry(0.045, 0.48, 0.045)
    const crownGeometry = new SphereGeometry(0.22, 7, 5)
    const trunkMaterial = new MeshStandardMaterial({ color: 0x694a32, roughness: 1 })
    const foliage = [0x728046, 0x9a943f, 0x516b3c].map(color => new MeshStandardMaterial({ color, roughness: 1 }))
    this.sharedGeometries.push(trunkGeometry, crownGeometry)
    const treePositions: Array<[number, number]> = []
    for (let z = -3.9; z <= 4.05; z += 0.78) {
      if (Math.abs(z) < 0.5) continue
      treePositions.push([-0.77, z], [0.78, z + 0.24])
    }
    for (const [x, z] of [[3.4, 1.5], [4.4, 1.35], [5.3, 1.7], [3.8, 2.55], [5.8, 2.9], [4.8, 3.5], [6.4, 1.9], [-5.8, -2.2], [-3.9, 2.8]] as Array<[number, number]>) treePositions.push([x, z])
    treePositions.forEach(([x, z], index) => {
      const group = new Group()
      const trunk = new Mesh(trunkGeometry, trunkMaterial)
      trunk.position.y = 0.24
      const crown = new Mesh(crownGeometry, foliage[index % foliage.length])
      crown.position.y = 0.57
      crown.scale.set(1, 0.85, 1)
      group.add(trunk, crown)
      group.position.set(x, GROUND_Y, z)
      this.city.add(group)
      this.trees.push({ group, delay: 0.31 + (index % 7) * 0.027 })
    })
    const carGeometry = new BoxGeometry(0.23, 0.1, 0.39)
    const cabinGeometry = new BoxGeometry(0.18, 0.07, 0.19)
    this.sharedGeometries.push(carGeometry, cabinGeometry)
    const carColors = [0xd7c9b0, 0x263f46, 0x9e4739, 0xd0a75d, 0x46545b]
    for (let i = 0; i < 8; i++) {
      const group = new Group()
      const material = new MeshStandardMaterial({ color: carColors[i % carColors.length], roughness: 0.55, metalness: 0.22 })
      const body = new Mesh(carGeometry, material)
      body.position.y = 0.06
      const cabin = new Mesh(cabinGeometry, new MeshStandardMaterial({ color: 0x2f4043, roughness: 0.42, metalness: 0.15 }))
      cabin.position.set(0, 0.13, -0.02)
      group.add(body, cabin)
      const vertical = i < 5
      const x = vertical ? (i % 2 ? -0.27 : 0.3) : -5.9 + (i - 5) * 4.5
      const z = vertical ? -3.6 + i * 1.35 : (i % 2 ? -0.16 : 0.18)
      group.position.set(x, GROUND_Y, z)
      if (!vertical) group.rotation.y = Math.PI / 2
      this.city.add(group)
      this.cars.push(group)
    }
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    const aspect = width / height
    const halfHeight = aspect < 1.12 ? 5.8 : Math.max(4.8, 8.55 / aspect)
    this.camera.left = -halfHeight * aspect
    this.camera.right = halfHeight * aspect
    this.camera.top = halfHeight
    this.camera.bottom = -halfHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.applyProgress()
  }

  private applyProgress() {
    const p = this.progress
    for (const building of this.buildings) {
      const lift = ease((p - building.delay) / 0.48)
      const rise = building.height * lift
      building.body.scale.y = Math.max(0.001, rise)
      building.body.position.y = GROUND_Y + rise / 2
      building.roof.position.y = GROUND_Y + rise + 0.004
      ;(building.shadow.material as MeshBasicMaterial).opacity = 0.24 * lift
      if (building.chimney) {
        building.chimney.position.y = GROUND_Y + rise + 0.09 * lift
        building.chimney.scale.y = Math.max(0.001, lift)
      }
    }
    for (const tree of this.trees) tree.group.scale.y = Math.max(0.001, ease((p - tree.delay) / 0.35))
    for (const car of this.cars) car.scale.setScalar(Math.max(0.001, ease((p - 0.48) / 0.34)))
    this.orbit.lerp(this.targetOrbit, 0.12)
    const tilt = 0.015 + ease((p - 0.04) / 0.9) * 0.77 + this.orbit.y
    const azimuth = -0.46 * ease((p - 0.04) / 0.9) + this.orbit.x
    const polar = clamp(tilt, 0.015, 1.14)
    this.camera.position.set(26 * Math.sin(polar) * Math.sin(azimuth), 26 * Math.cos(polar), 26 * Math.sin(polar) * Math.cos(azimuth))
    this.camera.lookAt(0, 0.28 * p, 0)
    this.camera.zoom = 1 - ease(p) * 0.24
    this.camera.updateProjectionMatrix()
    this.render()
  }

  private render() { if (!this.disposed) this.renderer.render(this.scene, this.camera) }

  private tick = (now: number) => {
    if (this.disposed) return
    if (this.running) {
      this.progress = clamp((now - this.playStart) / 4700)
      this.onProgress(Math.round(this.progress * 100))
      if (this.progress >= 1) this.running = false
    }
    this.applyProgress()
    if (this.running || this.dragging || this.orbit.distanceTo(this.targetOrbit) > 0.002) this.frame = requestAnimationFrame(this.tick)
    else this.frame = 0
  }

  private ensureFrame() { if (!this.frame) this.frame = requestAnimationFrame(this.tick) }

  replay() {
    if (this.disposed) return
    this.running = true
    this.progress = 0
    this.orbit.set(0, 0)
    this.targetOrbit.set(0, 0)
    this.playStart = performance.now()
    this.onProgress(0)
    this.ensureFrame()
  }

  /** 使用 0～100 的百分数手动定位生成进度，并停止自动播放。 */
  setProgress(percent: number) {
    this.running = false
    this.progress = clamp(percent / 100)
    this.onProgress(Math.round(this.progress * 100))
    this.applyProgress()
    this.ensureFrame()
  }

  resetView() {
    this.targetOrbit.set(0, 0)
    this.ensureFrame()
  }

  pointerDown(x: number, y: number) {
    if (this.progress < 0.75) return
    this.dragging = true
    this.lastPointer.set(x, y)
    this.ensureFrame()
  }

  pointerMove(x: number, y: number) {
    if (!this.dragging) return
    this.targetOrbit.x = clamp(this.targetOrbit.x + (x - this.lastPointer.x) * 0.005, -0.56, 0.56)
    this.targetOrbit.y = clamp(this.targetOrbit.y + (y - this.lastPointer.y) * 0.004, -0.22, 0.24)
    this.lastPointer.set(x, y)
  }

  pointerUp() { this.dragging = false }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    // 遍历时跳过共享几何与材质，随后集中释放；材质释放不会自动释放照片和立面纹理。
    this.city.traverse(object => {
      if (!(object instanceof Mesh)) return
      if (!this.sharedGeometries.includes(object.geometry as BoxGeometry)) object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (material !== this.roofMaterial && !this.facadeMaterials.includes(material as MeshStandardMaterial)) (material as Material).dispose()
      }
    })
    this.sharedGeometries.forEach(geometry => geometry.dispose())
    this.roofMaterial.dispose()
    this.facadeMaterials.forEach(material => material.dispose())
    this.facadeTextures.forEach(texture => texture.dispose())
    this.photo.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
