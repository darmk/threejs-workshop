import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  FogExp2,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'

type JourneyState = 'ready' | 'travelling' | 'arrived' | 'returning'

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDirection;
  uniform float uWorld;
  uniform float uTime;

  float hash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 dir = normalize(vDirection);
    float horizon = smoothstep(-0.35, 0.46, dir.y);
    vec3 night = mix(vec3(0.025, 0.11, 0.18), vec3(0.015, 0.025, 0.075), horizon);
    night += vec3(0.02, 0.13, 0.18) * exp(-abs(dir.y + 0.08) * 7.0);

    vec3 dawn = mix(vec3(0.86, 0.32, 0.32), vec3(0.20, 0.12, 0.37), smoothstep(-0.32, 0.72, dir.y));
    dawn += vec3(0.6, 0.3, 0.13) * exp(-abs(dir.y + 0.02) * 6.0);

    float star = step(0.997, hash(floor(dir * 225.0)));
    float twinkle = 0.68 + 0.32 * sin(uTime * 1.7 + hash(floor(dir * 225.0)) * 30.0);
    vec3 color = mix(night + star * twinkle * 0.6, dawn + star * 0.2, uWorld);
    gl_FragColor = vec4(color, 1.0);
  }
`

const PORTAL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// 将 UV 映射到以光圈中心为原点的平面，合成天空、山形和网格；不是对另一场景的纹理采样。
// uTime 以秒计，uOpacity 控制穿越时的淡出；径向边缘衰减与透明混合共同隐藏圆盘边界。
const PORTAL_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uOpacity;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float radius = length(p);
    float ripple = sin(radius * 27.0 - uTime * 2.2 + sin(atan(p.y, p.x) * 7.0) * 0.6);
    vec2 warped = p + normalize(p + 0.0001) * ripple * 0.014;

    float horizon = smoothstep(-0.65, 0.6, warped.y);
    vec3 color = mix(vec3(0.06, 0.38, 0.42), vec3(0.025, 0.055, 0.18), horizon);
    color += vec3(0.05, 0.2, 0.22) * exp(-abs(warped.y + 0.18) * 8.0);

    float sun = 1.0 - smoothstep(0.21, 0.235, length((warped - vec2(0.16, 0.21)) * vec2(1.0, 1.05)));
    color = mix(color, vec3(1.0, 0.69, 0.40), sun * 0.93);
    color += vec3(0.7, 0.28, 0.14) * exp(-length(warped - vec2(0.16, 0.21)) * 8.0) * 0.33;

    float mountain = -0.27 + sin(warped.x * 8.0) * 0.05 + sin(warped.x * 17.0 + 1.5) * 0.025;
    color = mix(color, vec3(0.025, 0.10, 0.16), 1.0 - smoothstep(mountain - 0.02, mountain + 0.018, warped.y));
    float grid = pow(1.0 - abs(sin(warped.x * 30.0)), 25.0) * 0.15;
    grid += pow(1.0 - abs(sin((warped.y + 0.38) * 44.0)), 28.0) * 0.11;
    color += vec3(0.11, 0.55, 0.53) * grid * (1.0 - smoothstep(-0.7, -0.1, warped.y));

    float star = step(0.994, hash(floor((warped + 1.0) * 90.0))) * smoothstep(-0.1, 0.3, warped.y);
    color += vec3(0.76, 0.96, 1.0) * star * 0.65;
    color += vec3(0.09, 0.75, 0.83) * exp(-pow((radius - 0.94) * 12.0, 2.0));
    color += vec3(0.025, 0.12, 0.18) * ripple;
    gl_FragColor = vec4(color, uOpacity * (1.0 - smoothstep(0.965, 1.0, radius)));
  }
`

const FLOOR_VERTEX = /* glsl */ `
  varying vec2 vGround;
  void main() {
    vGround = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FLOOR_FRAGMENT = /* glsl */ `
  varying vec2 vGround;
  uniform float uWorld;
  float line(float value) {
    return 1.0 - smoothstep(0.0, 0.035, abs(sin(value * 3.14159265)));
  }
  void main() {
    float grid = max(line(vGround.x * 0.7), line(vGround.y * 0.7));
    vec3 dark = vec3(0.012, 0.038, 0.07) + grid * vec3(0.015, 0.17, 0.20);
    vec3 warm = vec3(0.12, 0.07, 0.14) + grid * vec3(0.26, 0.10, 0.10);
    float near = 1.0 - smoothstep(4.0, 30.0, length(vGround));
    gl_FragColor = vec4(mix(dark, warm, uWorld) * (0.5 + near * 0.5), 1.0);
  }
`

const CRYSTAL_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float uTime;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    float uneven = sin(position.x * 4.5 + uTime * 0.35) * sin(position.y * 5.0 - uTime * 0.24);
    vec3 displaced = position + normal * uneven * 0.04;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`

const CRYSTAL_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float uTime;
  void main() {
    float band = sin(vPosition.y * 7.0 + sin(vPosition.x * 4.2 + uTime * 0.35) * 1.8);
    float soft = 0.5 + 0.5 * band;
    vec3 color = mix(vec3(0.24, 0.11, 0.30), vec3(0.94, 0.38, 0.40), soft);
    float vein = pow(1.0 - abs(sin(vPosition.y * 10.0 + sin(vPosition.x * 5.0) * 2.0)), 16.0);
    color += vec3(0.98, 0.48, 0.23) * vein * 0.45;
    float facing = max(0.0, dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)));
    float rim = pow(1.0 - facing, 2.2);
    color += vec3(0.98, 0.57, 0.38) * rim * 0.75;
    color += vec3(0.25, 0.15, 0.16) * pow(facing, 4.0);
    gl_FragColor = vec4(color, 1.0);
  }
`

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const ease = (value: number) => value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2

/** 管理穿越前后的场景与镜头过渡；传送门内的景色由 Shader 绘制，并非第二相机的实时画面。 */
export class PortalJourney {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(55, 1, 0.1, 100)
  private observer: ResizeObserver
  private frame = 0
  private startTime = 0
  private from = 0
  private target = 0
  private progress = 0
  private pointerX = 0
  private pointerY = 0
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private skyMaterial: ShaderMaterial
  private floorMaterial: ShaderMaterial
  private portalMaterial: ShaderMaterial
  private crystalMaterial!: ShaderMaterial
  private ring = new Group()
  private sparks: Points
  private destination = new Group()
  private orbit = new Group()
  private fog = new FogExp2(0x06101c, 0.027)
  private fogStart = new Color(0x06101c)
  private fogEnd = new Color(0x70415d)
  private nextCameraPosition = new Vector3()
  private geometries: BufferGeometry[] = []
  private materials: Array<MeshBasicMaterial | MeshStandardMaterial | PointsMaterial | ShaderMaterial> = []

  constructor(
    private host: HTMLElement,
    private onState: (state: JourneyState) => void,
    private onProgress: (progress: number) => void,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.host.appendChild(this.renderer.domElement)
    this.scene.fog = this.fog
    this.camera.position.set(0, 0, 7.2)

    this.skyMaterial = this.trackMaterial(new ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: BackSide,
      depthWrite: false,
      uniforms: { uWorld: { value: 0 }, uTime: { value: 0 } },
    }))
    this.scene.add(new Mesh(this.trackGeometry(new SphereGeometry(60, 32, 20)), this.skyMaterial))

    this.floorMaterial = this.trackMaterial(new ShaderMaterial({
      vertexShader: FLOOR_VERTEX,
      fragmentShader: FLOOR_FRAGMENT,
      uniforms: { uWorld: { value: 0 } },
    }))
    const floor = new Mesh(this.trackGeometry(new PlaneGeometry(80, 80)), this.floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, -2.55, -12)
    this.scene.add(floor)

    this.scene.add(new AmbientLight(0x9bb8d4, 1.45))
    const portalLight = new PointLight(0x72f2eb, 42, 12)
    portalLight.position.set(0, 0.2, 1)
    this.scene.add(portalLight)
    const sunsetLight = new PointLight(0xffa56d, 80, 24)
    sunsetLight.position.set(0, 2, -18)
    this.scene.add(sunsetLight)

    this.portalMaterial = this.trackMaterial(new ShaderMaterial({
      vertexShader: PORTAL_VERTEX,
      fragmentShader: PORTAL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
    }))
    const disc = new Mesh(this.trackGeometry(new CircleGeometry(1.96, 128)), this.portalMaterial)
    disc.position.z = -0.04
    this.ring.add(disc)
    this.addRing(2.03, 0.055, 0x94fff2, 0.98)
    this.addRing(2.13, 0.013, 0x78e6ff, 0.54)
    this.addRing(2.29, 0.01, 0x449fae, 0.35)
    this.addRing(1.87, 0.012, 0xffd7a4, 0.65)

    const sparkPositions: number[] = []
    for (let i = 0; i < 560; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 1.93 + Math.pow(Math.random(), 2) * 0.72
      sparkPositions.push(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 0.65)
    }
    const sparkGeometry = this.trackGeometry(new BufferGeometry())
    sparkGeometry.setAttribute('position', new BufferAttribute(new Float32Array(sparkPositions), 3))
    const sparkMaterial = this.trackMaterial(new PointsMaterial({
      color: 0x93fff4, size: 0.025, sizeAttenuation: true,
      transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false,
    }))
    this.sparks = new Points(sparkGeometry, sparkMaterial)
    this.ring.add(this.sparks)
    this.scene.add(this.ring)

    this.makeRuins()
    this.makeDestination()

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(this.host)
    this.resize()
    this.frame = requestAnimationFrame(this.animate)
    this.onState('ready')
  }

  private trackGeometry<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry)
    return geometry
  }

  private trackMaterial<T extends MeshBasicMaterial | MeshStandardMaterial | PointsMaterial | ShaderMaterial>(material: T): T {
    this.materials.push(material)
    return material
  }

  private addRing(radius: number, tube: number, color: number, opacity: number) {
    const geometry = this.trackGeometry(new TorusGeometry(radius, tube, 10, 160))
    const material = this.trackMaterial(new MeshBasicMaterial({
      color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false,
    }))
    const mesh = new Mesh(geometry, material)
    mesh.position.z = 0.02
    this.ring.add(mesh)
  }

  private makeRuins() {
    const stone = this.trackMaterial(new MeshStandardMaterial({ color: 0x173044, metalness: 0.52, roughness: 0.6 }))
    const edge = this.trackMaterial(new MeshBasicMaterial({ color: 0x4ac9cd, transparent: true, opacity: 0.58 }))
    const columns = [-5.1, -3.8, 3.8, 5.1]
    columns.forEach((x, index) => {
      const height = index === 0 || index === 3 ? 3.8 : 2.65
      const geometry = this.trackGeometry(new ConeGeometry(0.48, height, 5))
      const column = new Mesh(geometry, stone)
      column.position.set(x, -2.55 + height / 2, index % 2 ? -1.5 : -3.5)
      column.rotation.y = index * 0.65
      this.scene.add(column)
      const tip = new Mesh(this.trackGeometry(new IcosahedronGeometry(0.13, 0)), edge)
      tip.position.set(x, -2.55 + height + 0.1, column.position.z)
      this.scene.add(tip)
    })
  }

  private makeDestination() {
    this.crystalMaterial = this.trackMaterial(new ShaderMaterial({
      vertexShader: CRYSTAL_VERTEX,
      fragmentShader: CRYSTAL_FRAGMENT,
      uniforms: { uTime: { value: 0 } },
    }))
    const gold = this.trackMaterial(new MeshBasicMaterial({
      color: 0xffcd91, transparent: true, opacity: 0.75,
      blending: AdditiveBlending, depthWrite: false,
    }))
    this.orbit.position.set(0, 0.6, -18)
    const crystal = new Mesh(this.trackGeometry(new IcosahedronGeometry(1.55, 4)), this.crystalMaterial)
    this.orbit.add(crystal)
    const halo = new Mesh(this.trackGeometry(new TorusGeometry(2.2, 0.025, 8, 120)), gold)
    halo.rotation.x = 0.42
    this.orbit.add(halo)
    const haloTwo = new Mesh(this.trackGeometry(new TorusGeometry(2.65, 0.012, 8, 120)), gold)
    haloTwo.rotation.y = 0.78
    this.orbit.add(haloTwo)
    this.destination.add(this.orbit)

    const columnMaterial = this.trackMaterial(new MeshStandardMaterial({
      color: 0x57304c, emissive: 0x4c1d46, metalness: 0.3, roughness: 0.55, flatShading: true,
    }))
    for (let i = 0; i < 20; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const row = Math.floor(i / 2)
      const height = 1.2 + Math.random() * 3.8
      const column = new Mesh(this.trackGeometry(new ConeGeometry(0.28 + Math.random() * 0.28, height, 5)), columnMaterial)
      column.position.set(side * (2.8 + Math.random() * 3.1), -2.55 + height / 2, -11 - row * 2.4)
      column.rotation.z = side * (Math.random() * 0.14)
      this.destination.add(column)
    }

    const dust: number[] = []
    for (let i = 0; i < 650; i++) {
      dust.push((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 8, -8 - Math.random() * 34)
    }
    const dustGeometry = this.trackGeometry(new BufferGeometry())
    dustGeometry.setAttribute('position', new BufferAttribute(new Float32Array(dust), 3))
    const dustMaterial = this.trackMaterial(new PointsMaterial({
      color: 0xffd6aa, size: 0.045, transparent: true, opacity: 0.78,
      blending: AdditiveBlending, depthWrite: false,
    }))
    this.destination.add(new Points(dustGeometry, dustMaterial))
    this.destination.visible = false
    this.scene.add(this.destination)
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.camera.aspect = width / height
    this.camera.fov = width < 600 ? 68 : 55
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  setPointer(x: number, y: number) {
    this.pointerX = Math.max(-1, Math.min(1, x))
    this.pointerY = Math.max(-1, Math.min(1, y))
  }

  enter() {
    if (this.target === 1) return
    this.goTo(1)
  }

  reset() {
    if (this.target === 0) return
    this.goTo(0)
  }

  private goTo(target: number) {
    this.from = this.progress
    this.target = target
    if (this.reducedMotion) {
      this.progress = target
      this.onState(target ? 'arrived' : 'ready')
      this.onProgress(this.progress)
      return
    }
    this.startTime = performance.now()
    this.onState(target ? 'travelling' : 'returning')
  }

  private animate = (now: number) => {
    this.frame = requestAnimationFrame(this.animate)
    if (document.hidden) return
    if (this.progress !== this.target) {
      const duration = this.target ? 5200 : 3600
      const t = clamp01((now - this.startTime) / duration)
      this.progress = this.from + (this.target - this.from) * ease(t)
      this.onProgress(this.progress)
      if (t >= 1) this.onState(this.target ? 'arrived' : 'ready')
    }

    const t = now * 0.001
    // 在镜头接近门面时混合天空、地面与雾色，区间为视觉衔接的经验值。
    const world = clamp01((this.progress - 0.48) / 0.27)
    const smoothWorld = world * world * (3 - 2 * world)
    this.skyMaterial.uniforms.uWorld.value = smoothWorld
    this.skyMaterial.uniforms.uTime.value = t
    this.floorMaterial.uniforms.uWorld.value = smoothWorld
    this.portalMaterial.uniforms.uTime.value = t
    this.crystalMaterial.uniforms.uTime.value = t
    this.portalMaterial.uniforms.uOpacity.value = 1 - clamp01((this.progress - 0.52) / 0.17)
    this.fog.color.copy(this.fogStart).lerp(this.fogEnd, smoothWorld)
    this.fog.density = 0.027 + smoothWorld * 0.004

    this.destination.visible = this.progress > 0.4
    this.ring.visible = this.progress < 0.77
    this.ring.rotation.z = Math.sin(t * 0.27) * 0.025
    this.sparks.rotation.z = t * 0.09
    this.orbit.rotation.y = t * 0.12
    this.orbit.children[0].rotation.y = t * 0.21

    const travel = this.progress
    const z = 7.2 - 16.2 * travel
    const drift = 1 - Math.abs(travel - 0.5) * 0.5
    this.nextCameraPosition.set(this.pointerX * 0.32 * drift, this.pointerY * 0.22 * drift, z)
    if (this.reducedMotion) this.camera.position.copy(this.nextCameraPosition)
    else this.camera.position.lerp(this.nextCameraPosition, 0.12)
    this.camera.lookAt(this.pointerX * 0.08, this.pointerY * 0.07, z - 9)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.geometries.forEach((geometry) => geometry.dispose())
    this.materials.forEach((material) => material.dispose())
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
