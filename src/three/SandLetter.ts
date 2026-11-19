import { CanvasTexture, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderer } from 'three'

export type SandLetterState = { phase: 'written' | 'washing' | 'quiet'; progress: number }
const WAVE_SECONDS = 10.5
const MAX_TEXT_LENGTH = 24

const vertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const fragment = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uLetter;
  uniform vec2 uTexel;
  uniform float uTime;
  uniform float uAspect;
  uniform float uFront;
  uniform float uReach;
  uniform float uPasses;
  uniform float uMotion;
  uniform vec2 uPointer;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p) { return noise(p)*0.55 + noise(p*2.03+9.2)*0.28 + noise(p*4.1+21.4)*0.17; }
  // 字帖 UV 原点为左下。按宽高比匹配 Canvas 比例，避免手机竖屏把汉字压扁。
  vec2 textUv(vec2 uv) { return vec2((uv.x-0.5)/0.85+0.5, (uv.y-0.35)/(0.85*uAspect/3.0)+0.5); }
  float mask(vec2 q) {
    if(q.x<0.0 || q.x>1.0 || q.y<0.0 || q.y>1.0) return 0.0;
    return texture2D(uLetter,q).r;
  }
  void main() {
    vec2 uv=vUv;
    vec2 p=vec2((uv.x-0.5)*uAspect,uv.y)*8.0;
    float time=uTime*uMotion;
    float grain=hash(floor(p*360.0));
    float dunes=fbm(p*2.7);
    float sandRidges=sin(p.y*38.0+fbm(p*1.8)*3.5)*0.012;
    vec3 dry=mix(vec3(0.61,0.43,0.25),vec3(0.84,0.70,0.49),dunes);
    dry+=(grain-0.5)*0.075+sandRidges;
    // 浪头沿屏幕 +Y 为海、-Y 为沙滩；同一岸线场用于泡沫、水层和冲刷覆盖。
    float coast=sin(p.x*1.35+0.5)*0.018 + (fbm(vec2(p.x*1.7,time*0.18))-0.5)*0.038;
    float front=uFront+coast;
    float d=uv.y-front;
    float water=smoothstep(-0.008,0.018,d);
    float visited=smoothstep(uReach-0.018,uReach+0.028,uv.y-coast);
    float wet=max(visited*0.86,smoothstep(-0.08,0.0,d));
    vec3 sand=mix(dry,dry*vec3(0.68,0.76,0.78),wet);

    vec2 q=textUv(uv);
    float text=mask(q);
    float sx=mask(q+vec2(uTexel.x*2.0,0.0))-mask(q-vec2(uTexel.x*2.0,0.0));
    float sy=mask(q+vec2(0.0,uTexel.y*2.0))-mask(q-vec2(0.0,uTexel.y*2.0));
    // 遗留的凹痕按噪声破碎，防止整行文字只做统一透明度淡出。
    float residue=mix(1.0,0.065+noise(p*43.0)*0.065,visited);
    residue*=mix(1.0,pow(0.3,max(0.0,uPasses-1.0)),visited);
    float ink=text*residue;
    sand-=ink*vec3(0.21,0.18,0.13);
    sand+=(sx*0.15+sy*0.11)*residue*vec3(1.0,0.83,0.58);
    sand+=mask(q+vec2(0.0,uTexel.y*5.0))*(1.0-text)*0.028*residue;

    float waves=sin(p.x*4.0+p.y*8.0-time*1.9)+sin(p.x*7.3-p.y*5.0+time*1.3)*0.45;
    float caustic=pow(max(0.0,1.0-abs(sin(p.x*5.2+p.y*8.3+noise(p*2.0)*3.0+time*0.55))),8.0);
    float depth=smoothstep(0.0,0.55,d);
    vec3 sea=mix(vec3(0.24,0.61,0.57),vec3(0.035,0.28,0.34),depth);
    sea+=waves*0.014+caustic*0.075*(1.0-depth);
    float shimmer=pow(max(0.0,noise(p*28.0+vec2(time*0.3,-time*0.2))-0.68)*3.0,4.0);
    sea+=shimmer*0.075;
    vec3 col=mix(sand,sea,water*mix(0.61,0.97,depth));
    // 泡沫由窄浪缘和后方破碎泡沫组成，阈值只负责美术表现，不求解流体。
    float lace=fbm(p*18.0+vec2(0.0,time*0.8));
    float lip=exp(-abs(d)*105.0)*(0.3+0.7*noise(p*54.0));
    float foam=lip + smoothstep(0.52,0.72,lace)*exp(-max(d,0.0)*22.0)*step(0.0,d)*0.75;
    col=mix(col,vec3(0.94,0.96,0.88),clamp(foam,0.0,0.92));
    float glint=exp(-pow((uv.x-0.73)*5.0,2.0))*pow(max(0.0,waves*0.5),5.0)*wet*0.07;
    col+=glint;
    // 指针只轻微扰动水面光泽，不改变冲刷历史或字迹内容。
    col+=exp(-length((uv-uPointer)*vec2(uAspect,1.0))*13.0)*water*0.015;
    col*=1.0-0.12*dot(uv-0.5,uv-0.5);
    gl_FragColor=vec4(col,1.0);
    #include <colorspace_fragment>
  }
`

/** 俯视沙滩的程序化材质场景。UV 中 +Y 朝海，文字遮罩和冲刷历史共用同一坐标。 */
export class SandLetter {
  private renderer: WebGLRenderer | null = null
  private scene = new Scene()
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private geometry: PlaneGeometry | null = null
  private material: ShaderMaterial | null = null
  private texture: CanvasTexture | null = null
  private observer: ResizeObserver | null = null
  private frame = 0
  private disposed = false
  private clock = 0
  private lastTime = 0
  private started = 0
  private phase: SandLetterState['phase'] = 'written'
  private lastReport = ''
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  private uniforms = {
    uLetter: { value: null as CanvasTexture | null }, uTexel: { value: new Vector2(1 / 1536, 1 / 512) },
    uTime: { value: 0 }, uAspect: { value: 1 }, uFront: { value: 0.79 }, uReach: { value: 1 },
    uPasses: { value: 0 }, uMotion: { value: 1 }, uPointer: { value: new Vector2(-10, -10) },
  }

  constructor(private host: HTMLElement, text: string, private onState: (state: SandLetterState) => void) {
    try {
      this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6))
      this.renderer.domElement.setAttribute('aria-hidden', 'true'); host.appendChild(this.renderer.domElement)
      this.geometry = new PlaneGeometry(2, 2)
      this.material = new ShaderMaterial({ uniforms: this.uniforms, vertexShader: vertex, fragmentShader: fragment, depthTest: false, depthWrite: false })
      const surface = new Mesh(this.geometry, this.material); surface.frustumCulled = false; this.scene.add(surface)
      this.uniforms.uMotion.value = this.reduced ? 0.25 : 1
      this.setText(text)
      this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host); this.resize()
      this.frame = requestAnimationFrame(this.tick)
    } catch (error) { this.dispose(); throw error }
  }

  /** 最多 24 个 Unicode 码点、两行；空文本或超出两行返回 false，保留旧字迹。只在本机生成纹理。 */
  setText(value: string) {
    if (this.disposed) return false
    const text = Array.from(value.trim()).slice(0, MAX_TEXT_LENGTH).join('')
    if (!text || value.trim().split(/\n/).length > 2) return false
    const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 512
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建字迹画布')
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    const rawLines = text.split(/\n/).slice(0, 2)
    const lines = rawLines.length > 1 ? rawLines : Array.from(text).length > 12
      ? [Array.from(text).slice(0, 12).join(''), Array.from(text).slice(12).join('')] : [text]
    let size = lines.length === 2 ? 155 : 190
    ctx.font = `${size}px "KaiTi", "STKaiti", "SimSun", serif`
    const width = Math.max(...lines.map(line => ctx.measureText(line).width))
    if (width > 1390) size *= 1390 / width
    ctx.font = `${size}px "KaiTi", "STKaiti", "SimSun", serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'
    lines.forEach((line, index) => ctx.fillText(line, 768, 256 + (index - (lines.length - 1) / 2) * size * 1.28))
    const next = new CanvasTexture(canvas)
    // 这是线性数据遮罩，不设置为 sRGB；CanvasTexture 默认翻转 Y，与 textUv 的左下原点对应。
    const old = this.texture; this.texture = next; this.uniforms.uLetter.value = next; old?.dispose()
    this.rewrite(); return true
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight)
    this.renderer?.setSize(w, h, false); this.uniforms.uAspect.value = w / h
  }

  /** 一次涌浪约 10.5 秒；减少动态效果时缩短到 4.5 秒。忙碌时忽略重复触发。 */
  wash() {
    if (this.disposed || this.phase === 'washing') return
    this.phase = 'washing'; this.started = this.clock; this.uniforms.uPasses.value++
    this.report(0)
  }

  /** 恢复当前文字与干沙，复用现有材质、几何和动画循环。 */
  rewrite() {
    if (this.disposed) return
    this.phase = 'written'; this.uniforms.uFront.value = 0.79; this.uniforms.uReach.value = 1; this.uniforms.uPasses.value = 0
    this.report(0)
  }

  /** 接收视口 CSS 像素坐标，只在海面产生很轻的光泽响应。 */
  pointer(x: number, y: number) {
    const rect = this.host.getBoundingClientRect()
    if (rect.width && rect.height) this.uniforms.uPointer.value.set((x - rect.left) / rect.width, 1 - (y - rect.top) / rect.height)
  }
  leave() { this.uniforms.uPointer.value.set(-10, -10) }

  private report(progress: number) {
    const key = `${this.phase}/${progress}`
    if (key !== this.lastReport) { this.lastReport = key; this.onState({ phase: this.phase, progress }) }
  }

  private tick = (now: number) => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.tick)
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0; this.lastTime = now
    if (document.hidden) return
    this.clock += dt; this.uniforms.uTime.value = this.clock
    if (this.phase === 'washing') {
      const t = Math.min(1, (this.clock - this.started) / (this.reduced ? 4.5 : WAVE_SECONDS))
      const front = 0.79 - 0.62 * Math.pow(Math.sin(t * Math.PI), 1.1)
      this.uniforms.uFront.value = front
      this.uniforms.uReach.value = Math.min(this.uniforms.uReach.value, front)
      if (t === 1) this.phase = 'quiet'
      this.report(Math.round(t * 100))
    }
    this.renderer?.render(this.scene, this.camera)
  }

  /** 构造失败与正常卸载共用去重释放路径，可重复调用。 */
  dispose() {
    if (this.disposed) return
    this.disposed = true; cancelAnimationFrame(this.frame); this.observer?.disconnect()
    this.texture?.dispose(); this.geometry?.dispose(); this.material?.dispose()
    this.renderer?.dispose(); this.renderer?.domElement.remove(); this.renderer = null
  }
}
