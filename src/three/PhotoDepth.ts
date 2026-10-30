import {
  CanvasTexture, Color, DoubleSide, EdgesGeometry, Group, LineBasicMaterial, LineSegments,
  LinearFilter, Mesh, MeshBasicMaterial,
  PerspectiveCamera, PlaneGeometry, Raycaster, Scene, SRGBColorSpace, Vector2,
  WebGLRenderer,
} from 'three'
import { publicAsset } from '../utils/publicAsset'

export type DepthFocus = 'background' | 'leaves' | 'petals' | 'spadix'

type Layer = {
  id: Exclude<DepthFocus, 'background'>
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>
  sharp: CanvasTexture
  soft: CanvasTexture
  alpha: Uint8ClampedArray
  outline: LineSegments<EdgesGeometry, LineBasicMaterial>
  baseX: number
  z: number
}

const W = 1024
const H = 768
const PLANE_H = 4.3
const PLANE_W = PLANE_H * (W / H)
const CAMERA_Z = 7.2
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const smooth = (a: number, b: number, n: number) => {
  const t = clamp((n - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function textureFrom(canvas: HTMLCanvasElement) {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 4
  return texture
}

// 基于默认素材的颜色差及归一化图像坐标构造软遮罩；阈值是针对该照片的经验参数。
function makeLayerCanvases(image: HTMLImageElement) {
  const source = document.createElement('canvas')
  source.width = W
  source.height = H
  const context = source.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0, W, H)
  const pixels = context.getImageData(0, 0, W, H).data
  const ids = ['leaves', 'petals', 'spadix'] as const
  const canvases = ids.map(() => {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    return canvas
  })
  const outputs = canvases.map(canvas => canvas.getContext('2d')!.createImageData(W, H))

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
      const px = x / W, py = y / H
      const warm = smooth(8, 38, r - g) * smooth(30, 83, r)
      const leafArea = smooth(0.54, 0.65, px) + smooth(0.54, 0.64, py)
      const leaf = clamp(leafArea, 0, 1) * smooth(4, 21, g - r * 0.78) * smooth(10, 37, g) * (1 - warm)
      // 默认照片的浅色花蕊位于橙色苞片内的斜线上；以下位置阈值只适用于该素材。
      const ax = 0.337, ay = 0.17, bx = 0.453, by = 0.512
      const t = clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2), 0, 1)
      const distance = Math.hypot(px - (ax + (bx - ax) * t), py - (ay + (by - ay) * t))
      const spadix = (1 - smooth(0.019, 0.036, distance)) * smooth(66, 138, g) * smooth(12, 60, g - b)
      const alphas = [leaf, warm, spadix]
      for (let layer = 0; layer < outputs.length; layer++) {
        const out = outputs[layer].data
        // 用右侧邻近花瓣颜色近似填补花蕊遮挡区，减轻图层分离后苞片上的暗缝。
        // 115 像素偏移为默认素材的经验值，不适用于通用图片修复。
        const fillIndex = (y * W + Math.min(W - 1, x + 115)) * 4
        const fill = layer === 1 ? spadix : 0
        out[i] = Math.round(r * (1 - fill) + pixels[fillIndex] * fill)
        out[i + 1] = Math.round(g * (1 - fill) + pixels[fillIndex + 1] * fill)
        out[i + 2] = Math.round(b * (1 - fill) + pixels[fillIndex + 2] * fill)
        out[i + 3] = Math.round(clamp(alphas[layer], 0, 1) * 255)
      }
    }
  }

  return ids.map((id, index) => {
    const canvas = canvases[index]
    canvas.getContext('2d')!.putImageData(outputs[index], 0, 0)
    const softCanvas = document.createElement('canvas')
    softCanvas.width = W
    softCanvas.height = H
    const softContext = softCanvas.getContext('2d')!
    softContext.filter = 'blur(7px)'
    softContext.drawImage(canvas, 0, 0)
    return { id, sharp: textureFrom(canvas), soft: textureFrom(softCanvas), alpha: outputs[index].data }
  })
}

/** 通过默认花卉图的颜色与位置规则生成图层，以平面视差和清晰／模糊纹理模拟景深。 */
export class PhotoDepth {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(38, 1, 0.1, 40)
  private group = new Group()
  private layers: Layer[] = []
  private backing?: Mesh<PlaneGeometry, MeshBasicMaterial>
  private observer: ResizeObserver
  private frame = 0
  private disposed = false
  private ready = false
  private focus: DepthFocus = 'petals'
  private exploded = false
  private strength = 1
  private drag = false
  private orbit = new Vector2()
  private targetOrbit = new Vector2()
  private fit = 1
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private raycaster = new Raycaster()

  constructor(
    private host: HTMLElement,
    private onFocus: (focus: DepthFocus) => void,
    private onError: () => void,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7))
    this.renderer.setClearColor(0x11120f, 0)
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    this.host.appendChild(this.renderer.domElement)
    this.scene.add(this.group)
    this.camera.position.z = CAMERA_Z
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()

    const image = new Image()
    image.onload = () => { if (!this.disposed) this.build(image) }
    image.onerror = () => { if (!this.disposed) this.onError() }
    image.src = publicAsset('images/anthurium.webp')
    this.frame = requestAnimationFrame(this.tick)
  }

  private build(image: HTMLImageElement) {
    const backingGeometry = new PlaneGeometry(PLANE_W, PLANE_H)
    const backingMaterial = new MeshBasicMaterial({ color: new Color('#100f0e'), side: DoubleSide })
    this.backing = new Mesh(backingGeometry, backingMaterial)
    this.backing.position.z = -1.35
    this.backing.scale.setScalar((CAMERA_Z + 1.35) / CAMERA_Z)
    this.group.add(this.backing)

    const extracted = makeLayerCanvases(image)
    const positions = [
      { z: -0.35, x: -0.5 },
      { z: 0.72, x: 0.46 },
      { z: 1.32, x: 1.45 },
    ]
    extracted.forEach((entry, index) => {
      const geometry = new PlaneGeometry(PLANE_W, PLANE_H)
      const material = new MeshBasicMaterial({ map: entry.sharp, transparent: true, depthWrite: false, side: DoubleSide })
      const mesh = new Mesh(geometry, material)
      const { z, x } = positions[index]
      mesh.position.z = z
      // 按相机到图层的距离补偿透视尺寸，使正视时不同深度的照片区域仍能对齐。
      mesh.scale.setScalar((CAMERA_Z - z) / CAMERA_Z)
      mesh.renderOrder = index + 1
      this.group.add(mesh)

      const outlineMaterial = new LineBasicMaterial({ color: 0xd7b496, transparent: true, opacity: 0, depthWrite: false })
      const borderPlane = new PlaneGeometry(PLANE_W, PLANE_H)
      const outline = new LineSegments(new EdgesGeometry(borderPlane), outlineMaterial)
      borderPlane.dispose()
      outline.position.z = z - 0.008
      outline.scale.copy(mesh.scale)
      outline.renderOrder = index + 1
      this.group.add(outline)
      this.layers.push({ id: entry.id, mesh, sharp: entry.sharp, soft: entry.soft, alpha: entry.alpha, outline, baseX: x, z })
    })
    this.ready = true
    this.updateFocus()
    this.resize()
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    const visibleH = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * CAMERA_Z
    const visibleW = visibleH * this.camera.aspect
    this.fit = Math.min(1, (visibleW * (width < 680 ? 1.17 : 0.97)) / PLANE_W)
    this.group.scale.setScalar(this.fit)
  }

  private tick = (now: number) => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.tick)
    const auto = this.reducedMotion || this.drag || this.exploded ? 0 : Math.sin(now * 0.00032) * 0.27
    this.orbit.lerp(this.targetOrbit, 0.075)
    this.camera.position.x = (this.orbit.x + auto) * this.strength
    this.camera.position.y = this.orbit.y * this.strength
    this.camera.lookAt(0, 0, 0)
    const spread = this.exploded ? 1 : 0
    this.group.rotation.y += ((this.exploded ? -0.22 : 0) - this.group.rotation.y) * 0.075
    if (this.backing) this.backing.position.x += ((this.exploded ? -1.45 : 0) - this.backing.position.x) * 0.075
    for (const layer of this.layers) {
      const destination = layer.baseX * spread
      layer.mesh.position.x += (destination - layer.mesh.position.x) * 0.075
      layer.outline.position.x = layer.mesh.position.x
      layer.outline.material.opacity += ((spread ? 0.21 : 0) - layer.outline.material.opacity) * 0.075
    }
    if (this.ready) this.renderer.render(this.scene, this.camera)
  }

  private updateFocus() {
    for (const layer of this.layers) {
      const crisp = this.focus === layer.id || (this.focus === 'petals' && layer.id === 'spadix')
      layer.mesh.material.map = crisp ? layer.sharp : layer.soft
      layer.mesh.material.needsUpdate = true
    }
  }

  setFocus(focus: DepthFocus) {
    this.focus = focus
    this.updateFocus()
    this.onFocus(focus)
  }

  /** 将视口 CSS 像素坐标转为 NDC 拾取；透过透明像素继续寻找后层，未命中时聚焦背景。 */
  focusAt(clientX: number, clientY: number) {
    if (!this.ready) return
    const bounds = this.host.getBoundingClientRect()
    const pointer = new Vector2(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1)
    this.raycaster.setFromCamera(pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.layers.map(layer => layer.mesh))
    for (const hit of hits) {
      const layer = this.layers.find(item => item.mesh === hit.object)
      if (!layer || !hit.uv) continue
      const x = clamp(Math.floor(hit.uv.x * W), 0, W - 1)
      // 射线 UV 原点在左下，Canvas 像素在左上；alpha > 85 是过滤半透明边缘的经验阈值。
      const y = clamp(Math.floor((1 - hit.uv.y) * H), 0, H - 1)
      if (layer.alpha[(y * W + x) * 4 + 3] > 85) { this.setFocus(layer.id); return }
    }
    this.setFocus('background')
  }

  movePointer(dx: number, dy: number) {
    this.drag = true
    this.targetOrbit.x = clamp(this.targetOrbit.x + dx * 0.007, -0.9, 0.9)
    this.targetOrbit.y = clamp(this.targetOrbit.y - dy * 0.005, -0.55, 0.55)
  }

  endPointer() { this.drag = false }

  setStrength(value: number) { this.strength = clamp(value, 0.2, 2) }
  setExploded(value: boolean) { this.exploded = value }
  reset() { this.targetOrbit.set(0, 0); this.setFocus('petals'); this.setExploded(false) }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    for (const layer of this.layers) {
      layer.mesh.geometry.dispose()
      layer.mesh.material.dispose()
      layer.sharp.dispose()
      layer.soft.dispose()
      layer.outline.geometry.dispose()
      layer.outline.material.dispose()
    }
    this.backing?.geometry.dispose()
    this.backing?.material.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
