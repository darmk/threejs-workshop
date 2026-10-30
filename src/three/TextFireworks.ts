import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  OrthographicCamera,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three'

const VIEW_HEIGHT = 5.8
const TEXT_SCALE = 0.007
const CANVAS_WIDTH = 1400
const CANVAS_HEIGHT = 380
// 以 Canvas 像素为单位的采样间隔；当前值为文字清晰度与点数量的经验折中。
const SAMPLE_STEP = 3
const DURATION = 5.6
const COLORS = [
  [1.0, 0.48, 0.31],
  [1.0, 0.76, 0.39],
  [0.50, 0.83, 1.0],
  [0.82, 0.62, 1.0],
]
const CENTERS = [
  [-2.85, 0.56],
  [-0.95, 1.05],
  [1.05, 0.68],
  [2.85, 1.08],
]

// position 是文字归位位置；aCenter、aBurst 分别指定升空聚合点与绽放偏移，均在局部 XY 平面。
// uPhase、aDelay、uTrail 以秒计，负 uPhase 表示待机；拖尾以时间偏移重绘同一批点，无需历史帧缓存。
const VERTEX = /* glsl */ `
  attribute vec2 aCenter;
  attribute vec2 aBurst;
  attribute vec3 aColor;
  attribute float aDelay;
  attribute float aSize;
  attribute float aSeed;
  uniform float uPhase;
  uniform float uClock;
  uniform float uScale;
  uniform float uFireworkScale;
  uniform float uPixelRatio;
  uniform float uTrail;
  uniform float uSizeScale;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 pos = position;
    float phase = uPhase - uTrail;
    float twinkle = 0.88 + 0.12 * sin(uClock * (2.2 + aSeed * 2.0) + aSeed * 28.0);

    if (phase < 0.0) {
      vAlpha = uTrail > 0.0 ? 0.0 : twinkle;
      vColor = vec3(1.0, 0.83, 0.68);
    } else {
      float local = phase - aDelay;
      float lift = smoothstep(0.0, 0.86, local);
      vec3 center = vec3(aCenter * uFireworkScale, 0.0);
      pos = mix(position, center, lift);
      pos.x += sin(lift * 3.14159) * (aSeed - 0.5) * 0.34;

      float burstTime = max(local - 0.86, 0.0);
      float spread = 1.0 - exp(-burstTime * 2.7);
      pos.xy += aBurst * spread * uFireworkScale;
      pos.y -= burstTime * burstTime * 0.18;

      float burstAlpha = local < 0.86 ? 0.95 : min(1.0, 1.35 * exp(-burstTime * 0.62));
      float returnProgress = smoothstep(4.25, 5.45, phase);
      pos = mix(pos, position, returnProgress);
      vAlpha = mix(burstAlpha, twinkle, returnProgress);
      if (uTrail > 0.0) vAlpha *= 0.33 * (1.0 - returnProgress);
      vColor = mix(vec3(1.0, 0.83, 0.68), aColor, smoothstep(0.15, 1.0, local) * (1.0 - returnProgress));
    }

    pos.xy *= uScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = min(18.0, aSize * uPixelRatio * uSizeScale);
  }
`

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float radius = length(p);
    float core = 1.0 - smoothstep(0.04, 0.24, radius);
    float glow = exp(-radius * radius * 15.0) * 0.38;
    float alpha = (core * 0.72 + glow) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
  }
`

function makeMaterial(trail: number, sizeScale: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uPhase: { value: -1 },
      uClock: { value: 0 },
      uScale: { value: 1 },
      uFireworkScale: { value: 1 },
      uPixelRatio: { value: 1 },
      uTrail: { value: trail },
      uSizeScale: { value: sizeScale },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  })
}

function makeStars() {
  const positions: number[] = []
  const colors: number[] = []
  for (let i = 0; i < 220; i++) {
    positions.push((Math.random() - 0.5) * 15, (Math.random() - 0.5) * 7.4, -0.5)
    const tint = Math.random()
    const color = tint < 0.7 ? new Color(0x899caf) : new Color(0xffd8ae)
    colors.push(color.r, color.g, color.b)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  const material = new PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  return new Points(geometry, material)
}

/** 将文字像素采样为点云，用共享几何和两套材质绘制烟花主体与延时拖尾。 */
export class TextFireworks {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new OrthographicCamera(-5, 5, VIEW_HEIGHT / 2, -VIEW_HEIGHT / 2, 0.1, 10)
  private mainMaterial = makeMaterial(0, 1)
  private trailMaterial = makeMaterial(0.105, 1.42)
  private stars = makeStars()
  private geometry?: BufferGeometry
  private mainPoints?: Points
  private trailPoints?: Points
  private observer: ResizeObserver
  private frame = 0
  private launchStart = -1
  private textWidth = 8
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(private host: HTMLElement, text: string) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.host.appendChild(this.renderer.domElement)
    this.camera.position.z = 5
    this.scene.add(this.stars)
    this.setText(text)
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
    this.frame = requestAnimationFrame(this.animate)
  }

  setText(value: string) {
    const text = Array.from(value.trim()).slice(0, 12).join('') || '好事正在发生'
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const characters = Array.from(text)
    const multiline = this.host.clientWidth < 600 && characters.length > 6
    const lines = multiline
      ? [characters.slice(0, Math.ceil(characters.length / 2)).join(''), characters.slice(Math.ceil(characters.length / 2)).join('')]
      : [text]

    context.fillStyle = '#fff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    let fontSize = multiline ? 154 : 164
    context.font = `700 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`
    const widest = Math.max(...lines.map((line) => context.measureText(line).width))
    fontSize *= Math.min(1, 1250 / widest)
    context.font = `700 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`
    lines.forEach((line, index) => context.fillText(line, CANVAS_WIDTH / 2, multiline ? 112 + index * 155 : CANVAS_HEIGHT / 2))

    const pixels = context.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data
    const positions: number[] = []
    const bursts: number[] = []
    const centers: number[] = []
    const colors: number[] = []
    const delays: number[] = []
    const sizes: number[] = []
    const seeds: number[] = []
    let minX = CANVAS_WIDTH
    let maxX = 0

    for (let y = 0; y < CANVAS_HEIGHT; y += SAMPLE_STEP) {
      for (let x = 0; x < CANVAS_WIDTH; x += SAMPLE_STEP) {
        if (pixels[(y * CANVAS_WIDTH + x) * 4 + 3] < 110) continue
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        const group = Math.min(3, Math.floor((x / CANVAS_WIDTH) * 4))
        const seed = Math.random()
        const angle = Math.random() * Math.PI * 2
        const shell = Math.random() < 0.77 ? 1.32 + Math.random() * 0.27 : 0.52 + Math.random() * 0.64
        const color = COLORS[group]

        positions.push((x - CANVAS_WIDTH / 2) * TEXT_SCALE, (CANVAS_HEIGHT / 2 - y) * TEXT_SCALE - 0.48, 0)
        bursts.push(Math.cos(angle) * shell, Math.sin(angle) * shell)
        centers.push(CENTERS[group][0] + (Math.random() - 0.5) * 0.18, CENTERS[group][1] + (Math.random() - 0.5) * 0.16)
        colors.push(color[0] * (0.85 + Math.random() * 0.15), color[1] * (0.85 + Math.random() * 0.15), color[2])
        delays.push(group * 0.22 + Math.random() * 0.2)
        sizes.push(3.6 + Math.random() * 2.1)
        seeds.push(seed)
      }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('aBurst', new BufferAttribute(new Float32Array(bursts), 2))
    geometry.setAttribute('aCenter', new BufferAttribute(new Float32Array(centers), 2))
    geometry.setAttribute('aColor', new BufferAttribute(new Float32Array(colors), 3))
    geometry.setAttribute('aDelay', new BufferAttribute(new Float32Array(delays), 1))
    geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(sizes), 1))
    geometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(seeds), 1))

    if (this.mainPoints) this.scene.remove(this.mainPoints)
    if (this.trailPoints) this.scene.remove(this.trailPoints)
    this.geometry?.dispose()
    this.geometry = geometry
    // 主体与拖尾共享几何；更换文字时只释放一次几何，材质继续复用。
    this.trailPoints = new Points(geometry, this.trailMaterial)
    this.mainPoints = new Points(geometry, this.mainMaterial)
    this.scene.add(this.trailPoints, this.mainPoints)
    this.textWidth = Math.max(1, (maxX - minX) * TEXT_SCALE)
    this.launchStart = -1
    this.mainMaterial.uniforms.uPhase.value = -1
    this.trailMaterial.uniforms.uPhase.value = -1
    this.resize()
  }

  launch() {
    if (this.reducedMotion) return
    this.launchStart = performance.now()
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    const aspect = width / height
    const viewWidth = VIEW_HEIGHT * aspect
    this.camera.left = -viewWidth / 2
    this.camera.right = viewWidth / 2
    this.camera.top = VIEW_HEIGHT / 2
    this.camera.bottom = -VIEW_HEIGHT / 2
    this.camera.updateProjectionMatrix()
    const scale = Math.min(1, (viewWidth * 0.84) / this.textWidth)
    const fireworkScale = Math.min(1, (viewWidth * 0.9) / (9.2 * scale))
    const pointScale = Math.min(1, scale * 1.3)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    for (const material of [this.mainMaterial, this.trailMaterial]) {
      material.uniforms.uScale.value = scale
      material.uniforms.uFireworkScale.value = fireworkScale
      material.uniforms.uPixelRatio.value = pixelRatio
    }
    this.mainMaterial.uniforms.uSizeScale.value = pointScale
    this.trailMaterial.uniforms.uSizeScale.value = pointScale * 1.42
    this.renderer.setSize(width, height, false)
  }

  private animate = (now: number) => {
    this.frame = requestAnimationFrame(this.animate)
    if (document.hidden) return
    const phase = this.launchStart < 0 ? -1 : Math.min(DURATION, (now - this.launchStart) / 1000)
    const displayPhase = phase >= DURATION ? -1 : phase
    for (const material of [this.mainMaterial, this.trailMaterial]) {
      material.uniforms.uPhase.value = displayPhase
      material.uniforms.uClock.value = now / 1000
    }
    if (phase >= DURATION) this.launchStart = -1
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.geometry?.dispose()
    this.mainMaterial.dispose()
    this.trailMaterial.dispose()
    this.stars.geometry.dispose()
    ;(this.stars.material as PointsMaterial).dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
