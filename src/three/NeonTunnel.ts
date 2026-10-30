import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'

export type TunnelPalette = 'afterglow' | 'ultraviolet' | 'ember'

const PALETTES: Record<TunnelPalette, { left: number; right: number; floor: number }> = {
  afterglow: { left: 0x50e4f0, right: 0xec5dc9, floor: 0xffaf70 },
  ultraviolet: { left: 0x8d89ff, right: 0x4ddcef, floor: 0xd9a2ff },
  ember: { left: 0xffbe66, right: 0xff655c, floor: 0x82e8ed },
}

const FRAME_COUNT = 46
const FRAME_SPACING = 3.15
const TUNNEL_SPAN = FRAME_COUNT * FRAME_SPACING
const PROFILE: Array<[number, number]> = [
  [-3.15, -2.15], [-4.1, -1.05], [-4.1, 1.3], [-2.68, 2.55],
  [2.68, 2.55], [4.1, 1.3], [4.1, -1.05], [3.15, -2.15],
]

// aDepth 是灯框初始纵深，uTravel 为累计前进距离，uSpan 为循环总长，均使用场景单位。
// 纵深取模后放在负 Z 方向，近远端淡出掩盖循环接缝；uPulseAge 为秒数，负值关闭脉冲。
const FRAME_VERTEX = /* glsl */ `
  attribute float aDepth;
  attribute float aTone;
  attribute float aFloor;
  attribute float aStrength;
  uniform float uTravel;
  uniform float uSpan;
  uniform float uPulseAge;
  varying float vDepth;
  varying float vTone;
  varying float vFloor;
  varying float vStrength;
  varying float vPulse;
  varying float vY;

  void main() {
    float depth = mod(aDepth - uTravel + uSpan, uSpan) + 1.1;
    vec3 transformed = position;
    transformed.z = -depth;
    vDepth = depth;
    vTone = aTone;
    vFloor = aFloor;
    vStrength = aStrength;
    vY = position.y;
    vPulse = uPulseAge < 0.0 ? 0.0 : exp(-pow((depth - uPulseAge * 32.0) / 9.0, 2.0)) * exp(-uPulseAge * 0.42);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`

const FRAME_FRAGMENT = /* glsl */ `
  uniform vec3 uLeft;
  uniform vec3 uRight;
  uniform vec3 uFloor;
  uniform float uOpacity;
  uniform float uReflection;
  varying float vDepth;
  varying float vTone;
  varying float vFloor;
  varying float vStrength;
  varying float vPulse;
  varying float vY;

  void main() {
    float nearFade = smoothstep(2.0, 8.0, vDepth);
    float farFade = 1.0 - smoothstep(54.0, 125.0, vDepth);
    vec3 color = mix(uLeft, uRight, smoothstep(0.12, 0.88, vTone));
    color = mix(color, uFloor, vFloor * 0.72);
    float energy = vStrength * (1.05 + vPulse * 1.65);
    float reflectionFade = exp(-max(0.0, vY + 2.15) * 0.88) * 0.22;
    float alpha = uOpacity * nearFade * farFade * (0.82 + vPulse * 0.45);
    gl_FragColor = vec4(color * energy, alpha * mix(1.0, reflectionFade, uReflection));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const DUST_VERTEX = /* glsl */ `
  attribute float aDepth;
  attribute float aSize;
  attribute float aTone;
  uniform float uTravel;
  uniform float uSpan;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying float vTone;

  void main() {
    float depth = mod(aDepth - uTravel * 1.14 + uSpan, uSpan) + 1.0;
    vec4 view = modelViewMatrix * vec4(position.xy, -depth, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = min(5.5, aSize * uPixelRatio * 24.0 / max(5.0, -view.z));
    vAlpha = smoothstep(2.0, 10.0, depth) * (1.0 - smoothstep(52.0, 122.0, depth));
    vTone = aTone;
  }
`

const DUST_FRAGMENT = /* glsl */ `
  uniform vec3 uLeft;
  uniform vec3 uRight;
  varying float vAlpha;
  varying float vTone;
  void main() {
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    float point = 1.0 - smoothstep(0.0, 1.0, radius);
    gl_FragColor = vec4(mix(uLeft, uRight, vTone), point * vAlpha * 0.44);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const LANE_VERTEX = /* glsl */ `
  attribute float aDepth;
  attribute float aLane;
  uniform float uTravel;
  uniform float uSpan;
  varying float vDepth;
  varying float vLane;
  void main() {
    float depth = mod(aDepth - uTravel + uSpan, uSpan) + 1.1;
    vec3 transformed = position;
    transformed.z -= depth;
    vDepth = depth;
    vLane = aLane;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`

const LANE_FRAGMENT = /* glsl */ `
  uniform vec3 uLeft;
  uniform vec3 uRight;
  uniform vec3 uFloor;
  varying float vDepth;
  varying float vLane;
  void main() {
    float fade = smoothstep(2.0, 11.0, vDepth) * (1.0 - smoothstep(60.0, 130.0, vDepth));
    vec3 color = vLane < 0.25 ? uLeft : vLane > 0.75 ? uRight : uFloor;
    float strength = vLane > 0.25 && vLane < 0.75 ? 0.78 : 0.32;
    gl_FragColor = vec4(color, fade * strength);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function frameGeometry(width: number) {
  const position: number[] = []
  const depths: number[] = []
  const tones: number[] = []
  const floors: number[] = []
  const strengths: number[] = []

  function vertex(x: number, y: number, depth: number, tone: number, floor: number, strength: number) {
    position.push(x, y, 0)
    depths.push(depth)
    tones.push(tone)
    floors.push(floor)
    strengths.push(strength)
  }

  for (let ring = 0; ring < FRAME_COUNT; ring++) {
    const depth = ring * FRAME_SPACING
    const strength = ring % 5 === 0 ? 1.35 : ring % 2 === 0 ? 0.76 : 0.50
    for (let side = 0; side < PROFILE.length; side++) {
      const [ax, ay] = PROFILE[side]
      const [bx, by] = PROFILE[(side + 1) % PROFILE.length]
      const length = Math.hypot(bx - ax, by - ay)
      const nx = -(by - ay) / length * width * 0.5
      const ny = (bx - ax) / length * width * 0.5
      const tone = (ax + bx + 8.2) / 16.4
      const floor = side === 7 ? 1 : side === 0 || side === 6 ? 0.45 : 0
      const corners: Array<[number, number]> = [
        [ax + nx, ay + ny], [ax - nx, ay - ny], [bx + nx, by + ny],
        [bx + nx, by + ny], [ax - nx, ay - ny], [bx - nx, by - ny],
      ]
      for (const [x, y] of corners) vertex(x, y, depth, tone, floor, strength)
    }

    // 每五个灯框增加一道短内折线，作为重复隧道中的视觉节奏标记。
    if (ring % 5 === 0) {
      for (const side of [1, 5]) {
        const x = side === 1 ? -3.7 : 3.7
        const tone = side === 1 ? 0 : 1
        const corners: Array<[number, number]> = [
          [x - width, -0.55], [x + width, -0.55], [x - width, 0.75],
          [x - width, 0.75], [x + width, -0.55], [x + width, 0.75],
        ]
        for (const [px, py] of corners) vertex(px, py, depth, tone, 0, strength * 0.8)
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('aDepth', new BufferAttribute(new Float32Array(depths), 1))
  geometry.setAttribute('aTone', new BufferAttribute(new Float32Array(tones), 1))
  geometry.setAttribute('aFloor', new BufferAttribute(new Float32Array(floors), 1))
  geometry.setAttribute('aStrength', new BufferAttribute(new Float32Array(strengths), 1))
  return geometry
}

function dustGeometry() {
  const position: number[] = []
  const depths: number[] = []
  const sizes: number[] = []
  const tones: number[] = []
  for (let i = 0; i < 760; i++) {
    const x = (Math.random() - 0.5) * 7.2
    const y = (Math.random() - 0.5) * 4.2
    position.push(x, y, 0)
    depths.push(Math.random() * TUNNEL_SPAN)
    sizes.push(0.55 + Math.random() * 1.9)
    tones.push((x + 3.6) / 7.2)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('aDepth', new BufferAttribute(new Float32Array(depths), 1))
  geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(sizes), 1))
  geometry.setAttribute('aTone', new BufferAttribute(new Float32Array(tones), 1))
  return geometry
}

function laneGeometry() {
  const position: number[] = []
  const depthAttribute: number[] = []
  const lanes: number[] = []
  for (let ring = 0; ring < FRAME_COUNT; ring++) {
    const depth = ring * FRAME_SPACING
    for (const [x, lane, width, length] of [[-2.45, 0, 0.026, 1.35], [0, 0.5, 0.055, 0.9], [2.45, 1, 0.026, 1.35]]) {
      const y = -2.135
      const vertices: Array<[number, number, number]> = [
        [x - width, y, 0], [x + width, y, 0], [x - width, y, -length],
        [x - width, y, -length], [x + width, y, 0], [x + width, y, -length],
      ]
      for (const vertex of vertices) {
        position.push(...vertex)
        depthAttribute.push(depth)
        lanes.push(lane)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('aDepth', new BufferAttribute(new Float32Array(depthAttribute), 1))
  geometry.setAttribute('aLane', new BufferAttribute(new Float32Array(lanes), 1))
  return geometry
}

function railGeometry() {
  const position: number[] = []
  const color: number[] = []
  for (const [index, [x, y]] of PROFILE.entries()) {
    if (index === 2 || index === 3 || index === 4 || index === 5) continue
    const tint = new Color(index < 3 ? 0x50e4f0 : 0xec5dc9)
    const width = 0.009
    const near = 0.0
    const far = -TUNNEL_SPAN
    const vertices: Array<[number, number, number]> = [
      [x - width, y, near], [x + width, y, near], [x - width, y, far],
      [x - width, y, far], [x + width, y, near], [x + width, y, far],
    ]
    for (const vertex of vertices) {
      position.push(...vertex)
      color.push(tint.r, tint.g, tint.b)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3))
  return geometry
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** 用固定数量的灯框、尘粒及地面光标循环模拟前进，避免持续创建远处场景对象。 */
export class NeonTunnel {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(64, 1, 0.1, 190)
  private tunnel = new Group()
  private frameCoreGeometry = frameGeometry(0.038)
  private frameGlowGeometry = frameGeometry(0.24)
  private particlesGeometry = dustGeometry()
  private lanesGeometry = laneGeometry()
  private railsGeometry = railGeometry()
  private coreMaterial: ShaderMaterial
  private glowMaterial: ShaderMaterial
  private reflectionMaterial: ShaderMaterial
  private dustMaterial: ShaderMaterial
  private lanesMaterial: ShaderMaterial
  private railMaterial = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide })
  private observer: ResizeObserver
  private frame = 0
  private lastTime = 0
  private travel = 0
  private pulseAge = -1
  private boostAge = -1
  private speed = 1
  private paused = false
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private palette: TunnelPalette = 'afterglow'
  private pointer = new Vector2()
  private easedPointer = new Vector2()
  private lookTarget = new Vector3()
  private disposed = false

  constructor(private host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.host.appendChild(this.renderer.domElement)
    this.camera.position.set(0, 0.12, 3.4)

    const colors = PALETTES[this.palette]
    const uniforms = () => ({
      uTravel: { value: 0 },
      uSpan: { value: TUNNEL_SPAN },
      uPulseAge: { value: -1 },
      uLeft: { value: new Color(colors.left) },
      uRight: { value: new Color(colors.right) },
      uFloor: { value: new Color(colors.floor) },
      uOpacity: { value: 0.9 },
      uReflection: { value: 0 },
    })
    this.coreMaterial = new ShaderMaterial({
      vertexShader: FRAME_VERTEX,
      fragmentShader: FRAME_FRAGMENT,
      uniforms: uniforms(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    this.glowMaterial = new ShaderMaterial({
      vertexShader: FRAME_VERTEX,
      fragmentShader: FRAME_FRAGMENT,
      uniforms: uniforms(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    this.glowMaterial.uniforms.uOpacity.value = 0.23
    this.reflectionMaterial = new ShaderMaterial({
      vertexShader: FRAME_VERTEX,
      fragmentShader: FRAME_FRAGMENT,
      uniforms: uniforms(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    this.reflectionMaterial.uniforms.uReflection.value = 1
    const glow = new Mesh(this.frameGlowGeometry, this.glowMaterial)
    const core = new Mesh(this.frameCoreGeometry, this.coreMaterial)
    const reflection = new Mesh(this.frameCoreGeometry, this.reflectionMaterial)
    reflection.scale.y = -1
    reflection.position.y = -4.3
    glow.frustumCulled = false
    core.frustumCulled = false
    reflection.frustumCulled = false
    this.tunnel.add(reflection, glow, core)

    this.dustMaterial = new ShaderMaterial({
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      uniforms: {
        uTravel: { value: 0 },
        uSpan: { value: TUNNEL_SPAN },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uLeft: { value: new Color(colors.left) },
        uRight: { value: new Color(colors.right) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    })
    const dust = new Points(this.particlesGeometry, this.dustMaterial)
    dust.frustumCulled = false
    this.tunnel.add(dust)

    this.lanesMaterial = new ShaderMaterial({
      vertexShader: LANE_VERTEX,
      fragmentShader: LANE_FRAGMENT,
      uniforms: {
        uTravel: { value: 0 },
        uSpan: { value: TUNNEL_SPAN },
        uLeft: { value: new Color(colors.left) },
        uRight: { value: new Color(colors.right) },
        uFloor: { value: new Color(colors.floor) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    const lanes = new Mesh(this.lanesGeometry, this.lanesMaterial)
    lanes.frustumCulled = false
    this.tunnel.add(lanes)

    const rails = new Mesh(this.railsGeometry, this.railMaterial)
    rails.frustumCulled = false
    this.tunnel.add(rails)
    this.scene.add(this.tunnel)
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(this.host)
    this.resize()
    this.frame = requestAnimationFrame(this.animate)
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    this.camera.aspect = width / height
    this.camera.fov = width < 600 ? 71 : 64
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(width, height, false)
    this.dustMaterial.uniforms.uPixelRatio.value = ratio
  }

  setSpeed(speed: number) { this.speed = clamp(speed, 0.4, 2.5) }
  setPaused(paused: boolean) { this.paused = paused }

  setPalette(palette: TunnelPalette) {
    if (this.palette === palette) return
    this.palette = palette
    const colors = PALETTES[palette]
    for (const material of [this.coreMaterial, this.glowMaterial, this.reflectionMaterial, this.dustMaterial, this.lanesMaterial]) {
      material.uniforms.uLeft.value.setHex(colors.left)
      material.uniforms.uRight.value.setHex(colors.right)
      if (material.uniforms.uFloor) material.uniforms.uFloor.value.setHex(colors.floor)
    }
    const railColors = this.railsGeometry.getAttribute('color') as BufferAttribute
    const left = new Color(colors.left)
    const right = new Color(colors.right)
    for (let i = 0; i < railColors.count; i++) {
      const tint = Math.floor(i / 6) < 2 ? left : right
      railColors.setXYZ(i, tint.r, tint.g, tint.b)
    }
    railColors.needsUpdate = true
  }

  /** 以约定为 -1～1 的归一化指针位置微调观察方向，坐标方向由交互组件统一换算。 */
  steer(normalizedX: number, normalizedY: number) {
    this.pointer.set(clamp(normalizedX, -1, 1), clamp(normalizedY, -1, 1))
  }

  releaseSteer() { this.pointer.set(0, 0) }

  pulse() {
    if (this.reducedMotion) return
    this.pulseAge = 0
    this.boostAge = 0
  }

  reset() {
    this.speed = 1
    this.travel = 0
    this.pulseAge = -1
    this.boostAge = -1
    this.pointer.set(0, 0)
  }

  private animate = (now: number) => {
    this.frame = requestAnimationFrame(this.animate)
    if (document.hidden) { this.lastTime = now; return }
    const dt = Math.min(0.05, this.lastTime ? (now - this.lastTime) / 1000 : 0)
    this.lastTime = now

    if (!this.paused && !this.reducedMotion) {
      const boost = this.boostAge >= 0 ? 1 + 1.5 * Math.exp(-this.boostAge * 2.4) : 1
      this.travel = (this.travel + dt * this.speed * 8.4 * boost) % TUNNEL_SPAN
      if (this.pulseAge >= 0) {
        this.pulseAge += dt
        if (this.pulseAge > 4.8) this.pulseAge = -1
      }
      if (this.boostAge >= 0) {
        this.boostAge += dt
        if (this.boostAge > 3) this.boostAge = -1
      }
    }

    this.easedPointer.lerp(this.pointer, Math.min(1, dt * 3.4))
    this.camera.position.x = this.easedPointer.x * 0.48
    this.camera.position.y = 0.12 - this.easedPointer.y * 0.31
    this.lookTarget.set(this.easedPointer.x * 0.85, -0.06 - this.easedPointer.y * 0.48, -17)
    this.camera.lookAt(this.lookTarget)
    for (const material of [this.coreMaterial, this.glowMaterial, this.reflectionMaterial]) {
      material.uniforms.uTravel.value = this.travel
      material.uniforms.uPulseAge.value = this.pulseAge
    }
    this.dustMaterial.uniforms.uTravel.value = this.travel
    this.lanesMaterial.uniforms.uTravel.value = this.travel
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.frameCoreGeometry.dispose()
    this.frameGlowGeometry.dispose()
    this.particlesGeometry.dispose()
    this.lanesGeometry.dispose()
    this.railsGeometry.dispose()
    this.coreMaterial.dispose()
    this.glowMaterial.dispose()
    this.reflectionMaterial.dispose()
    this.dustMaterial.dispose()
    this.lanesMaterial.dispose()
    this.railMaterial.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
