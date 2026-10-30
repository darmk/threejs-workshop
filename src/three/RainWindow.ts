import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  WebGLRenderer,
} from 'three'
import { publicAsset } from '../utils/publicAsset'

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// uDrops 的红通道表示近似水滴高度，uWipe 的红通道表示擦净程度（白色为清晰）。
// 高度差近似折射方向，uDropResolution 提供采样步长；城市纹理按 cover 方式居中裁切。
const FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uCity;
  uniform sampler2D uDrops;
  uniform sampler2D uWipe;
  uniform vec2 uResolution;
  uniform vec2 uDropResolution;
  uniform float uImageAspect;
  uniform float uRain;
  uniform float uFlash;

  vec2 cover(vec2 uv) {
    float viewAspect = uResolution.x / uResolution.y;
    if (viewAspect > uImageAspect) {
      uv.y = (uv.y - 0.5) * uImageAspect / viewAspect + 0.5;
    } else {
      uv.x = (uv.x - 0.5) * viewAspect / uImageAspect + 0.5;
    }
    return uv;
  }

  vec3 city(vec2 uv) {
    return texture2D(uCity, cover(clamp(uv, 0.0, 1.0))).rgb;
  }

  void main() {
    vec2 pixel = 1.0 / uDropResolution;
    float h = texture2D(uDrops, vUv).r;
    float left = texture2D(uDrops, vUv - vec2(pixel.x, 0.0)).r;
    float right = texture2D(uDrops, vUv + vec2(pixel.x, 0.0)).r;
    float down = texture2D(uDrops, vUv - vec2(0.0, pixel.y)).r;
    float up = texture2D(uDrops, vUv + vec2(0.0, pixel.y)).r;
    vec2 normal = vec2(left - right, down - up);
    float wiped = texture2D(uWipe, vUv).r;
    float wet = 1.0 - wiped;

    vec2 bend = normal * (0.075 + 0.022 * uRain) * wet;
    bend = clamp(bend, vec2(-0.034), vec2(0.034));
    vec2 distorted = clamp(vUv + bend, 0.0, 1.0);
    vec2 blurStep = vec2(5.0) / uResolution;
    vec3 sharp = city(distorted);
    vec3 blurred = sharp * 0.28;
    blurred += city(distorted + vec2(blurStep.x, 0.0)) * 0.13;
    blurred += city(distorted - vec2(blurStep.x, 0.0)) * 0.13;
    blurred += city(distorted + vec2(0.0, blurStep.y)) * 0.13;
    blurred += city(distorted - vec2(0.0, blurStep.y)) * 0.13;
    blurred += city(distorted + blurStep * 1.5) * 0.10;
    blurred += city(distorted - blurStep * 1.5) * 0.10;

    float focus = clamp(wiped * 0.96 + smoothstep(0.12, 0.68, h) * 0.35, 0.0, 1.0);
    vec3 color = mix(blurred, sharp, focus);
    float rim = clamp(length(normal) * 2.9, 0.0, 1.0);
    float catchlight = max(0.0, dot(normalize(normal + vec2(0.0001)), normalize(vec2(-0.68, 0.73))));
    color += vec3(0.32, 0.53, 0.64) * rim * catchlight * wet * 0.56;
    color -= vec3(0.07, 0.11, 0.13) * h * wet * 0.28;

    float vignette = 1.0 - 0.27 * pow(length((vUv - 0.5) * vec2(1.2, 0.9)), 1.8);
    color *= vignette;
    color += vec3(0.68, 0.78, 0.92) * uFlash * 0.46;
    color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.009;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

type Drop = { x: number; y: number; radius: number; speed: number; length: number; drift: number }

const random = (min: number, max: number) => min + Math.random() * (max - min)

function canvas2d() {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('无法创建雨滴画布')
  return { canvas, context }
}

function makeDropSprite() {
  const { canvas, context } = canvas2d()
  canvas.width = canvas.height = 64
  const gradient = context.createRadialGradient(28, 25, 2, 32, 32, 30)
  gradient.addColorStop(0, '#fff')
  gradient.addColorStop(0.48, '#dedede')
  gradient.addColorStop(0.76, '#555')
  gradient.addColorStop(1, '#000')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  return canvas
}

/** 在 Canvas 上更新雨滴高度图与擦拭遮罩，由 Shader 合成折射、模糊及闪电。 */
export class RainWindow {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private geometry = new PlaneGeometry(2, 2)
  private material: ShaderMaterial
  private cityTexture: Texture
  private rainCanvas = canvas2d()
  private staticCanvas = canvas2d()
  private wipeCanvas = canvas2d()
  private rainTexture: CanvasTexture
  private wipeTexture: CanvasTexture
  private sprite = makeDropSprite()
  private drops: Drop[] = []
  private observer: ResizeObserver
  private frame = 0
  private lastFrame = 0
  private flash = 0
  private rain = 1
  private paused = false
  private disposed = false
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(private host: HTMLElement, private onError?: () => void) {
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.host.appendChild(this.renderer.domElement)

    const fallback = new DataTexture(new Uint8Array([11, 20, 30, 255]), 1, 1)
    fallback.needsUpdate = true
    fallback.colorSpace = SRGBColorSpace
    this.cityTexture = fallback

    this.rainTexture = new CanvasTexture(this.rainCanvas.canvas)
    this.wipeTexture = new CanvasTexture(this.wipeCanvas.canvas)
    for (const texture of [this.rainTexture, this.wipeTexture]) {
      texture.minFilter = LinearFilter
      texture.magFilter = LinearFilter
      texture.wrapS = ClampToEdgeWrapping
      texture.wrapT = ClampToEdgeWrapping
    }

    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCity: { value: this.cityTexture },
        uDrops: { value: this.rainTexture },
        uWipe: { value: this.wipeTexture },
        uResolution: { value: new Vector2(1, 1) },
        uDropResolution: { value: new Vector2(1, 1) },
        uImageAspect: { value: 16 / 9 },
        uRain: { value: this.rain },
        uFlash: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.scene.add(new Mesh(this.geometry, this.material))

    new TextureLoader().load(
      publicAsset('images/rain-night-city.webp'),
      texture => {
        if (this.disposed) { texture.dispose(); return }
        texture.colorSpace = SRGBColorSpace
        texture.minFilter = LinearFilter
        this.cityTexture.dispose()
        this.cityTexture = texture
        this.material.uniforms.uCity.value = texture
        this.material.uniforms.uImageAspect.value = texture.image.width / texture.image.height
      },
      undefined,
      () => this.onError?.(),
    )

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(this.host)
    this.resize()
    this.frame = requestAnimationFrame(this.animate)
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(width, height, false)
    this.material.uniforms.uResolution.value.set(width * ratio, height * ratio)

    const mapWidth = Math.max(320, Math.min(900, Math.round(width * 0.8)))
    const mapHeight = Math.max(300, Math.min(650, Math.round(height * 0.8)))
    if (this.rainCanvas.canvas.width === mapWidth && this.rainCanvas.canvas.height === mapHeight) return
    for (const layer of [this.rainCanvas, this.staticCanvas, this.wipeCanvas]) {
      layer.canvas.width = mapWidth
      layer.canvas.height = mapHeight
    }
    this.material.uniforms.uDropResolution.value.set(mapWidth, mapHeight)
    this.makeStaticDrops()
    this.makeMovingDrops()
    this.wipeCanvas.context.fillStyle = '#000'
    this.wipeCanvas.context.fillRect(0, 0, mapWidth, mapHeight)
    this.wipeTexture.needsUpdate = true
  }

  private makeStaticDrops() {
    const { canvas, context } = this.staticCanvas
    context.fillStyle = '#000'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const count = Math.round(canvas.width * canvas.height / 1900)
    for (let i = 0; i < count; i++) {
      const radius = random(1.5, 4.5) + Math.pow(Math.random(), 8) * 7
      context.globalAlpha = random(0.45, 0.9)
      context.drawImage(this.sprite, random(0, canvas.width), random(0, canvas.height), radius * 2, radius * random(2, 3.1))
    }
    context.globalAlpha = 1
  }

  private makeMovingDrops() {
    const { width, height } = this.rainCanvas.canvas
    this.drops = Array.from({ length: 85 }, () => ({
      x: random(0, width), y: random(-height, height), radius: random(2.5, 7.5),
      speed: random(30, 100), length: random(12, 90), drift: random(-0.14, 0.14),
    }))
  }

  private paintRain(dt: number) {
    const { canvas, context } = this.rainCanvas
    context.drawImage(this.staticCanvas.canvas, 0, 0)
    const count = Math.round(this.drops.length * this.rain / 1.7)
    for (let i = 0; i < count; i++) {
      const drop = this.drops[i]
      if (!this.paused && !this.reducedMotion) {
        drop.y += drop.speed * dt * (0.45 + this.rain * 0.8)
        drop.x += drop.drift * dt * 10
      }
      if (drop.y > canvas.height + drop.length) {
        drop.y = -random(20, canvas.height * 0.55)
        drop.x = random(0, canvas.width)
      }
      context.strokeStyle = 'rgba(170, 170, 170, 0.27)'
      context.lineWidth = Math.max(1, drop.radius * 0.38)
      context.lineCap = 'round'
      context.beginPath()
      context.moveTo(drop.x - drop.drift * 12, drop.y - drop.length)
      context.lineTo(drop.x, drop.y)
      context.stroke()
      context.globalAlpha = 0.8
      context.drawImage(this.sprite, drop.x - drop.radius, drop.y - drop.radius * 1.4, drop.radius * 2, drop.radius * 2.8)
    }
    context.globalAlpha = 1
    this.rainTexture.needsUpdate = true
  }

  // 每次绘制以低透明黑色覆盖遮罩，模拟重新起雾；衰减按绘制次数而非按秒计算。
  private fadeWipe() {
    const { canvas, context } = this.wipeCanvas
    context.fillStyle = 'rgba(0, 0, 0, 0.0015)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    this.wipeTexture.needsUpdate = true
  }

  /** 输入视口 CSS 像素坐标；previous 为上一采样点，用连续线段连接擦拭轨迹。 */
  wipeAt(clientX: number, clientY: number, previous?: { x: number; y: number }) {
    const bounds = this.host.getBoundingClientRect()
    const { canvas, context } = this.wipeCanvas
    const x = (clientX - bounds.left) / bounds.width * canvas.width
    const y = (clientY - bounds.top) / bounds.height * canvas.height
    const fromX = previous ? (previous.x - bounds.left) / bounds.width * canvas.width : x
    const fromY = previous ? (previous.y - bounds.top) / bounds.height * canvas.height : y
    context.strokeStyle = '#fff'
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = Math.max(42, canvas.width * 0.075)
    context.beginPath()
    context.moveTo(fromX, fromY)
    context.lineTo(x, y)
    context.stroke()
    this.wipeTexture.needsUpdate = true
  }

  wipeCenter() {
    const bounds = this.host.getBoundingClientRect()
    const y = bounds.top + bounds.height * 0.51
    for (let i = 0; i <= 12; i++) {
      const x = bounds.left + bounds.width * (0.24 + i / 12 * 0.52)
      this.wipeAt(x, y + Math.sin(i / 12 * Math.PI) * 18)
    }
  }

  reset() {
    const { canvas, context } = this.wipeCanvas
    context.fillStyle = '#000'
    context.fillRect(0, 0, canvas.width, canvas.height)
    this.wipeTexture.needsUpdate = true
    this.makeStaticDrops()
    this.makeMovingDrops()
  }

  lightning() {
    if (!this.reducedMotion) this.flash = 1
  }

  setRain(value: number) {
    this.rain = Math.max(0.35, Math.min(1.7, value))
    this.material.uniforms.uRain.value = this.rain
  }

  setPaused(value: boolean) { this.paused = value }

  private animate = (now: number) => {
    this.frame = requestAnimationFrame(this.animate)
    if (document.hidden || now - this.lastFrame < (this.reducedMotion ? 100 : 30)) return
    const dt = Math.min(0.06, this.lastFrame ? (now - this.lastFrame) / 1000 : 0)
    this.lastFrame = now
    this.flash = Math.max(0, this.flash - dt * 1.8)
    this.material.uniforms.uFlash.value = this.flash * this.flash
    this.paintRain(dt)
    if (!this.paused && !this.reducedMotion) this.fadeWipe()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.geometry.dispose()
    this.material.dispose()
    this.cityTexture.dispose()
    this.rainTexture.dispose()
    this.wipeTexture.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
