import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { publicAsset } from '../utils/publicAsset'

type Ring = number[][]
type Polygon = Ring[]
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Polygon | Polygon[] } }
type LandCollection = { features: LandFeature[] }

// vLocal 用于球面点击波纹，vWorld 用于水平扫描，vWorldNormal 用于世界空间日照。
// 法线以 modelMatrix 的 3×3 部分变换，依赖当前球体不使用非均匀缩放的约定。
const EARTH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vWorldNormal;
  void main() {
    vUv = uv;
    vLocal = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D uLand;
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec2 uMapSize;
  uniform float uTime;
  uniform float uScanSpeed;
  uniform float uPingAge;
  uniform vec3 uPingDirection;
  uniform vec3 uAccent;
  uniform vec3 uSunDirection;
  varying vec2 vUv;
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vWorldNormal;

  float gridLine(float value, float steps, float thickness) {
    float cell = fract(value * steps);
    float distanceToLine = min(cell, 1.0 - cell);
    return 1.0 - smoothstep(0.0, thickness, distanceToLine);
  }

  void main() {
    float land = texture2D(uLand, vUv).r;
    vec2 texel = 1.0 / uMapSize;
    float coast = abs(texture2D(uLand, vUv + vec2(texel.x * 2.0, 0.0)).r - texture2D(uLand, vUv - vec2(texel.x * 2.0, 0.0)).r);
    coast += abs(texture2D(uLand, vUv + vec2(0.0, texel.y * 2.0)).r - texture2D(uLand, vUv - vec2(0.0, texel.y * 2.0)).r);
    coast = clamp(coast, 0.0, 1.0);

    vec3 normal = normalize(vWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float facing = max(0.0, dot(normal, viewDir));
    float sun = dot(normal, normalize(uSunDirection));
    float daylight = smoothstep(-0.16, 0.24, sun);
    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;

    // 原图海洋接近黑色，仅对非陆地区域补少量蓝色，保留海面可辨识度。
    day += (1.0 - land) * vec3(0.014, 0.045, 0.084);
    vec3 lit = day * (0.42 + 0.62 * max(sun, 0.0));
    vec3 dark = vec3(0.003, 0.010, 0.021) + night * 1.35;
    vec3 color = mix(dark, lit, daylight);

    float specular = pow(max(0.0, dot(reflect(-normalize(uSunDirection), normal), viewDir)), 42.0);
    color += vec3(0.23, 0.36, 0.43) * specular * (1.0 - land) * daylight * 0.28;
    color += vec3(0.18, 0.42, 0.58) * pow(1.0 - facing, 4.0) * daylight * 0.16;

    // 经纬网格与海岸线以低强度叠加，保留卫星影像的主体细节。
    float lonGrid = gridLine(vUv.x, 24.0, 0.012);
    float latGrid = gridLine(vUv.y, 12.0, 0.012);
    color += uAccent * max(lonGrid, latGrid) * 0.025;
    color += uAccent * coast * 0.075;

    float scanY = mod(uTime * uScanSpeed * 0.78, 5.0) - 2.5;
    float distanceToScan = abs(vWorld.y - scanY);
    float scanLine = exp(-distanceToScan * distanceToScan * 520.0);
    float scanGlow = exp(-distanceToScan * distanceToScan * 10.0);
    color += uAccent * scanGlow * 0.025;
    color += vec3(0.45, 0.88, 0.94) * scanLine * 0.22;

    if (uPingAge >= 0.0) {
      float arc = length(normalize(vLocal) - normalize(uPingDirection));
      float ring = exp(-pow((arc - uPingAge * 0.58) * 23.0, 2.0)) * exp(-uPingAge * 0.75);
      color += vec3(0.55, 1.0, 0.93) * ring * 0.68;
    }

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const CLOUD_FRAGMENT = /* glsl */ `
  uniform sampler2D uCloud;
  uniform vec3 uSunDirection;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  void main() {
    float coverage = texture2D(uCloud, vUv).r;
    float cloud = smoothstep(0.16, 0.78, coverage);
    float sunlight = smoothstep(-0.22, 0.30, dot(normalize(vWorldNormal), normalize(uSunDirection)));
    float alpha = cloud * (0.10 + 0.40 * sunlight);
    gl_FragColor = vec4(vec3(0.78, 0.86, 0.91) * (0.28 + 0.72 * sunlight), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uAccent;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    float facing = max(0.0, dot(normalize(vNormal), normalize(cameraPosition - vWorld)));
    float rim = pow(1.0 - facing, 4.0);
    gl_FragColor = vec4(mix(vec3(0.17, 0.37, 0.63), uAccent, 0.22), rim * 0.22);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const DOT_VERTEX = /* glsl */ `
  attribute float aSize;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(3.0, aSize * uPixelRatio * 5.0 / max(3.0, -mv.z));
    vAlpha = aSize;
  }
`

const DOT_FRAGMENT = /* glsl */ `
  uniform vec3 uAccent;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.18, 1.0, r)) * min(0.18, vAlpha * 0.07);
    gl_FragColor = vec4(uAccent, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** 将经纬图坐标映射到球面：u 从西向东、v 从北向南，均为 0～1；Y 轴指向北极。 */
function globePoint(u: number, v: number, radius: number) {
  const phi = u * Math.PI * 2
  const theta = v * Math.PI
  return new Vector3(
    -Math.cos(phi) * Math.sin(theta) * radius,
    Math.cos(theta) * radius,
    Math.sin(phi) * Math.sin(theta) * radius,
  )
}

function makeLandCanvas(data: LandCollection) {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法绘制陆地纹理')
  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#fff'

  for (const feature of data.features) {
    const polygons = feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates as Polygon]
      : feature.geometry.coordinates as Polygon[]
    for (const polygon of polygons) {
      for (const shift of [-canvas.width, 0, canvas.width]) {
        context.beginPath()
        for (const ring of polygon) {
          let previous = ring[0][0]
          let offset = 0
          ring.forEach(([lon, lat], index) => {
            // 跨越 ±180° 时展开经度，再通过横向副本补齐接缝，避免多边形横穿整张地图。
            const adjusted = lon + offset
            if (index > 0 && adjusted - previous > 180) offset -= 360
            if (index > 0 && adjusted - previous < -180) offset += 360
            const unwrapped = lon + offset
            const x = (unwrapped + 180) / 360 * canvas.width + shift
            const y = (90 - lat) / 180 * canvas.height
            if (index === 0) context.moveTo(x, y)
            else context.lineTo(x, y)
            previous = unwrapped
          })
          context.closePath()
        }
        context.fill('evenodd')
      }
    }
  }
  return { canvas, context }
}

function makeLandDots(context: CanvasRenderingContext2D, width: number, height: number) {
  const pixels = context.getImageData(0, 0, width, height).data
  const positions: number[] = []
  const sizes: number[] = []
  let attempts = 0
  while (sizes.length < 4200 && attempts < 100000) {
    attempts++
    const u = Math.random()
    const v = 0.025 + Math.random() * 0.95
    // 按纬圈面积接受采样，抵消等距经纬图的面积拉伸，减轻极区点云聚集。
    if (Math.random() > Math.sin(v * Math.PI)) continue
    const x = Math.floor(u * (width - 1))
    const y = Math.floor(v * (height - 1))
    if (pixels[(y * width + x) * 4] < 150) continue
    const point = globePoint(u, v, 2.055)
    positions.push(point.x, point.y, point.z)
    sizes.push(Math.random() < 0.035 ? 3.2 : 1.2 + Math.random() * 1.1)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(sizes), 1))
  return geometry
}

function makeStarfield() {
  const positions: number[] = []
  for (let i = 0; i < 950; i++) {
    positions.push((Math.random() - 0.5) * 42, (Math.random() - 0.5) * 27, -10 - Math.random() * 16)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  const material = new PointsMaterial({ color: 0x7da9b5, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.5, depthWrite: false })
  return { points: new Points(geometry, material), geometry, material }
}

export type EarthSelection = { latitude: number; longitude: number }

/** 组合卫星影像、陆地遮罩、云层与扫描效果，并将球面点击位置转换为经纬度。 */
export class HolographicEarth {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(44, 1, 0.1, 100)
  private earthGroup = new Group()
  private globeGeometry = new SphereGeometry(2.04, 128, 96)
  private atmosphereGeometry = new SphereGeometry(2.18, 64, 48)
  private cloudGeometry = new SphereGeometry(2.064, 96, 64)
  private landTexture: DataTexture | CanvasTexture
  private dayTexture: Texture
  private nightTexture: Texture
  private cloudTexture: Texture
  private surfaceMaterial: ShaderMaterial
  private atmosphereMaterial: ShaderMaterial
  private cloudMaterial: ShaderMaterial
  private surface: Mesh
  private cloud: Mesh
  private dotGeometry?: BufferGeometry
  private dotMaterial?: ShaderMaterial
  private nodeGeometry = new SphereGeometry(0.021, 8, 8)
  private nodeMaterial = new MeshBasicMaterial({ color: 0xb4dfdf, transparent: true, opacity: 0.42 })
  private orbitGeometries: TorusGeometry[] = []
  private orbitMaterials: MeshBasicMaterial[] = []
  private scanRingGeometry = new TorusGeometry(1, 0.003, 5, 192)
  private scanRingMaterial = new MeshBasicMaterial({ color: 0x8fcbd5, transparent: true, opacity: 0.17, depthWrite: false, depthTest: true, blending: AdditiveBlending, side: DoubleSide })
  private scanRing = new Mesh(this.scanRingGeometry, this.scanRingMaterial)
  private stars = makeStarfield()
  private observer: ResizeObserver
  private abort = new AbortController()
  private raycaster = new Raycaster()
  private pointer = new Vector2()
  private frame = 0
  private lastTime = 0
  private time = 0
  private pingAge = -1
  private speed = 1
  private paused = false
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private targetX = -0.18
  private targetY = 2.4
  private targetDistance = 8.5
  private pointers = new Map<number, { x: number; y: number }>()
  private dragDistance = 0
  private pinchDistance = 0
  private disposed = false

  constructor(private host: HTMLElement, private onSelect?: (selection: EarthSelection) => void, private onError?: () => void) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x050d18, 1)
    this.host.appendChild(this.renderer.domElement)
    this.camera.position.z = this.targetDistance
    this.scene.add(this.stars.points)

    const fallback = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
    fallback.needsUpdate = true
    this.landTexture = fallback
    this.dayTexture = new DataTexture(new Uint8Array([25, 50, 70, 255]), 1, 1)
    this.nightTexture = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
    this.cloudTexture = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
    this.dayTexture.needsUpdate = true
    this.nightTexture.needsUpdate = true
    this.cloudTexture.needsUpdate = true
    const accent = new Color(0x50e5e6)
    const sunDirection = new Vector3(-0.88, 0.32, 0.72).normalize()
    this.surfaceMaterial = new ShaderMaterial({
      vertexShader: EARTH_VERTEX,
      fragmentShader: EARTH_FRAGMENT,
      uniforms: {
        uLand: { value: this.landTexture },
        uDay: { value: this.dayTexture },
        uNight: { value: this.nightTexture },
        uMapSize: { value: new Vector2(2048, 1024) },
        uTime: { value: 0 },
        uScanSpeed: { value: 1 },
        uPingAge: { value: -1 },
        uPingDirection: { value: new Vector3(0, 0, 1) },
        uAccent: { value: accent },
        uSunDirection: { value: sunDirection },
      },
      side: FrontSide,
    })
    this.surface = new Mesh(this.globeGeometry, this.surfaceMaterial)
    this.earthGroup.add(this.surface)

    this.cloudMaterial = new ShaderMaterial({
      vertexShader: EARTH_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      uniforms: { uCloud: { value: this.cloudTexture }, uSunDirection: { value: sunDirection } },
      transparent: true,
      depthWrite: false,
      side: FrontSide,
    })
    this.cloud = new Mesh(this.cloudGeometry, this.cloudMaterial)
    this.earthGroup.add(this.cloud)

    this.atmosphereMaterial = new ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      uniforms: { uAccent: { value: accent } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      side: FrontSide,
    })
    const atmosphere = new Mesh(this.atmosphereGeometry, this.atmosphereMaterial)
    atmosphere.renderOrder = 4
    this.earthGroup.add(atmosphere)

    const cityCoords: Array<[number, number]> = [
      [39.9, 116.4], [31.2, 121.5], [35.7, 139.7], [1.3, 103.8], [28.6, 77.2],
      [25.2, 55.3], [51.5, -0.1], [48.9, 2.35], [40.7, -74.0], [34.1, -118.2],
      [-23.5, -46.6], [-33.9, 151.2], [30.0, 31.2], [-1.3, 36.8], [19.4, -99.1],
    ]
    for (const [lat, lon] of cityCoords) {
      const node = new Mesh(this.nodeGeometry, this.nodeMaterial)
      node.position.copy(globePoint((lon + 180) / 360, (90 - lat) / 180, 2.075))
      this.earthGroup.add(node)
    }

    this.scanRing.rotation.x = Math.PI / 2
    this.scanRing.renderOrder = 5
    this.scene.add(this.scanRing)
    for (const [radius, tilt, opacity] of [[2.62, 0.52, 0.09], [2.86, -0.61, 0.05]] as const) {
      const geometry = new TorusGeometry(radius, 0.006, 5, 256)
      const material = new MeshBasicMaterial({ color: 0x6ed8e6, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending })
      const orbit = new Mesh(geometry, material)
      orbit.rotation.x = tilt
      orbit.rotation.y = tilt * 0.65
      this.scene.add(orbit)
      this.orbitGeometries.push(geometry)
      this.orbitMaterials.push(material)
    }

    this.scene.add(this.earthGroup)
    this.loadImagery()
    this.loadLand()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(this.host)
    this.resize()
    this.frame = requestAnimationFrame(this.animate)
  }

  private async loadImagery() {
    const loader = new TextureLoader()
    try {
      const [day, night, cloud] = await Promise.all([
        loader.loadAsync(publicAsset('images/earth/blue-marble-july-source.jpg')),
        loader.loadAsync(publicAsset('images/earth/black-marble-source.jpg')),
        loader.loadAsync(publicAsset('images/earth/clouds-source.jpg')),
      ])
      if (this.disposed) {
        day.dispose()
        night.dispose()
        cloud.dispose()
        return
      }
      for (const texture of [day, night, cloud]) {
        texture.wrapS = RepeatWrapping
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
      }
      day.colorSpace = SRGBColorSpace
      night.colorSpace = SRGBColorSpace
      this.dayTexture.dispose()
      this.nightTexture.dispose()
      this.cloudTexture.dispose()
      this.dayTexture = day
      this.nightTexture = night
      this.cloudTexture = cloud
      this.surfaceMaterial.uniforms.uDay.value = day
      this.surfaceMaterial.uniforms.uNight.value = night
      this.cloudMaterial.uniforms.uCloud.value = cloud
    } catch {
      if (!this.disposed) this.onError?.()
    }
  }

  private async loadLand() {
    try {
      const response = await fetch(publicAsset('data/ne_110m_land.geojson'), { signal: this.abort.signal })
      if (!response.ok) throw new Error(`陆地数据 HTTP ${response.status}`)
      const data = await response.json() as LandCollection
      if (this.disposed) return
      const { canvas, context } = makeLandCanvas(data)
      const texture = new CanvasTexture(canvas)
      texture.needsUpdate = true
      this.landTexture.dispose()
      this.landTexture = texture
      this.surfaceMaterial.uniforms.uLand.value = texture

      this.dotGeometry = makeLandDots(context, canvas.width, canvas.height)
      this.dotMaterial = new ShaderMaterial({
        vertexShader: DOT_VERTEX,
        fragmentShader: DOT_FRAGMENT,
        uniforms: { uAccent: { value: new Color(0x8ccbd0) }, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      })
      this.earthGroup.add(new Points(this.dotGeometry, this.dotMaterial))
    } catch (error) {
      if (!this.abort.signal.aborted) this.onError?.()
    }
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.camera.aspect = width / height
    this.camera.fov = width < 600 ? 50 : 44
    this.camera.updateProjectionMatrix()
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(width, height, false)
    if (this.dotMaterial) this.dotMaterial.uniforms.uPixelRatio.value = ratio
  }

  setSpeed(value: number) { this.speed = clamp(value, 0.35, 2) }
  setPaused(value: boolean) { this.paused = value }

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
      if (this.pinchDistance) this.zoom((this.pinchDistance - distance) * 0.015)
      this.pinchDistance = distance
      this.dragDistance = 100
      return
    }
    const dx = x - previous.x
    const dy = y - previous.y
    this.dragDistance += Math.abs(dx) + Math.abs(dy)
    this.targetY += dx * 0.005
    this.targetX = clamp(this.targetX + dy * 0.005, -1.15, 1.15)
  }

  pointerUp(id: number, x: number, y: number, canceled = false) {
    const wasSingle = this.pointers.size === 1
    this.pointers.delete(id)
    if (!canceled && wasSingle && this.dragDistance < 8) this.selectAt(x, y)
    if (this.pointers.size < 2) this.pinchDistance = 0
    this.dragDistance = 100
  }

  private currentPinchDistance() {
    const [a, b] = [...this.pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  zoom(delta: number) { this.targetDistance = clamp(this.targetDistance + delta, 6.3, 12) }

  private selectAt(clientX: number, clientY: number) {
    const bounds = this.host.getBoundingClientRect()
    this.pointer.set((clientX - bounds.left) / bounds.width * 2 - 1, -(clientY - bounds.top) / bounds.height * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObject(this.surface)[0]
    if (!hit) return
    // 先撤销球体组的旋转，再从局部单位向量反算经纬度；回调单位为度，北纬与东经为正。
    const local = this.earthGroup.worldToLocal(hit.point.clone()).normalize()
    this.pingAt(local)
    let phi = Math.atan2(local.z, -local.x)
    if (phi < 0) phi += Math.PI * 2
    const latitude = 90 - Math.acos(clamp(local.y, -1, 1)) * 180 / Math.PI
    const longitude = phi * 180 / Math.PI - 180
    this.onSelect?.({ latitude, longitude })
  }

  private pingAt(direction: Vector3) {
    if (this.reducedMotion) return
    this.pingAge = 0
    this.surfaceMaterial.uniforms.uPingDirection.value.copy(direction)
  }

  ping() {
    const facing = this.earthGroup.worldToLocal(new Vector3(0, 0, 2.04)).normalize()
    this.pingAt(facing)
  }

  resetView() {
    this.targetX = -0.18
    this.targetY = 2.4
    this.targetDistance = 8.5
    this.pingAge = -1
  }

  private animate = (now: number) => {
    this.frame = requestAnimationFrame(this.animate)
    if (document.hidden) { this.lastTime = now; return }
    const dt = Math.min(0.05, this.lastTime ? (now - this.lastTime) / 1000 : 0)
    this.lastTime = now
    if (!this.paused && !this.reducedMotion) this.time += dt * this.speed
    if (this.pingAge >= 0) {
      this.pingAge += dt
      if (this.pingAge > 3.3) this.pingAge = -1
    }
    if (!this.paused && !this.reducedMotion && this.pointers.size === 0) this.targetY += dt * 0.035
    const follow = Math.min(1, dt * 5.4)
    this.earthGroup.rotation.x += (this.targetX - this.earthGroup.rotation.x) * follow
    this.earthGroup.rotation.y += (this.targetY - this.earthGroup.rotation.y) * follow
    if (!this.paused && !this.reducedMotion) this.cloud.rotation.y += dt * 0.002
    this.camera.position.z += (this.targetDistance - this.camera.position.z) * follow
    this.surfaceMaterial.uniforms.uTime.value = this.time
    this.surfaceMaterial.uniforms.uPingAge.value = this.pingAge
    const scanY = (this.time * 0.78) % 5 - 2.5
    this.scanRing.visible = Math.abs(scanY) < 2.06
    this.scanRing.position.y = scanY
    const radius = Math.sqrt(Math.max(0.01, 2.04 * 2.04 - scanY * scanY))
    this.scanRing.scale.setScalar(radius)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    this.abort.abort()
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.globeGeometry.dispose()
    this.atmosphereGeometry.dispose()
    this.cloudGeometry.dispose()
    this.landTexture.dispose()
    this.dayTexture.dispose()
    this.nightTexture.dispose()
    this.cloudTexture.dispose()
    this.surfaceMaterial.dispose()
    this.atmosphereMaterial.dispose()
    this.cloudMaterial.dispose()
    this.dotGeometry?.dispose()
    this.dotMaterial?.dispose()
    this.nodeGeometry.dispose()
    this.nodeMaterial.dispose()
    this.scanRingGeometry.dispose()
    this.scanRingMaterial.dispose()
    this.orbitGeometries.forEach(geometry => geometry.dispose())
    this.orbitMaterials.forEach(material => material.dispose())
    this.stars.geometry.dispose()
    this.stars.material.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
