import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
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

type Point = { x: number; y: number }
type Phase = 'intact' | 'breaking' | 'open'

const SCENE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// uImpact 为左下原点的 UV；距离乘以 (宽高比 × 2, 2)，与正交场景的 XY 尺度保持一致。
// uReveal 为 0～1 的揭幕进度；角向正弦扰动用于制造不规则边缘，不代表真实裂纹求解。
const SCENE_FRAGMENT = /* glsl */ `
  uniform sampler2D uWinter;
  uniform sampler2D uSpring;
  uniform vec2 uCoverScale;
  uniform vec2 uCoverOffset;
  uniform vec2 uImpact;
  uniform float uAspect;
  uniform float uMaxDistance;
  uniform float uReveal;
  varying vec2 vUv;

  void main() {
    vec2 imageUv = vUv * uCoverScale + uCoverOffset;
    vec2 fromImpact = (vUv - uImpact) * vec2(uAspect * 2.0, 2.0);
    float distanceToImpact = length(fromImpact);
    float angle = atan(fromImpact.y, fromImpact.x);
    float irregular = 0.027 * sin(angle * 9.0 + distanceToImpact * 13.0)
                    + 0.015 * sin(angle * 19.0 - distanceToImpact * 21.0);
    float edge = distanceToImpact + irregular;
    float wave = uReveal * (uMaxDistance + 0.16);
    float opened = 1.0 - smoothstep(wave - 0.08, wave + 0.075, edge);
    if (uReveal < 0.001) opened = 0.0;
    float edgeLens = (1.0 - smoothstep(0.0, 0.075, abs(edge - wave)))
                   * uReveal * (1.0 - uReveal);
    vec2 bend = normalize(vUv - uImpact + vec2(0.0001)) * edgeLens * 0.009 * uCoverScale;
    vec3 winter = texture2D(uWinter, imageUv + bend).rgb;
    vec3 spring = texture2D(uSpring, imageUv - bend).rgb;
    vec3 color = mix(winter, spring, opened);
    float glint = (1.0 - smoothstep(0.0, 0.027, abs(edge - wave)))
                * opened * (1.0 - smoothstep(0.82, 1.0, uReveal));
    color += vec3(0.065, 0.073, 0.08) * glint;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// aCenter、aDirection 使用场景 XY 坐标；aSpin 为弧度，aDelay 是归一化进度延迟。
// 每块三角形的顶点共享运动属性，UV 保持不变，使冬景随碎片整体移动。
const SHARD_VERTEX = /* glsl */ `
  attribute vec2 aCenter;
  attribute vec2 aDirection;
  attribute float aDelay;
  attribute float aSpin;
  attribute float aScatter;
  uniform float uProgress;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    float release = smoothstep(aDelay, aDelay + 0.66, uProgress);
    float angle = aSpin * release;
    vec2 local = position.xy - aCenter;
    vec2 rotated = vec2(
      local.x * cos(angle) - local.y * sin(angle),
      local.x * sin(angle) + local.y * cos(angle)
    );
    vec2 drift = aDirection * (0.08 + aScatter * 0.22) * release * release;
    drift.y -= (0.035 + aScatter * 0.055) * release * release;
    vec3 transformed = vec3(aCenter + rotated + drift, 0.18 + release * 0.11);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`

const SHARD_FRAGMENT = /* glsl */ `
  uniform sampler2D uWinter;
  uniform vec2 uCoverScale;
  uniform vec2 uCoverOffset;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec3 color = texture2D(uWinter, vUv * uCoverScale + uCoverOffset).rgb;
    gl_FragColor = vec4(mix(color, vec3(0.80, 0.90, 0.97), 0.18), uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
const smooth = (value: number) => value * value * (3 - 2 * value)

function randomGenerator(seed: number) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let next = value
    next = Math.imul(next ^ next >>> 15, next | 1)
    next ^= next + Math.imul(next ^ next >>> 7, next | 61)
    return ((next ^ next >>> 14) >>> 0) / 4294967296
  }
}

function coverTransform(stageAspect: number, imageAspect: number) {
  if (stageAspect > imageAspect) {
    const height = imageAspect / stageAspect
    return { scale: new Vector2(1, height), offset: new Vector2(0, (1 - height) * 0.5) }
  }
  const width = stageAspect / imageAspect
  return { scale: new Vector2(width, 1), offset: new Vector2((1 - width) * 0.5, 0) }
}

/** 从点击位置生成裂纹与碎片，并用扩张遮罩衔接冬春纹理；重置时复用材质。 */
export class SeasonGlass {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  private winter: Texture
  private spring: Texture
  private planeGeometry = new PlaneGeometry(2, 2)
  private sceneMaterial: ShaderMaterial
  private shardMaterial: ShaderMaterial
  private sceneMesh: Mesh
  private shards?: Mesh
  private cracks?: LineSegments
  private crackMaterial = new LineBasicMaterial({ color: 0xe9f6ff, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
  private observer: ResizeObserver
  private frame = 0
  private startTime = 0
  private aspect = 1
  private impact = new Vector2(0.5, 0.5)
  private phase: Phase = 'intact'
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private disposed = false

  constructor(private host: HTMLElement, private onPhase: (phase: Phase) => void) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x07121a)
    this.host.appendChild(this.renderer.domElement)
    this.camera.position.z = 4

    const loader = new TextureLoader()
    this.winter = loader.load(publicAsset('images/seasons/winter-lake.jpg'), () => this.render())
    this.spring = loader.load(publicAsset('images/seasons/spring-lake.jpg'), () => this.render())
    this.winter.colorSpace = SRGBColorSpace
    this.spring.colorSpace = SRGBColorSpace

    const coverScale = new Vector2(1, 1)
    const coverOffset = new Vector2()
    this.sceneMaterial = new ShaderMaterial({
      vertexShader: SCENE_VERTEX,
      fragmentShader: SCENE_FRAGMENT,
      uniforms: {
        uWinter: { value: this.winter },
        uSpring: { value: this.spring },
        uCoverScale: { value: coverScale },
        uCoverOffset: { value: coverOffset },
        uImpact: { value: this.impact },
        uAspect: { value: 1 },
        uMaxDistance: { value: 2 },
        uReveal: { value: 0 },
      },
      depthWrite: false,
    })
    this.shardMaterial = new ShaderMaterial({
      vertexShader: SHARD_VERTEX,
      fragmentShader: SHARD_FRAGMENT,
      uniforms: {
        uWinter: { value: this.winter },
        uCoverScale: { value: coverScale },
        uCoverOffset: { value: coverOffset },
        uProgress: { value: 0 },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: DoubleSide,
    })
    this.sceneMesh = new Mesh(this.planeGeometry, this.sceneMaterial)
    this.scene.add(this.sceneMesh)
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(this.host)
    this.resize()
  }

  private buildFracture() {
    this.removeFracture()
    const random = randomGenerator(Math.floor((this.impact.x * 337 + this.impact.y * 997) * 1_000_000))
    const hit: Point = { x: (this.impact.x - 0.5) * this.aspect * 2, y: (this.impact.y - 0.5) * 2 }
    const positions: number[] = []
    const uvs: number[] = []
    const centers: number[] = []
    const directions: number[] = []
    const delays: number[] = []
    const spins: number[] = []
    const scatters: number[] = []

    const addPiece = (a: Point, b: Point, c: Point) => {
      const center = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }
      const away = new Vector2(center.x - hit.x, center.y - hit.y)
      if (away.lengthSq() < 0.0001) away.set(random() - 0.5, random() - 0.5)
      away.normalize()
      away.x += (random() - 0.5) * 0.25
      away.y += (random() - 0.5) * 0.2
      away.normalize()
      const delay = 0.025 + Math.min(0.22, Math.hypot(center.x - hit.x, center.y - hit.y) * 0.16) + random() * 0.035
      const spin = (random() - 0.5) * 0.23
      const scatter = random()
      for (const point of [a, b, c]) {
        positions.push(point.x, point.y, 0)
        uvs.push(point.x / (this.aspect * 2) + 0.5, point.y * 0.5 + 0.5)
        centers.push(center.x, center.y)
        directions.push(away.x, away.y)
        delays.push(delay)
        spins.push(spin)
        scatters.push(scatter)
      }
    }

    const count = this.host.clientWidth < 620 ? 8 : 11
    const inner: Point[] = []
    const outer: Point[] = []
    for (let index = 0; index < count; index++) {
      const angle = index / count * Math.PI * 2 + (random() - 0.5) * 0.2
      const near = 0.13 + random() * 0.1
      const far = 0.43 + random() * 0.23
      inner.push({ x: hit.x + Math.cos(angle) * near, y: hit.y + Math.sin(angle) * near })
      outer.push({ x: hit.x + Math.cos(angle) * far, y: hit.y + Math.sin(angle) * far })
    }
    for (let index = 0; index < count; index++) {
      const next = (index + 1) % count
      addPiece(hit, inner[index], inner[next])
      if (index % 2 === 0) {
        addPiece(inner[index], outer[index], outer[next])
        addPiece(inner[index], outer[next], inner[next])
      }
    }

    const shardGeometry = new BufferGeometry()
    shardGeometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    shardGeometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
    shardGeometry.setAttribute('aCenter', new BufferAttribute(new Float32Array(centers), 2))
    shardGeometry.setAttribute('aDirection', new BufferAttribute(new Float32Array(directions), 2))
    shardGeometry.setAttribute('aDelay', new BufferAttribute(new Float32Array(delays), 1))
    shardGeometry.setAttribute('aSpin', new BufferAttribute(new Float32Array(spins), 1))
    shardGeometry.setAttribute('aScatter', new BufferAttribute(new Float32Array(scatters), 1))
    this.shards = new Mesh(shardGeometry, this.shardMaterial)
    this.shards.frustumCulled = false
    this.scene.add(this.shards)

    const segments: Array<{ a: Point; b: Point; distance: number }> = []
    const addSegment = (a: Point, b: Point) => {
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.006) return
      const middle = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }
      segments.push({ a, b, distance: Math.hypot(middle.x - hit.x, middle.y - hit.y) })
    }
    const limit = (point: Point): Point => ({ x: clamp(point.x, -this.aspect, this.aspect), y: clamp(point.y, -1, 1) })
    const rays: Point[][] = []
    const rayCount = this.host.clientWidth < 620 ? 6 : 8
    for (let ray = 0; ray < rayCount; ray++) {
      const angle = ray / rayCount * Math.PI * 2 + (random() - 0.5) * 0.48
      const direction = { x: Math.cos(angle), y: Math.sin(angle) }
      const perpendicular = { x: -direction.y, y: direction.x }
      const xLimit = direction.x > 0 ? (this.aspect - hit.x) / direction.x : (-this.aspect - hit.x) / direction.x
      const yLimit = direction.y > 0 ? (1 - hit.y) / direction.y : (-1 - hit.y) / direction.y
      const length = Math.min(xLimit, yLimit) * (ray % 3 === 0 ? 1 : 0.68 + random() * 0.32)
      const steps = Math.max(3, Math.ceil(length / 0.13))
      const path: Point[] = [hit]
      for (let step = 1; step <= steps; step++) {
        const radius = length * step / steps
        const sideways = step === steps ? 0 : (random() - 0.5) * Math.min(0.085, radius * 0.12)
        const point = limit({
          x: hit.x + direction.x * radius + perpendicular.x * sideways,
          y: hit.y + direction.y * radius + perpendicular.y * sideways,
        })
        addSegment(path[path.length - 1], point)
        path.push(point)

        if (step > 2 && step < steps - 2 && step % 4 === 0 && random() > 0.35) {
          const branchAngle = angle + (random() > 0.5 ? 1 : -1) * (0.38 + random() * 0.42)
          const branchLength = 0.19 + random() * 0.34
          const middle = limit({ x: point.x + Math.cos(branchAngle) * branchLength * 0.48, y: point.y + Math.sin(branchAngle) * branchLength * 0.48 })
          const end = limit({ x: point.x + Math.cos(branchAngle) * branchLength, y: point.y + Math.sin(branchAngle) * branchLength })
          addSegment(point, middle)
          addSegment(middle, end)
        }
      }
      rays.push(path)
    }
    for (let index = 0; index < rays.length; index++) {
      if (index % 2 !== 0) continue
      const first = rays[index][Math.min(2, rays[index].length - 1)]
      const second = rays[(index + 1) % rays.length][Math.min(2, rays[(index + 1) % rays.length].length - 1)]
      const middle = limit({ x: (first.x + second.x) * 0.5 + (random() - 0.5) * 0.04, y: (first.y + second.y) * 0.5 + (random() - 0.5) * 0.04 })
      addSegment(first, middle)
      addSegment(middle, second)
    }

    // 按线段中点到落点的距离排序，动画可通过 drawRange 从内向外逐段显示裂纹。
    segments.sort((left, right) => left.distance - right.distance)
    const crackPositions: number[] = []
    for (const segment of segments) crackPositions.push(segment.a.x, segment.a.y, 0.36, segment.b.x, segment.b.y, 0.36)
    const crackGeometry = new BufferGeometry()
    crackGeometry.setAttribute('position', new BufferAttribute(new Float32Array(crackPositions), 3))
    crackGeometry.setDrawRange(0, 0)
    this.cracks = new LineSegments(crackGeometry, this.crackMaterial)
    this.cracks.frustumCulled = false
    this.scene.add(this.cracks)
  }

  // 裂纹重建时只销毁临时几何；碎片与裂纹材质由实例持有，保留到最终 dispose。
  private removeFracture() {
    if (this.shards) {
      this.scene.remove(this.shards)
      this.shards.geometry.dispose()
      this.shards = undefined
    }
    if (this.cracks) {
      this.scene.remove(this.cracks)
      this.cracks.geometry.dispose()
      this.cracks = undefined
    }
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.aspect = width / height
    this.camera.left = -this.aspect
    this.camera.right = this.aspect
    this.camera.top = 1
    this.camera.bottom = -1
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height, false)
    this.sceneMesh.scale.x = this.aspect
    const cover = coverTransform(this.aspect, 1672 / 941)
    this.sceneMaterial.uniforms.uCoverScale.value.copy(cover.scale)
    this.sceneMaterial.uniforms.uCoverOffset.value.copy(cover.offset)
    this.sceneMaterial.uniforms.uAspect.value = this.aspect
    const hitX = (this.impact.x - 0.5) * this.aspect * 2
    const hitY = (this.impact.y - 0.5) * 2
    this.sceneMaterial.uniforms.uMaxDistance.value = Math.hypot(this.aspect + Math.abs(hitX), 1 + Math.abs(hitY))
    if (this.phase === 'breaking') this.buildFracture()
    this.render()
  }

  /** 从左下原点的归一化坐标触发破碎；仅 intact 状态接受，落点限制在 0.03～0.97。 */
  fracture(x: number, y: number) {
    if (this.phase !== 'intact') return
    this.impact.set(clamp(x, 0.03, 0.97), clamp(y, 0.03, 0.97))
    this.resize()
    this.phase = 'breaking'
    this.onPhase(this.phase)
    this.startTime = performance.now()
    if (this.reducedMotion) {
      this.sceneMaterial.uniforms.uReveal.value = 1
      this.phase = 'open'
      this.onPhase(this.phase)
      this.render()
      return
    }
    this.buildFracture()
    this.frame = requestAnimationFrame(this.animate)
  }

  reset() {
    cancelAnimationFrame(this.frame)
    this.removeFracture()
    this.sceneMaterial.uniforms.uReveal.value = 0
    this.shardMaterial.uniforms.uProgress.value = 0
    this.shardMaterial.uniforms.uOpacity.value = 0
    this.crackMaterial.opacity = 0
    this.phase = 'intact'
    this.onPhase(this.phase)
    this.render()
  }

  private animate = (now: number) => {
    if (this.disposed || this.phase !== 'breaking') return
    const age = (now - this.startTime) / 1000
    const crack = clamp(age / 0.62, 0, 1)
    const reveal = smooth(clamp((age - 0.46) / 1.66, 0, 1))
    const shardProgress = clamp((age - 0.36) / 1.38, 0, 1)
    const shardFadeIn = clamp((age - 0.34) / 0.23, 0, 1)
    const shardFadeOut = 1 - smooth(clamp((age - 1.26) / 0.75, 0, 1))
    this.sceneMaterial.uniforms.uReveal.value = reveal
    this.shardMaterial.uniforms.uProgress.value = shardProgress
    this.shardMaterial.uniforms.uOpacity.value = shardFadeIn * shardFadeOut * 0.24
    this.crackMaterial.opacity = clamp(age / 0.11, 0, 1) * (1 - smooth(clamp((age - 0.89) / 0.67, 0, 1))) * 0.56
    if (this.cracks) {
      const count = this.cracks.geometry.getAttribute('position').count
      this.cracks.geometry.setDrawRange(0, Math.floor(count * crack / 2) * 2)
    }
    this.render()
    if (reveal < 1) this.frame = requestAnimationFrame(this.animate)
    else {
      this.removeFracture()
      this.phase = 'open'
      this.onPhase(this.phase)
    }
  }

  private render() {
    if (!this.disposed) this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.removeFracture()
    this.planeGeometry.dispose()
    this.sceneMaterial.dispose()
    this.shardMaterial.dispose()
    this.crackMaterial.dispose()
    this.winter.dispose()
    this.spring.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
