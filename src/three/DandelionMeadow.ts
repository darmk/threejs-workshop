import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, DoubleSide, FogExp2,
  HemisphereLight, InstancedBufferAttribute, InstancedBufferGeometry, LineSegments,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry,
  Points, Scene, ShaderMaterial, SphereGeometry, TubeGeometry, Vector3, WebGLRenderer,
} from 'three'

export type DandelionState = { phase: 'ready' | 'drifting' | 'away'; progress: number; level: number }
// 每株种子数量按远近递减；所有冠毛合为一个实例化线段批次，不逐颗创建对象。
const HEADS = [
  [-1.1, 2.45, 1.1, 0.82, 300], [-3.5, 1.7, 0.1, 0.53, 160],
  [1.35, 1.82, -0.5, 0.58, 190], [-0.1, 1.35, -2.3, 0.48, 130],
  [-4.6, 1.05, -2.8, 0.39, 90], [3.45, 1.18, -2.4, 0.44, 110],
  [-2.6, 2.05, -4.1, 0.47, 110], [2.2, 2.35, -5.5, 0.45, 100],
  [4.7, 0.8, -5.4, 0.32, 65], [-5.7, 1.8, -5.2, 0.39, 80],
]
const FLIGHT_SECONDS = 10
const DETACH_SECONDS = 1.8
const seedVertex = /* glsl */`
  attribute vec3 aHome;
  attribute vec3 aAxis;
  attribute float aRelease;
  attribute float aRandom;
  attribute float aSize;
  uniform float uTime;
  uniform float uWind;
  uniform float uMotion;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    // aHome 为世界坐标；种子局部 +Y 为细柄到伞冠的方向，角度使用弧度。
    float age = max(0.0, uTime - aRelease);
    float flying = aRelease >= 0.0 && uTime >= aRelease ? 1.0 : 0.0;
    float travel = age * flying;
    vec3 floatingAxis = normalize(vec3(sin(travel * 0.7 + aRandom * 33.0) * 0.38, 1.0, cos(travel + aRandom * 19.0) * 0.3));
    vec3 axis = normalize(mix(aAxis, floatingAxis, smoothstep(0.0, 1.3, travel)));
    vec3 right = normalize(cross(abs(axis.y) > 0.96 ? vec3(1,0,0) : vec3(0,1,0), axis));
    vec3 forward = cross(axis, right);
    float spin = aRandom * 6.2831853;
    vec2 radial = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * position.xz;
    vec3 local = (right * radial.x + axis * position.y + forward * radial.y) * aSize;
    // 有界的侧向摆动叠加主风向；这是美术轨迹，并非空气动力学求解。
    vec3 drift = vec3(travel * (0.35 + aRandom * 1.6), travel * (0.08 + fract(aRandom * 17.0) * 0.7), -travel * (0.5 + fract(aRandom * 31.0) * 2.5));
    drift.x += sin(travel * 1.1 + aRandom * 31.0) * 0.24 * min(travel, 1.0);
    drift.y += sin(travel * 0.9 + aRandom * 23.0) * 0.22 * min(travel, 1.0);
    drift *= 0.85 + uWind * 0.25;
    vec3 home = aHome;
    home.x += sin(uTime * 0.65 + aHome.z) * 0.022 * uMotion;
    vec3 world = home + local + drift * flying;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    vTint = color;
    // 冠毛为半透明细丝；背向镜头的附着种子减淡，避免叠成实心白球。
    vAlpha = (1.0 - smoothstep(7.0, 10.0, travel)) * mix(0.19 + max(0.0, aAxis.z) * 0.26, 0.62, flying);
  }
`
const seedFragment = /* glsl */`
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(vTint, vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** 程序化蒲公英草甸；Y 向上，镜头望向 -Z，种子沿 +X、+Y、-Z 飘远。 */
export class DandelionMeadow {
  private renderer: WebGLRenderer | null = null
  private scene = new Scene()
  private camera = new PerspectiveCamera(40, 1, 0.1, 80)
  private observer: ResizeObserver | null = null
  private geometries = new Set<BufferGeometry>()
  private materials = new Set<MeshBasicMaterial | MeshStandardMaterial | ShaderMaterial>()
  private release = new InstancedBufferAttribute(new Float32Array(1), 1)
  private releases = new Float32Array(0)
  private uniforms = { uTime: { value: 0 }, uWind: { value: 0.7 }, uMotion: { value: 1 } }
  private phase: DandelionState['phase'] = 'ready'
  private frame = 0
  private lastTime = 0
  private time = 0
  private launchTime = 0
  private breath = 0
  private lastReport = ''
  private seed = 31121
  private disposed = false
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(private host: HTMLElement, private onState: (state: DandelionState) => void, private readBreath: () => number) {
    try {
      this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6))
      host.appendChild(this.renderer.domElement)
      this.renderer.domElement.setAttribute('aria-hidden', 'true')
      this.scene.background = new Color('#172c29')
      this.scene.fog = new FogExp2('#172c29', 0.046)
      this.scene.add(new HemisphereLight('#eedab0', '#152e22', 3))
      this.background()
      this.meadow()
      this.makeSeeds()
      this.uniforms.uMotion.value = this.reduced ? 0 : 1
      this.observer = new ResizeObserver(() => this.resize())
      this.observer.observe(host); this.resize(); this.report(0)
      this.frame = requestAnimationFrame(this.tick)
    } catch (error) { this.dispose(); throw error }
  }

  private random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296 }

  private mesh(geometry: BufferGeometry, material: MeshBasicMaterial | MeshStandardMaterial | ShaderMaterial) {
    this.geometries.add(geometry); this.materials.add(material)
    const mesh = new Mesh(geometry, material); this.scene.add(mesh); return mesh
  }

  private background() {
    const material = new ShaderMaterial({ depthWrite: false, depthTest: false, vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,1.0,1.0);}`, fragmentShader: `
      varying vec2 vUv;
      void main(){
        // 远处逆光和柔和色块仅提供环境层次，不使用外部背景图片。
        vec3 c=mix(vec3(0.007,0.021,0.018),vec3(0.055,0.095,0.065),vUv.y);
        float glow=exp(-length((vUv-vec2(0.72,0.69))*vec2(2.0,2.5))*6.0);
        c+=vec3(0.35,0.27,0.1)*glow;
        gl_FragColor=vec4(c,1.0);
        #include <colorspace_fragment>
      }` })
    // 全屏背景不参与透视与深度测试，避免地平线产生突兀拼接。
    const backdrop = this.mesh(new PlaneGeometry(2, 2), material)
    backdrop.frustumCulled = false; backdrop.renderOrder = -100
    const positions: number[] = [], sizes: number[] = []
    for (let i = 0; i < 100; i++) {
      positions.push((this.random() - 0.5) * 36, this.random() * 14 - 1, -10 - this.random() * 8)
      sizes.push(10 + this.random() * 90)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(sizes), 1))
    const bokeh = new ShaderMaterial({ transparent: true, depthWrite: false, vertexShader: `attribute float aSize;void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=aSize;}`, fragmentShader: `void main(){float r=length(gl_PointCoord-0.5)*2.0;float a=pow(max(0.0,1.0-r*r),3.0)*0.12;gl_FragColor=vec4(0.8,0.76,0.5,a);}` })
    this.geometries.add(geometry); this.materials.add(bokeh); this.scene.add(new Points(geometry, bokeh))
  }

  private meadow() {
    const stem = new MeshStandardMaterial({ color: '#6d8051', roughness: 1 })
    const core = new MeshStandardMaterial({ color: '#76664b', roughness: 1 })
    const leaf = new MeshStandardMaterial({ color: '#334c2a', side: DoubleSide, roughness: 1 })
    for (const [x, y, z, radius] of HEADS) {
      const curve = new CatmullRomCurve3([new Vector3(x - 0.18, -0.7, z), new Vector3(x - 0.13, y * 0.5, z + 0.06), new Vector3(x, y, z)])
      this.mesh(new TubeGeometry(curve, 12, 0.018, 5, false), stem)
      const heart = this.mesh(new SphereGeometry(radius * 0.12, 10, 7), core)
      heart.position.set(x, y, z)
      for (let j = 0; j < 3; j++) {
        const geometry = new PlaneGeometry(1, 1, 2, 14)
        const p = geometry.getAttribute('position'), angle = j * 2.4 + x
        for (let i = 0; i < p.count; i++) {
          const u = p.getX(i) * 2, t = p.getY(i) + 0.5
          const jagged = (0.7 + Math.sin(t * 43) * 0.3) * Math.sin(t * Math.PI)
          const w = u * jagged * 0.13, length = t * 0.85
          p.setXYZ(i, Math.sin(angle) * length + Math.cos(angle) * w, -0.6 + Math.sin(t * Math.PI) * 0.27, Math.cos(angle) * length - Math.sin(angle) * w)
        }
        geometry.computeVertexNormals(); this.mesh(geometry, leaf).position.set(x, 0, z)
      }
    }
  }

  private makeSeeds() {
    const positions: number[] = [], colors: number[] = []
    function line(a: number[], b: number[], shade: number) { positions.push(...a, ...b); for (let i = 0; i < 2; i++) colors.push(shade, shade * 0.96, shade * 0.83) }
    // 种子局部坐标：棕色瘦果位于 y<0，细柄向上，顶部由放射状冠毛组成。
    line([0, -0.055, 0], [0, 0, 0], 0.38)
    line([0, 0, 0], [0, 0.16, 0], 0.7)
    for (let j = 0; j < 14; j++) {
      const a = j / 14 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a)
      line([0, 0.16, 0], [c * 0.07, 0.19, s * 0.07], 0.92)
      line([c * 0.07, 0.19, s * 0.07], [c * 0.125, 0.18, s * 0.125], 1)
      line([c * 0.10, 0.184, s * 0.10], [c * 0.13 - s * 0.014, 0.19, s * 0.13 + c * 0.014], 0.9)
    }
    const home: number[] = [], axes: number[] = [], random: number[] = [], size: number[] = []
    for (const [x, y, z, radius, count] of HEADS) {
      for (let i = 0; i < count; i++) {
        // Fibonacci 球面均匀采样；花球中心到冠毛伞面的距离由 radius 控制。
        // 小幅抖动和径向变化用于打破过于规整的晶格；仍保持球面整体密度。
        const ny = 1 - (i + 0.2 + this.random() * 0.6) / count * 2
        const r = Math.sqrt(1 - ny * ny), a = i * 2.39996323 + (this.random() - 0.5) * 0.24
        const nx = Math.cos(a) * r, nz = Math.sin(a) * r
        const scale = 0.65 + this.random() * 0.35
        const baseRadius = radius - 0.17 * scale + (this.random() - 0.5) * radius * 0.08
        home.push(x + nx * baseRadius, y + ny * baseRadius, z + nz * baseRadius)
        axes.push(nx, ny, nz); random.push(this.random()); size.push(scale)
      }
    }
    const geometry = new InstancedBufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    geometry.setAttribute('aHome', new InstancedBufferAttribute(new Float32Array(home), 3))
    geometry.setAttribute('aAxis', new InstancedBufferAttribute(new Float32Array(axes), 3))
    geometry.setAttribute('aRandom', new InstancedBufferAttribute(new Float32Array(random), 1))
    geometry.setAttribute('aSize', new InstancedBufferAttribute(new Float32Array(size), 1))
    this.releases = new Float32Array(random.length).fill(-1)
    this.release = new InstancedBufferAttribute(this.releases, 1)
    geometry.setAttribute('aRelease', this.release); geometry.instanceCount = random.length
    const material = new ShaderMaterial({ uniforms: this.uniforms, vertexColors: true, transparent: true, depthWrite: false, vertexShader: seedVertex, fragmentShader: seedFragment })
    const seeds = new LineSegments(geometry, material)
    seeds.frustumCulled = false
    this.geometries.add(geometry); this.materials.add(material); this.scene.add(seeds)
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight)
    this.renderer?.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.position.set(w < 600 ? -0.8 : 0, 3.7, w < 600 ? 16.8 : 10.8)
    this.camera.lookAt(-0.3, 2, -0.6); this.camera.updateProjectionMatrix()
  }

  /** 触发整片花球脱落；power 为 0—1 的经验风力，重复吹气不会重建种子或叠加循环。 */
  blow(power = 0.7) {
    if (this.disposed) return
    this.uniforms.uWind.value = Number.isFinite(power) ? Math.max(0.2, Math.min(1, power)) : 0.7
    if (this.phase !== 'ready') return
    this.launchTime = this.time; this.phase = 'drifting'
    for (let i = 0; i < this.releases.length; i++) this.releases[i] = this.time + this.random() * DETACH_SECONDS
    this.release.needsUpdate = true
    this.report(0)
  }

  /** 复用同一批种子恢复花球，保留当前环境与相机。 */
  reset() {
    if (this.disposed) return
    this.releases.fill(-1); this.release.needsUpdate = true; this.phase = 'ready'; this.breath = 0
    this.report(0)
  }

  private report(level: number) {
    const progress = this.phase === 'ready' ? 0 : Math.min(100, Math.round((this.time - this.launchTime) / (FLIGHT_SECONDS + DETACH_SECONDS) * 100))
    const state = { phase: this.phase, progress, level: Math.round(level * 10) * 10 }
    const key = `${state.phase}/${state.progress}/${state.level}`
    if (key !== this.lastReport) { this.lastReport = key; this.onState(state) }
  }

  private tick = (now: number) => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.tick)
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0
    this.lastTime = now
    if (document.hidden) return
    this.time += dt
    const level = this.readBreath()
    this.breath = level > 0.12 ? this.breath + dt : Math.max(0, this.breath - dt * 2)
    if (this.breath > 0.12 && this.phase === 'ready') this.blow(Math.max(0.4, level))
    this.uniforms.uTime.value = this.time
    if (this.phase === 'drifting' && this.time - this.launchTime >= FLIGHT_SECONDS + DETACH_SECONDS) this.phase = 'away'
    this.report(level)
    this.renderer?.render(this.scene, this.camera)
  }

  /** 材质和几何按集合去重释放；构造失败与正常卸载共用此路径，可重复调用。 */
  dispose() {
    if (this.disposed) return
    this.disposed = true; cancelAnimationFrame(this.frame); this.observer?.disconnect()
    this.geometries.forEach(geometry => geometry.dispose()); this.materials.forEach(material => material.dispose())
    this.geometries.clear(); this.materials.clear()
    this.renderer?.dispose(); this.renderer?.domElement.remove(); this.renderer = null
  }
}
