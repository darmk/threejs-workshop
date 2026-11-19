/** 只在用户点击后申请麦克风；实时分析音量与中高频噪声，不录音、不发送音频。 */
export class BlowInput {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private wave = new Uint8Array(2048)
  private spectrum = new Uint8Array(1024)
  private token = 0
  private started = 0
  private baseline = 0.012

  /** 开始后前 1.2 秒估计环境底噪；取消申请时，迟到的媒体流也会立即关闭。 */
  async start() {
    this.stop()
    const token = ++this.token
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('UNSUPPORTED')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
    if (token !== this.token) { stream.getTracks().forEach(track => track.stop()); return false }
    this.stream = stream
    try {
      const context = new AudioContext()
      this.context = context
      await context.resume()
      if (token !== this.token) return false
      this.source = context.createMediaStreamSource(stream)
      this.analyser = context.createAnalyser()
      this.analyser.fftSize = 2048
      this.analyser.smoothingTimeConstant = 0.65
      this.source.connect(this.analyser)
      this.started = performance.now(); this.baseline = 0.012
      return true
    } catch (error) { if (token === this.token) this.stop(); throw error }
  }

  get calibrating() { return this.analyser !== null && performance.now() - this.started < 1200 }

  /** 返回 0—1 的经验气流强度；这是噪声启发式检测，不能严格区分吹气和环境杂音。 */
  read() {
    const analyser = this.analyser
    if (!analyser) return 0
    analyser.getByteTimeDomainData(this.wave)
    let energy = 0
    for (const value of this.wave) energy += ((value - 128) / 128) ** 2
    const rms = Math.sqrt(energy / this.wave.length)
    if (this.calibrating) { this.baseline = this.baseline * 0.94 + rms * 0.06; return 0 }
    analyser.getByteFrequencyData(this.spectrum)
    let low = 0, high = 0
    const hzPerBin = (this.context?.sampleRate ?? 48000) / 2048
    for (let i = 1; i < this.spectrum.length; i++) {
      const hz = i * hzPerBin
      if (hz < 180) low += this.spectrum[i]
      else if (hz < 4200) high += this.spectrum[i]
    }
    // 门限为视觉交互的经验值；抑制低频碰撞声，环境很吵时仍建议使用按钮。
    const threshold = Math.max(0.025, this.baseline * 2.8)
    const broadband = Math.min(1, high / Math.max(1, low * 2.5))
    return Math.max(0, Math.min(1, (rms - threshold) / 0.16)) * broadband
  }

  /** 同步撤销流和节点所有权；AudioContext 异步关闭不阻塞页面卸载。可重复调用。 */
  stop() {
    this.token++
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null
    this.source?.disconnect(); this.source = null
    this.analyser?.disconnect(); this.analyser = null
    const context = this.context; this.context = null
    if (context && context.state !== 'closed') void context.close().catch(() => {})
  }
}
