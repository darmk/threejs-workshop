import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  WebGLRenderer,
} from 'three'

const PHOTO_WIDTH = 4
// 完整消散重组周期，单位为毫秒；Shader 中的 uTime 则使用秒。
const BURST_DURATION = 2600

const photoVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vPosition;

  void main() {
    vUv = uv;
    vPosition = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const photoFragment = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uPointer;
  uniform float uHover;
  uniform float uBurst;
  varying vec2 vUv;
  varying vec2 vPosition;

  void main() {
    vec4 photo = texture2D(uTexture, vUv);
    float distanceToPointer = length(vPosition - uPointer);
    float opening = exp(-pow(distanceToPointer / 0.54, 2.0) * 1.5);
    float alpha = (1.0 - uBurst * 0.998) * (1.0 - opening * uHover * 0.88);
    gl_FragColor = vec4(photo.rgb, alpha * photo.a);
  }
`

// position 与 uPointer 均位于照片局部空间；aColor 为像素 RGB / 255，aSeed 为 [0, 1) 随机种子。
// uBurst 为消散包络强度，uPixelRatio 仅补偿屏幕点大小；位移幅度为视觉经验值。
const particleVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute vec3 aSeed;
  uniform vec2 uPointer;
  uniform float uHover;
  uniform float uBurst;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 delta = position.xy - uPointer;
    float distanceToPointer = length(delta);
    float influence = 1.0 - smoothstep(0.08, 0.82, distanceToPointer);
    vec2 direction = delta / max(distanceToPointer, 0.001);
    vec2 push = direction * influence * influence * 0.7 * uHover;

    vec3 scatter = (aSeed * 2.0 - 1.0) * vec3(1.9, 1.35, 2.15) * uBurst;
    scatter.xy += vec2(
      sin(uTime * 1.7 + aSeed.x * 31.0),
      cos(uTime * 1.4 + aSeed.y * 29.0)
    ) * 0.09 * uBurst;

    vec3 newPosition = position + scatter + vec3(push, influence * uHover * 0.28);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    gl_PointSize = (2.1 + aSeed.z * 2.0 + uBurst * 1.2) * uPixelRatio;
    vColor = aColor;
    vAlpha = clamp(uBurst * 1.15 + influence * uHover, 0.0, 1.0);
  }
`

const particleFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    float circle = 1.0 - smoothstep(0.27, 0.5, radius);
    if (circle < 0.01) discard;
    gl_FragColor = vec4(vColor, circle * vAlpha * 0.95);
  }
`

/** 将归一化时间映射为“散开、停留、重组”的强度；阶段比例为视觉节奏的经验取值。 */
function burstEnvelope(progress: number): number {
  if (progress <= 0 || progress >= 1) return 0
  if (progress < 0.34) return Math.sin((progress / 0.34) * Math.PI * 0.5)
  if (progress < 0.53) return 1
  const returning = (progress - 0.53) / 0.47
  return 1 - returning * returning * (3 - 2 * returning)
}

/** 管理照片平面与像素点云，共用交互 uniform 实现局部拨开及消散重组；实例拥有图片纹理。 */
export class ParticlePhoto {
  private readonly host: HTMLElement
  private readonly renderer: WebGLRenderer
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  private readonly scene = new Scene()
  private readonly imageGroup = new Group()
  private readonly pointer = new Vector2(999, 999)
  private readonly resizeObserver: ResizeObserver
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  private photo?: Mesh<PlaneGeometry, ShaderMaterial>
  private particles?: Points<BufferGeometry, ShaderMaterial>
  private texture?: Texture
  private imageAspect = 4 / 3
  private hover = 0
  private hoverTarget = 0
  private burstStart = -BURST_DURATION
  private raf = 0
  private loadVersion = 0
  private disposed = false

  constructor(host: HTMLElement) {
    this.host = host
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    this.host.appendChild(this.renderer.domElement)
    this.camera.position.z = 10
    this.scene.add(this.imageGroup)

    this.host.addEventListener('pointermove', this.onPointerMove)
    this.host.addEventListener('pointerleave', this.onPointerLeave)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.host)
    this.resize()
    this.animate()
  }

  /** 加载图片并重建点云；仅接受最后一次请求的结果，加载失败由调用方处理。 */
  async setImage(source: string): Promise<void> {
    const version = ++this.loadVersion
    const image = new Image()
    image.decoding = 'async'

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('图片加载失败，请换一张图片重试。'))
      image.src = source
    })

    // 旧图片可能较晚完成加载；版本检查同时阻止卸载后重建 GPU 资源。
    if (this.disposed || version !== this.loadVersion) return
    this.buildImage(image)
  }

  burst(): void {
    if (!this.photo || this.reducedMotion.matches) return
    this.burstStart = performance.now()
  }

  private buildImage(image: HTMLImageElement): void {
    this.clearImage()
    this.imageAspect = image.naturalWidth / image.naturalHeight
    const photoHeight = PHOTO_WIDTH / this.imageAspect
    const columns = Math.min(208, Math.max(116, Math.floor(this.host.clientWidth / 4.3)))
    const rows = Math.max(1, Math.round(columns / this.imageAspect))

    const sample = document.createElement('canvas')
    sample.width = columns
    sample.height = rows
    const context = sample.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法读取图片像素。')
    context.drawImage(image, 0, 0, columns, rows)
    const pixels = context.getImageData(0, 0, columns, rows).data

    const positions = new Float32Array(columns * rows * 3)
    const colors = new Float32Array(columns * rows * 3)
    const seeds = new Float32Array(columns * rows * 3)
    let count = 0

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const pixelIndex = (y * columns + x) * 4
        if (pixels[pixelIndex + 3] < 28) continue
        const index = count * 3
        positions[index] = ((x + 0.5) / columns - 0.5) * PHOTO_WIDTH
        positions[index + 1] = (0.5 - (y + 0.5) / rows) * photoHeight
        positions[index + 2] = 0.04
        colors[index] = pixels[pixelIndex] / 255
        colors[index + 1] = pixels[pixelIndex + 1] / 255
        colors[index + 2] = pixels[pixelIndex + 2] / 255
        seeds[index] = Math.random()
        seeds[index + 1] = Math.random()
        seeds[index + 2] = Math.random()
        count++
      }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions.subarray(0, count * 3), 3))
    geometry.setAttribute('aColor', new BufferAttribute(colors.subarray(0, count * 3), 3))
    geometry.setAttribute('aSeed', new BufferAttribute(seeds.subarray(0, count * 3), 3))
    geometry.computeBoundingSphere()

    this.texture = new Texture(image)
    this.texture.needsUpdate = true
    // 两套材质共享 uniform 包装对象，使照片透明度与粒子位移使用同一交互状态。
    const sharedUniforms = {
      uPointer: { value: this.pointer },
      uHover: { value: 0 },
      uBurst: { value: 0 },
    }
    const photoMaterial = new ShaderMaterial({
      uniforms: { ...sharedUniforms, uTexture: { value: this.texture } },
      vertexShader: photoVertex,
      fragmentShader: photoFragment,
      transparent: true,
      depthWrite: false,
    })
    const particleMaterial = new ShaderMaterial({
      uniforms: {
        ...sharedUniforms,
        uTime: { value: 0 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
    })

    this.photo = new Mesh(new PlaneGeometry(PHOTO_WIDTH, photoHeight), photoMaterial)
    this.particles = new Points(geometry, particleMaterial)
    this.photo.renderOrder = 0
    this.particles.renderOrder = 1
    this.imageGroup.add(this.photo, this.particles)
    this.resize()
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    const worldWidth = width / 100
    const worldHeight = height / 100
    this.camera.left = -worldWidth / 2
    this.camera.right = worldWidth / 2
    this.camera.top = worldHeight / 2
    this.camera.bottom = -worldHeight / 2
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height, false)

    const scale = Math.min((worldWidth * 0.78) / PHOTO_WIDTH, (worldHeight * 0.80) / (PHOTO_WIDTH / this.imageAspect))
    this.imageGroup.scale.setScalar(scale)
    if (this.particles) this.particles.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio()
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.photo || this.reducedMotion.matches) return
    const rect = this.host.getBoundingClientRect()
    // 屏幕坐标先转正交相机世界坐标，再除以图像组缩放，得到局部坐标；Y 轴向上。
    const worldX = ((event.clientX - rect.left) / rect.width - 0.5) * (this.camera.right - this.camera.left)
    const worldY = (0.5 - (event.clientY - rect.top) / rect.height) * (this.camera.top - this.camera.bottom)
    this.pointer.set(worldX / this.imageGroup.scale.x, worldY / this.imageGroup.scale.y)
    this.hoverTarget = Math.abs(this.pointer.x) < PHOTO_WIDTH / 2 + 0.3 && Math.abs(this.pointer.y) < PHOTO_WIDTH / this.imageAspect / 2 + 0.3 ? 1 : 0
  }

  private readonly onPointerLeave = (): void => {
    this.hoverTarget = 0
  }

  private readonly animate = (): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.animate)
    if (document.hidden) return

    const now = performance.now()
    this.hover += (this.hoverTarget - this.hover) * 0.12
    const burst = this.reducedMotion.matches ? 0 : burstEnvelope((now - this.burstStart) / BURST_DURATION)
    if (this.photo && this.particles) {
      this.photo.material.uniforms.uHover.value = this.hover
      this.photo.material.uniforms.uBurst.value = burst
      this.particles.material.uniforms.uHover.value = this.hover
      this.particles.material.uniforms.uBurst.value = burst
      this.particles.material.uniforms.uTime.value = now / 1000
    }
    this.renderer.render(this.scene, this.camera)
  }

  private clearImage(): void {
    if (this.photo) {
      this.imageGroup.remove(this.photo)
      this.photo.geometry.dispose()
      this.photo.material.dispose()
      this.photo = undefined
    }
    if (this.particles) {
      this.imageGroup.remove(this.particles)
      this.particles.geometry.dispose()
      this.particles.material.dispose()
      this.particles = undefined
    }
    this.texture?.dispose()
    this.texture = undefined
  }

  dispose(): void {
    this.disposed = true
    this.loadVersion++
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.host.removeEventListener('pointermove', this.onPointerMove)
    this.host.removeEventListener('pointerleave', this.onPointerLeave)
    this.clearImage()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
