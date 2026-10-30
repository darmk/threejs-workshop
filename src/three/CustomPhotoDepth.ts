import {
  CanvasTexture, DoubleSide, EdgesGeometry, Group, LineBasicMaterial, LineSegments,
  LinearFilter, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry,
  Raycaster, Scene, SRGBColorSpace, Vector2, WebGLRenderer,
} from 'three'

export type CustomDepthFocus = 'background' | 'middle' | 'foreground'

type ImageLayer = {
  id: Exclude<CustomDepthFocus, 'background'>
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>
  outline: LineSegments<EdgesGeometry, LineBasicMaterial>
  sharp: CanvasTexture
  soft: CanvasTexture
  alpha: Uint8ClampedArray
  targetX: number
}

const W = 1024
const H = 768
const PLANE_H = 4.3
const PLANE_W = PLANE_H * W / H
const CAMERA_Z = 7.2
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function newCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  return canvas
}

function texture(canvas: HTMLCanvasElement) {
  const result = new CanvasTexture(canvas)
  result.colorSpace = SRGBColorSpace
  result.minFilter = LinearFilter
  result.magFilter = LinearFilter
  result.anisotropy = 4
  return result
}

function softened(canvas: HTMLCanvasElement, radius: number) {
  const copy = newCanvas()
  const context = copy.getContext('2d')!
  context.filter = `blur(${radius}px)`
  context.drawImage(canvas, 0, 0)
  return texture(copy)
}

// 在宽高各缩至四分之一的图上，用可见邻域近似补全遮挡区，仅供小幅视差露出的缝隙使用。
// 这不是对原始背景的真实恢复，大幅展开时仍可能出现模糊或颜色扩散。
function backgroundFill(source: HTMLCanvasElement, nearMask: HTMLCanvasElement, middleMask?: HTMLCanvasElement) {
  const sw = 256, sh = 192, count = sw * sh
  const smallPhoto = document.createElement('canvas')
  smallPhoto.width = sw; smallPhoto.height = sh
  const photoContext = smallPhoto.getContext('2d', { willReadFrequently: true })!
  photoContext.drawImage(source, 0, 0, sw, sh)
  const photo = photoContext.getImageData(0, 0, sw, sh)
  const smallMask = document.createElement('canvas')
  smallMask.width = sw; smallMask.height = sh
  const maskContext = smallMask.getContext('2d', { willReadFrequently: true })!
  maskContext.drawImage(nearMask, 0, 0, sw, sh)
  if (middleMask) maskContext.drawImage(middleMask, 0, 0, sw, sh)
  const mask = maskContext.getImageData(0, 0, sw, sh).data
  let seeds = new Int32Array(count)
  let next = new Int32Array(count)
  for (let i = 0; i < count; i++) seeds[i] = mask[i * 4 + 3] > 24 ? -1 : i

  // 以逐次减半的步长传播最近可见种子；双缓冲避免同一轮扫描方向影响邻域读取。
  for (let step = 128; step >= 1; step >>= 1) {
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const p = y * sw + x
        if (mask[p * 4 + 3] <= 24) { next[p] = p; continue }
        let best = seeds[p]
        let bestDistance = best < 0 ? Number.POSITIVE_INFINITY : (x - best % sw) ** 2 + (y - Math.floor(best / sw)) ** 2
        for (let dy = -step; dy <= step; dy += step) {
          const sy = y + dy
          if (sy < 0 || sy >= sh) continue
          for (let dx = -step; dx <= step; dx += step) {
            const sx = x + dx
            if (sx < 0 || sx >= sw) continue
            const candidate = seeds[sy * sw + sx]
            if (candidate < 0) continue
            const distance = (x - candidate % sw) ** 2 + (y - Math.floor(candidate / sw)) ** 2
            if (distance < bestDistance) { best = candidate; bestDistance = distance }
          }
        }
        next[p] = best
      }
    }
    ;[seeds, next] = [next, seeds]
  }

  const colors = new Float32Array(count * 3)
  const hidden: number[] = []
  for (let i = 0; i < count; i++) {
    const chosen = mask[i * 4 + 3] > 24 && seeds[i] >= 0 ? seeds[i] : i
    const sourceOffset = chosen * 4, targetOffset = i * 3
    colors[targetOffset] = photo.data[sourceOffset]
    colors[targetOffset + 1] = photo.data[sourceOffset + 1]
    colors[targetOffset + 2] = photo.data[sourceOffset + 2]
    if (mask[i * 4 + 3] > 24 && i >= sw && i < count - sw && i % sw > 0 && i % sw < sw - 1) hidden.push(i)
  }
  // 只在遮挡区扩散颜色，可见像素作为固定边界，减轻最近种子填色产生的放射状条纹。
  // 460 次迭代为视觉平滑程度与处理耗时之间的经验取值。
  for (let pass = 0; pass < 460; pass++) {
    for (const pixel of hidden) {
      const index = pixel * 3
      for (let channel = 0; channel < 3; channel++) {
        colors[index + channel] = (
          colors[index - 3 + channel] + colors[index + 3 + channel]
          + colors[index - sw * 3 + channel] + colors[index + sw * 3 + channel]
        ) * 0.25
      }
    }
  }
  const filled = photoContext.createImageData(sw, sh)
  for (let i = 0; i < count; i++) {
    const targetOffset = i * 4, sourceOffset = i * 3
    filled.data[targetOffset] = colors[sourceOffset]
    filled.data[targetOffset + 1] = colors[sourceOffset + 1]
    filled.data[targetOffset + 2] = colors[sourceOffset + 2]
    filled.data[targetOffset + 3] = 255
  }
  photoContext.putImageData(filled, 0, 0)
  const large = newCanvas()
  const largeContext = large.getContext('2d', { willReadFrequently: true })!
  largeContext.drawImage(smallPhoto, 0, 0, W, H)
  return largeContext.getImageData(0, 0, W, H).data
}

function splitPhoto(source: HTMLCanvasElement, nearMask: HTMLCanvasElement, middleMask?: HTMLCanvasElement) {
  const sourceData = source.getContext('2d')!.getImageData(0, 0, W, H).data
  const nearData = nearMask.getContext('2d')!.getImageData(0, 0, W, H).data
  const middleData = middleMask?.getContext('2d')!.getImageData(0, 0, W, H).data
  const filledData = backgroundFill(source, nearMask, middleMask)

  const background = newCanvas()
  const near = newCanvas()
  const middle = newCanvas()
  const backgroundImage = background.getContext('2d')!.createImageData(W, H)
  const nearImage = near.getContext('2d')!.createImageData(W, H)
  const middleImage = middle.getContext('2d')!.createImageData(W, H)

  for (let i = 0; i < sourceData.length; i += 4) {
    const nearAlpha = nearData[i + 3] / 255
    // 前景遮罩优先，中景透明度扣除前景覆盖，避免同一像素在两层重复显露。
    const middleAlpha = (middleData?.[i + 3] ?? 0) / 255 * (1 - nearAlpha)
    const covered = Math.max(nearAlpha, middleAlpha)
    for (let channel = 0; channel < 3; channel++) {
      backgroundImage.data[i + channel] = Math.round(sourceData[i + channel] * (1 - covered) + filledData[i + channel] * covered)
      nearImage.data[i + channel] = sourceData[i + channel]
      middleImage.data[i + channel] = sourceData[i + channel]
    }
    backgroundImage.data[i + 3] = 255
    nearImage.data[i + 3] = Math.round(nearAlpha * 255)
    middleImage.data[i + 3] = Math.round(middleAlpha * 255)
  }

  background.getContext('2d')!.putImageData(backgroundImage, 0, 0)
  near.getContext('2d')!.putImageData(nearImage, 0, 0)
  middle.getContext('2d')!.putImageData(middleImage, 0, 0)
  return {
    background: { sharp: texture(background), soft: softened(background, 3) },
    near: { sharp: texture(near), soft: softened(near, 7), alpha: nearImage.data },
    middle: { sharp: texture(middle), soft: softened(middle, 7), alpha: middleImage.data },
  }
}

/** 按用户遮罩拆分照片、补全遮挡区，以分层平面呈现视差；不推断真实深度。 */
export class CustomPhotoDepth {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(38, 1, 0.1, 40)
  private group = new Group()
  private background: Mesh<PlaneGeometry, MeshBasicMaterial>
  private backgroundSharp: CanvasTexture
  private backgroundSoft: CanvasTexture
  private layers: ImageLayer[] = []
  private observer: ResizeObserver
  private frame = 0
  private disposed = false
  private focus: CustomDepthFocus = 'foreground'
  private exploded = false
  private strength = 1
  private drag = false
  private orbit = new Vector2()
  private targetOrbit = new Vector2()
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private raycaster = new Raycaster()

  constructor(
    private host: HTMLElement,
    source: HTMLCanvasElement,
    nearMask: HTMLCanvasElement,
    middleMask: HTMLCanvasElement | undefined,
    private onFocus: (focus: CustomDepthFocus) => void,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7))
    this.renderer.setClearColor(0x11120f, 0)
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    this.host.appendChild(this.renderer.domElement)
    this.scene.add(this.group)
    this.camera.position.z = CAMERA_Z

    const extracted = splitPhoto(source, nearMask, middleMask)
    this.backgroundSharp = extracted.background.sharp
    this.backgroundSoft = extracted.background.soft
    const backing = new MeshBasicMaterial({ map: this.backgroundSoft, side: DoubleSide })
    this.background = new Mesh(new PlaneGeometry(PLANE_W, PLANE_H), backing)
    this.background.position.z = -1.25
    this.background.scale.setScalar((CAMERA_Z + 1.25) / CAMERA_Z)
    this.group.add(this.background)

    if (middleMask) this.addLayer('middle', extracted.middle, -0.25, -0.2)
    this.addLayer('foreground', extracted.near, 1.1, 1.25)
    this.updateFocus()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
    this.frame = requestAnimationFrame(this.tick)
  }

  private addLayer(
    id: ImageLayer['id'],
    entry: { sharp: CanvasTexture; soft: CanvasTexture; alpha: Uint8ClampedArray },
    z: number,
    targetX: number,
  ) {
    const mesh = new Mesh(
      new PlaneGeometry(PLANE_W, PLANE_H),
      new MeshBasicMaterial({ map: entry.sharp, transparent: true, depthWrite: false, side: DoubleSide }),
    )
    mesh.position.z = z
    // 补偿深度引起的透视尺寸变化，使正视时图层和背景仍保持照片对齐。
    mesh.scale.setScalar((CAMERA_Z - z) / CAMERA_Z)
    mesh.renderOrder = id === 'middle' ? 1 : 2
    this.group.add(mesh)

    const borderPlane = new PlaneGeometry(PLANE_W, PLANE_H)
    const outline = new LineSegments(
      new EdgesGeometry(borderPlane),
      new LineBasicMaterial({ color: 0xc8b9a8, transparent: true, opacity: 0, depthWrite: false }),
    )
    borderPlane.dispose()
    outline.position.z = z - 0.008
    outline.scale.copy(mesh.scale)
    outline.renderOrder = mesh.renderOrder
    this.group.add(outline)
    this.layers.push({ id, mesh, outline, sharp: entry.sharp, soft: entry.soft, alpha: entry.alpha, targetX })
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    const visibleH = 2 * Math.tan(this.camera.fov * Math.PI / 360) * CAMERA_Z
    const visibleW = visibleH * this.camera.aspect
    this.group.scale.setScalar(Math.min(1, visibleW * (width < 680 ? 1.17 : 0.97) / PLANE_W))
  }

  private tick = (now: number) => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.tick)
    const auto = this.reducedMotion || this.drag || this.exploded ? 0 : Math.sin(now * 0.00032) * 0.27
    this.orbit.lerp(this.targetOrbit, 0.075)
    this.camera.position.x = (this.orbit.x + auto) * this.strength
    this.camera.position.y = this.orbit.y * this.strength
    this.camera.lookAt(0, 0, 0)
    this.group.rotation.y += ((this.exploded ? -0.22 : 0) - this.group.rotation.y) * 0.075
    this.background.position.x += ((this.exploded ? -1.15 : 0) - this.background.position.x) * 0.075
    for (const layer of this.layers) {
      layer.mesh.position.x += ((this.exploded ? layer.targetX : 0) - layer.mesh.position.x) * 0.075
      layer.outline.position.x = layer.mesh.position.x
      layer.outline.material.opacity += ((this.exploded ? 0.23 : 0) - layer.outline.material.opacity) * 0.075
    }
    this.renderer.render(this.scene, this.camera)
  }

  private updateFocus() {
    this.background.material.map = this.focus === 'background' ? this.backgroundSharp : this.backgroundSoft
    this.background.material.needsUpdate = true
    for (const layer of this.layers) {
      layer.mesh.material.map = this.focus === layer.id ? layer.sharp : layer.soft
      layer.mesh.material.needsUpdate = true
    }
  }

  setFocus(focus: CustomDepthFocus) {
    if (focus === 'middle' && !this.layers.some(layer => layer.id === 'middle')) return
    this.focus = focus
    this.updateFocus()
    this.onFocus(focus)
  }

  /** 将视口 CSS 像素坐标转为 NDC 拾取；透过透明像素继续寻找后层，未命中时聚焦背景。 */
  focusAt(clientX: number, clientY: number) {
    const bounds = this.host.getBoundingClientRect()
    const pointer = new Vector2((clientX - bounds.left) / bounds.width * 2 - 1, -(clientY - bounds.top) / bounds.height * 2 + 1)
    this.raycaster.setFromCamera(pointer, this.camera)
    for (const hit of this.raycaster.intersectObjects(this.layers.map(layer => layer.mesh))) {
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
  reset() { this.targetOrbit.set(0, 0); this.setFocus('foreground'); this.setExploded(false) }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    for (const layer of this.layers) {
      layer.mesh.geometry.dispose()
      layer.mesh.material.dispose()
      layer.outline.geometry.dispose()
      layer.outline.material.dispose()
      layer.sharp.dispose()
      layer.soft.dispose()
    }
    this.background.geometry.dispose()
    this.background.material.dispose()
    this.backgroundSharp.dispose()
    this.backgroundSoft.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
