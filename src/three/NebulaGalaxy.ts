import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three'

export type GalaxyPalette = 'violet' | 'aurora' | 'ember'

const PALETTES: Record<GalaxyPalette, [number, number, number]> = {
  violet: [0xffe3b7, 0xb57cff, 0x6c8dff],
  aurora: [0xe6fff0, 0x67e6d7, 0x619dff],
  ember: [0xffe3a1, 0xff8e78, 0xd46eb6],
}

// 银河位于局部 XY 平面，按半径改变角速度以形成差速旋转；aMix 控制径向配色。
// uTime 是经速度倍率累计的动画秒数；uPulse 是脉冲经过秒数，负值表示关闭。
const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aMix;
  attribute float aOpacity;
  attribute float aSeed;
  uniform float uTime;
  uniform float uPulse;
  uniform float uPixelRatio;
  uniform vec3 uCore;
  uniform vec3 uArm;
  uniform vec3 uEdge;
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    float radius = length(position.xy);
    float spin = uTime * (0.022 + 0.15 / (radius + 0.45));
    float c = cos(spin);
    float s = sin(spin);
    vec3 pos = vec3(
      position.x * c - position.y * s,
      position.x * s + position.y * c,
      position.z
    );

    float wave = 0.0;
    if (uPulse >= 0.0) {
      float front = uPulse * 3.3;
      wave = exp(-pow((radius - front) * 2.3, 2.0)) * exp(-uPulse * 0.23);
      pos.xy *= 1.0 + wave * 0.075;
      pos.z += wave * 0.48;
    }

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float perspective = 12.0 / max(3.0, -mvPosition.z);
    gl_PointSize = min(19.0, aSize * uPixelRatio * perspective);

    vec3 color = mix(uCore, uArm, smoothstep(0.06, 0.58, aMix));
    color = mix(color, uEdge, smoothstep(0.52, 1.0, aMix));
    color = mix(color, vec3(1.0), step(0.94, aSeed) * 0.42);
    vColor = color * (1.0 + wave * 0.65);
    vOpacity = aOpacity;
  }
`

const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    float core = 1.0 - smoothstep(0.06, 0.28, radius);
    float halo = exp(-radius * radius * 5.0);
    float alpha = (core * 0.7 + halo * 0.3) * vOpacity;
    gl_FragColor = vec4(vColor, alpha);
  }
`

const CLOUD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const CLOUD_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uCore;
  uniform vec3 uArm;
  uniform vec3 uEdge;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float angle = atan(p.y, p.x) - r * 5.4 - uTime * 0.025;
    float arms = pow(0.5 + 0.5 * cos(angle * 4.0), 5.0);
    float knots = 0.75 + 0.25 * sin(p.x * 27.0 + sin(p.y * 18.0)) * sin(p.y * 22.0);
    float haze = exp(-r * r * 5.0) * (0.12 + arms * 0.55) * knots;
    float core = exp(-r * r * 95.0) * 0.55;
    vec3 color = mix(uArm, uEdge, smoothstep(0.18, 0.92, r));
    color = mix(color, uCore, exp(-r * r * 22.0));
    gl_FragColor = vec4(color, min(0.58, haze + core));
  }
`

const PULSE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform float uPulse;
  uniform vec3 uCore;
  uniform vec3 uArm;

  void main() {
    if (uPulse < 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }
    vec2 p = (vUv * 2.0 - 1.0) * 6.7;
    float radius = length(p);
    float front = uPulse * 3.3;
    float ring = exp(-pow((radius - front) * 2.2, 2.0));
    float detail = 0.88 + 0.12 * sin(atan(p.y, p.x) * 16.0);
    float alpha = ring * detail * exp(-uPulse * 0.45) * 0.58;
    vec3 color = mix(uCore, uArm, smoothstep(0.35, 4.2, radius));
    gl_FragColor = vec4(color, alpha);
  }
`

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// 四条旋臂按角度分组，半径和散布采用经验分布；星点数量固定，旋转交给 Shader。
function makeParticles() {
  const positions: number[] = []
  const sizes: number[] = []
  const mixes: number[] = []
  const opacities: number[] = []
  const seeds: number[] = []

  for (let i = 0; i < 26000; i++) {
    const arm = i % 4
    const radius = Math.pow(Math.random(), 0.78) * 5.15
    const spread = (Math.random() - 0.5) * (0.28 + radius * 0.16)
    const angle = arm * Math.PI / 2 + radius * 1.12 + spread
    const scatter = (Math.random() - 0.5) * (0.12 + radius * 0.07)
    positions.push(
      Math.cos(angle) * radius + Math.cos(angle + Math.PI / 2) * scatter,
      Math.sin(angle) * radius + Math.sin(angle + Math.PI / 2) * scatter,
      (Math.random() - 0.5) * (0.16 + (1 - radius / 5.15) * 0.55),
    )
    sizes.push(Math.random() < 0.045 ? 5.4 + Math.random() * 3.8 : 1.25 + Math.random() * 2.25)
    mixes.push(radius / 5.15)
    opacities.push(0.24 + Math.random() * 0.55)
    seeds.push(Math.random())
  }

  for (let i = 0; i < 4800; i++) {
    const radius = Math.pow(Math.random(), 1.7) * 1.13
    const angle = Math.random() * Math.PI * 2
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, (Math.random() - 0.5) * 0.65)
    sizes.push(1.8 + Math.random() * 3.2)
    mixes.push(radius / 5.15)
    opacities.push(0.36 + Math.random() * 0.5)
    seeds.push(Math.random())
  }

  for (let i = 0; i < 4400; i++) {
    const arm = i % 4
    const radius = 0.45 + Math.random() * 5.45
    const angle = arm * Math.PI / 2 + radius * 1.12 + (Math.random() - 0.5) * (0.45 + radius * 0.22)
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, (Math.random() - 0.5) * 0.54 - 0.12)
    sizes.push(5.5 + Math.random() * 8.5)
    mixes.push(radius / 5.9)
    opacities.push(0.025 + Math.random() * 0.07)
    seeds.push(Math.random() * 0.8)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(sizes), 1))
  geometry.setAttribute('aMix', new BufferAttribute(new Float32Array(mixes), 1))
  geometry.setAttribute('aOpacity', new BufferAttribute(new Float32Array(opacities), 1))
  geometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(seeds), 1))
  return geometry
}

function makeBackground() {
  const positions: number[] = []
  const colors: number[] = []
  for (let i = 0; i < 780; i++) {
    positions.push((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 25, -12 - Math.random() * 8)
    const shade = Math.random()
    colors.push(0.48 + shade * 0.36, 0.56 + shade * 0.35, 0.80 + shade * 0.2)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  const material = new PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.62, depthWrite: false, blending: AdditiveBlending,
  })
  return { points: new Points(geometry, material), geometry, material }
}

/** 以点云、雾状平面及脉冲层组合银河；CPU 处理手势与时间，GPU 处理星点旋转和波纹。 */
export class NebulaGalaxy {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(54, 1, 0.1, 100)
  private galaxy = new Group()
  private particleGeometry = makeParticles()
  private starMaterial: ShaderMaterial
  private cloudGeometry = new PlaneGeometry(13.4, 13.4)
  private cloudMaterial: ShaderMaterial
  private pulseMaterial: ShaderMaterial
  private background = makeBackground()
  private observer: ResizeObserver
  private frame = 0
  private lastTime = 0
  private time = 0
  private pulseAge = -1
  private speed = 1
  private paused = false
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private targetX = -0.25
  private targetY = -0.13
  private targetDistance = 12.7
  private pointers = new Map<number, { x: number; y: number }>()
  private dragDistance = 0
  private pinchDistance = 0
  private coreColor = new Color(PALETTES.violet[0])
  private armColor = new Color(PALETTES.violet[1])
  private edgeColor = new Color(PALETTES.violet[2])
  private targetCore = this.coreColor.clone()
  private targetArm = this.armColor.clone()
  private targetEdge = this.edgeColor.clone()

  constructor(private host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x050716, 1)
    this.host.appendChild(this.renderer.domElement)
    this.camera.position.z = this.targetDistance
    this.scene.add(this.background.points)

    const uniforms = {
      uTime: { value: 0 },
      uCore: { value: this.coreColor },
      uArm: { value: this.armColor },
      uEdge: { value: this.edgeColor },
    }
    this.cloudMaterial = new ShaderMaterial({
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    const cloud = new Mesh(this.cloudGeometry, this.cloudMaterial)
    cloud.position.z = -0.8
    this.galaxy.add(cloud)

    this.pulseMaterial = new ShaderMaterial({
      vertexShader: CLOUD_VERTEX,
      fragmentShader: PULSE_FRAGMENT,
      uniforms: {
        uPulse: { value: -1 },
        uCore: { value: this.coreColor },
        uArm: { value: this.armColor },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    const pulseRing = new Mesh(this.cloudGeometry, this.pulseMaterial)
    pulseRing.position.z = -0.56
    this.galaxy.add(pulseRing)

    this.starMaterial = new ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        ...uniforms,
        uPulse: { value: -1 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    this.galaxy.add(new Points(this.particleGeometry, this.starMaterial))
    this.scene.add(this.galaxy)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(this.host)
    this.resize()
    this.frame = requestAnimationFrame(this.animate)
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.camera.aspect = width / height
    this.camera.fov = width < 600 ? 63 : 54
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height, false)
    this.starMaterial.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2)
  }

  setPalette(name: GalaxyPalette) {
    const [core, arm, edge] = PALETTES[name]
    this.targetCore.set(core)
    this.targetArm.set(arm)
    this.targetEdge.set(edge)
  }

  setSpeed(value: number) {
    this.speed = clamp(value, 0.2, 2)
  }

  setPaused(value: boolean) {
    this.paused = value
  }

  pointerDown(id: number, x: number, y: number) {
    this.pointers.set(id, { x, y })
    if (this.pointers.size === 1) this.dragDistance = 0
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinchDistance()
  }

  pointerMove(id: number, x: number, y: number) {
    const previous = this.pointers.get(id)
    if (!previous) return
    this.pointers.set(id, { x, y })
    if (this.pointers.size === 2) {
      const distance = this.currentPinchDistance()
      if (this.pinchDistance) this.zoom((this.pinchDistance - distance) * 0.018)
      this.pinchDistance = distance
      this.dragDistance = 100
      return
    }
    const dx = x - previous.x
    const dy = y - previous.y
    this.dragDistance += Math.abs(dx) + Math.abs(dy)
    this.targetY = clamp(this.targetY + dx * 0.005, -1.25, 1.25)
    this.targetX = clamp(this.targetX + dy * 0.005, -1.15, 1.15)
  }

  pointerUp(id: number, canceled = false) {
    const wasSingle = this.pointers.size === 1
    this.pointers.delete(id)
    if (!canceled && wasSingle && this.dragDistance < 8) this.pulse()
    if (this.pointers.size < 2) this.pinchDistance = 0
    this.dragDistance = 100
  }

  private currentPinchDistance() {
    const [a, b] = [...this.pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  zoom(delta: number) {
    this.targetDistance = clamp(this.targetDistance + delta, 7.5, 20)
  }

  pulse() {
    if (this.reducedMotion) return
    this.pulseAge = 0
  }

  resetView() {
    this.targetX = -0.25
    this.targetY = -0.13
    this.targetDistance = 12.7
    this.pulseAge = -1
  }

  private animate = (now: number) => {
    this.frame = requestAnimationFrame(this.animate)
    if (document.hidden) {
      this.lastTime = now
      return
    }
    // 限制单步至 50 毫秒，避免卡顿恢复后旋转、脉冲和视角插值大幅跳变。
    const dt = Math.min(0.05, this.lastTime ? (now - this.lastTime) / 1000 : 0)
    this.lastTime = now
    if (!this.paused && !this.reducedMotion) this.time += dt * this.speed
    if (this.pulseAge >= 0) {
      this.pulseAge += dt
      if (this.pulseAge > 2.6) this.pulseAge = -1
    }

    const follow = Math.min(1, dt * 5.8)
    this.galaxy.rotation.x += (this.targetX - this.galaxy.rotation.x) * follow
    this.galaxy.rotation.y += (this.targetY - this.galaxy.rotation.y) * follow
    this.camera.position.z += (this.targetDistance - this.camera.position.z) * follow
    this.coreColor.lerp(this.targetCore, follow)
    this.armColor.lerp(this.targetArm, follow)
    this.edgeColor.lerp(this.targetEdge, follow)
    this.starMaterial.uniforms.uTime.value = this.time
    this.starMaterial.uniforms.uPulse.value = this.pulseAge
    this.cloudMaterial.uniforms.uTime.value = this.time
    this.pulseMaterial.uniforms.uPulse.value = this.pulseAge
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.particleGeometry.dispose()
    this.starMaterial.dispose()
    this.cloudGeometry.dispose()
    this.cloudMaterial.dispose()
    this.pulseMaterial.dispose()
    this.background.geometry.dispose()
    this.background.material.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
