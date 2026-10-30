import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  CanvasTexture,
} from 'three'

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// R 保存这一帧的高度，G 保存上一帧的高度。相邻像素会把扰动传出去。
const WAVE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform vec2 uFrom;
  uniform vec2 uTo;
  uniform float uBrush;
  uniform float uRadius;

  void main() {
    float current = texture2D(uState, vUv).r;
    float previous = texture2D(uState, vUv).g;
    float neighbors =
      texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r +
      texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r +
      texture2D(uState, vUv + vec2(0.0, uTexel.y)).r +
      texture2D(uState, vUv - vec2(0.0, uTexel.y)).r;
    float next = (neighbors * 0.5 - previous) * 0.984;

    // 把一次鼠标移动看作线段，快速划过时也不会断成零散的点。
    vec2 p = vec2(vUv.x * 0.75, vUv.y);
    vec2 a = vec2(uFrom.x * 0.75, uFrom.y);
    vec2 b = vec2(uTo.x * 0.75, uTo.y);
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.000001), 0.0, 1.0);
    float distanceToStroke = length(p - a - ab * t);
    float brush = exp(-pow(distanceToStroke / uRadius, 2.0) * 3.0) * uBrush;
    next = clamp(next + brush, -1.0, 1.0);
    gl_FragColor = vec4(next, current, 0.0, 1.0);
  }
`

// uTexel 是模拟纹理单像素的 UV 步长；波高梯度用于近似折射，并非物理水面法线。
// uStrength 放大采样偏移，色散与高光系数均为视觉经验值。
const POSTER_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uPoster;
  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform float uStrength;

  void main() {
    float left = texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r;
    float right = texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r;
    float down = texture2D(uState, vUv - vec2(0.0, uTexel.y)).r;
    float up = texture2D(uState, vUv + vec2(0.0, uTexel.y)).r;
    vec2 slope = vec2(right - left, up - down);
    vec2 offset = slope * (0.11 * uStrength);
    vec2 refractedUv = clamp(vUv - offset, vec2(0.001), vec2(0.999));

    // 很轻的色散和明暗变化，让位移更像透过水面看海报。
    float red = texture2D(uPoster, clamp(refractedUv + offset * 0.18, vec2(0.001), vec2(0.999))).r;
    vec4 base = texture2D(uPoster, refractedUv);
    float blue = texture2D(uPoster, clamp(refractedUv - offset * 0.18, vec2(0.001), vec2(0.999))).b;
    float shine = clamp((slope.x - slope.y) * 0.055 * uStrength, -0.06, 0.08);
    gl_FragColor = vec4(vec3(red, base.g, blue) + shine, 1.0);
  }
`

const SIM_WIDTH = 256
const SIM_HEIGHT = 342
const POSTER_WIDTH = 900
const POSTER_HEIGHT = 1200

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片读取失败，请换一张试试。'))
    image.src = source
  })
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement) {
  const scale = Math.max(POSTER_WIDTH / image.naturalWidth, POSTER_HEIGHT / image.naturalHeight)
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  context.drawImage(image, (POSTER_WIDTH - width) / 2, (POSTER_HEIGHT - height) / 2, width, height)
}

function makePoster(image: HTMLImageElement, isDefault: boolean): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = POSTER_WIDTH
  canvas.height = POSTER_HEIGHT
  const context = canvas.getContext('2d')!
  drawCover(context, image)

  if (isDefault) {
    const shade = context.createLinearGradient(0, 0, 0, POSTER_HEIGHT)
    shade.addColorStop(0, 'rgba(0, 13, 42, .43)')
    shade.addColorStop(.28, 'rgba(0, 13, 42, .04)')
    shade.addColorStop(.72, 'rgba(0, 13, 42, 0)')
    shade.addColorStop(1, 'rgba(0, 13, 42, .67)')
    context.fillStyle = shade
    context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)

    context.fillStyle = '#f6f7f2'
    context.textBaseline = 'top'
    context.font = '600 24px "Segoe UI", sans-serif'
    context.letterSpacing = '5px'
    context.fillText('VISUAL EXPERIMENT  /  002', 67, 62)
    context.letterSpacing = '0px'
    context.font = '700 154px "Microsoft YaHei", "PingFang SC", sans-serif'
    context.fillText('流动', 57, 135)
    context.font = '500 62px "Microsoft YaHei", "PingFang SC", sans-serif'
    context.fillText('于指尖', 67, 312)

    context.fillStyle = '#f59061'
    context.fillRect(69, 1051, 73, 5)
    context.fillStyle = '#f7f7f1'
    context.font = '500 26px "Microsoft YaHei", "PingFang SC", sans-serif'
    context.fillText('拨开画面，让水纹替你说话。', 68, 1073)
    context.font = '500 19px "Segoe UI", sans-serif'
    context.letterSpacing = '3px'
    context.fillText('MOVE  /  TOUCH  /  FEEL', 68, 1131)
  }

  const texture = new CanvasTexture(canvas)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  return texture
}

/** 使用双渲染目标迭代波高，再以波高梯度偏移海报采样；实例拥有模拟缓冲及海报纹理。 */
export class LiquidPoster {
  private renderer: WebGLRenderer
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private geometry = new PlaneGeometry(2, 2)
  private waveScene = new Scene()
  private posterScene = new Scene()
  private waveMaterial: ShaderMaterial
  private posterMaterial: ShaderMaterial
  private targets: [WebGLRenderTarget, WebGLRenderTarget]
  private currentTarget = 0
  private observer: ResizeObserver
  private frame = 0
  private posterTexture?: Texture
  private imageRequest = 0
  private previousPointer?: Vector2
  private pendingFrom = new Vector2(-10, -10)
  private pendingTo = new Vector2(-10, -10)
  private pendingBrush = 0
  private strength = 1
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private disposed = false

  constructor(private host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x06142d, 1)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.host.appendChild(this.renderer.domElement)

    const targetOptions = { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, stencilBuffer: false }
    this.targets = [new WebGLRenderTarget(SIM_WIDTH, SIM_HEIGHT, targetOptions), new WebGLRenderTarget(SIM_WIDTH, SIM_HEIGHT, targetOptions)]
    this.waveMaterial = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: WAVE_FRAGMENT,
      uniforms: {
        uState: { value: this.targets[0].texture },
        uTexel: { value: new Vector2(1 / SIM_WIDTH, 1 / SIM_HEIGHT) },
        uFrom: { value: this.pendingFrom },
        uTo: { value: this.pendingTo },
        uBrush: { value: 0 },
        uRadius: { value: .034 },
      },
    })
    this.posterMaterial = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: POSTER_FRAGMENT,
      uniforms: {
        uPoster: { value: null },
        uState: { value: this.targets[0].texture },
        uTexel: { value: new Vector2(1 / SIM_WIDTH, 1 / SIM_HEIGHT) },
        uStrength: { value: 1 },
      },
    })
    this.waveScene.add(new Mesh(this.geometry, this.waveMaterial))
    this.posterScene.add(new Mesh(this.geometry, this.posterMaterial))

    this.clear()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
    host.addEventListener('pointermove', this.onPointerMove)
    host.addEventListener('pointerdown', this.onPointerDown)
    host.addEventListener('pointerleave', this.onPointerLeave)
    this.frame = requestAnimationFrame(this.animate)
  }

  /** 替换海报并清空波场；isDefault 为真时叠加默认文案，过期请求不替换当前纹理。 */
  async setImage(source: string, isDefault = false) {
    const request = ++this.imageRequest
    const image = await loadImage(source)
    if (this.disposed || request !== this.imageRequest) return
    const texture = makePoster(image, isDefault)
    this.posterTexture?.dispose()
    this.posterTexture = texture
    this.posterMaterial.uniforms.uPoster.value = texture
    this.clear()
    if (!this.reducedMotion) this.splash(.53, .49)
  }

  setStrength(value: number) {
    this.strength = Math.max(.35, Math.min(2, value))
    this.posterMaterial.uniforms.uStrength.value = this.strength
  }

  /** 在 UV 坐标处注入一次扰动；约定 x、y 为 0～1，原点在左下角。 */
  splash(x = .5, y = .5) {
    this.pendingFrom.set(x, y)
    this.pendingTo.set(x, y)
    this.pendingBrush = .44 * this.strength
  }

  clear() {
    const previous = this.renderer.getRenderTarget()
    this.renderer.setClearColor(0x000000, 1)
    for (const target of this.targets) {
      this.renderer.setRenderTarget(target)
      this.renderer.clear()
    }
    this.renderer.setRenderTarget(previous)
    this.renderer.setClearColor(0x06142d, 1)
    this.currentTarget = 0
    this.pendingBrush = 0
  }

  // DOM 坐标以左上为原点，纹理 UV 以左下为原点，因此需要翻转 Y。
  private pointerUv(event: PointerEvent) {
    const bounds = this.host.getBoundingClientRect()
    return new Vector2(
      Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height)),
    )
  }

  private onPointerMove = (event: PointerEvent) => {
    const point = this.pointerUv(event)
    if (this.previousPointer) {
      this.pendingFrom.copy(this.previousPointer)
      this.pendingTo.copy(point)
      this.pendingBrush = .10 * this.strength
    }
    this.previousPointer = point
  }

  private onPointerDown = (event: PointerEvent) => {
    const point = this.pointerUv(event)
    this.splash(point.x, point.y)
    this.previousPointer = point
  }

  private onPointerLeave = () => {
    this.previousPointer = undefined
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(width, height, false)
  }

  private animate = () => {
    this.frame = requestAnimationFrame(this.animate)
    if (document.hidden || !this.posterTexture) return

    // 交替读取旧状态、写入另一目标，避免同一渲染过程中读写同一张纹理。
    const nextTarget = 1 - this.currentTarget
    this.waveMaterial.uniforms.uState.value = this.targets[this.currentTarget].texture
    this.waveMaterial.uniforms.uBrush.value = this.pendingBrush
    this.renderer.setRenderTarget(this.targets[nextTarget])
    this.renderer.render(this.waveScene, this.camera)
    this.renderer.setRenderTarget(null)
    this.currentTarget = nextTarget
    this.pendingBrush = 0

    this.posterMaterial.uniforms.uState.value = this.targets[this.currentTarget].texture
    this.renderer.render(this.posterScene, this.camera)
  }

  dispose() {
    this.disposed = true
    this.imageRequest++
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.host.removeEventListener('pointermove', this.onPointerMove)
    this.host.removeEventListener('pointerdown', this.onPointerDown)
    this.host.removeEventListener('pointerleave', this.onPointerLeave)
    this.posterTexture?.dispose()
    // 波场与海报的两个 Mesh 共用该几何，由实例统一释放一次。
    this.geometry.dispose()
    this.waveMaterial.dispose()
    this.posterMaterial.dispose()
    this.targets.forEach((target) => target.dispose())
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
