import type { PlaybackSettings, SourceDescriptor } from './types'

type Drawable = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement

interface RuntimeSource {
  drawable: Drawable
  objectUrl?: string
  stream?: MediaStream
}

const defaultPlayback = (duration = 0): PlaybackSettings => ({
  playing: false,
  loop: true,
  monitorAudio: false,
  volume: 0.8,
  currentTime: 0,
  duration,
})

function createTestPattern(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const context = canvas.getContext('2d')
  if (!context) return canvas

  context.fillStyle = '#090b0b'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.lineWidth = 1
  for (let x = 0; x <= canvas.width; x += 80) {
    context.strokeStyle = x % 320 === 0 ? '#ff5a1f' : '#18393c'
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, canvas.height)
    context.stroke()
  }
  for (let y = 0; y <= canvas.height; y += 80) {
    context.strokeStyle = y % 240 === 0 ? '#ff5a1f' : '#18393c'
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(canvas.width, y)
    context.stroke()
  }
  context.strokeStyle = '#60edf2'
  context.lineWidth = 4
  context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6)
  context.beginPath()
  context.moveTo(canvas.width / 2, 0)
  context.lineTo(canvas.width / 2, canvas.height)
  context.moveTo(0, canvas.height / 2)
  context.lineTo(canvas.width, canvas.height / 2)
  context.stroke()
  context.fillStyle = '#edf4ef'
  context.font = '700 42px monospace'
  context.fillText('QUADCAST / CALIBRATION', 42, 66)
  context.fillStyle = '#60edf2'
  context.font = '600 22px monospace'
  context.fillText('1280 × 720  ·  16:9', 44, 104)
  return canvas
}

export class SourceManager {
  private sources = new Map<string, RuntimeSource>()

  constructor() {
    this.sources.set('source-test-pattern', { drawable: createTestPattern() })
  }

  getDrawable = (sourceId: string): TexImageSource | null =>
    this.sources.get(sourceId)?.drawable ?? null

  async addFile(file: File, existingId?: string): Promise<SourceDescriptor> {
    const id = existingId ?? crypto.randomUUID()
    if (existingId) this.remove(existingId)
    const objectUrl = URL.createObjectURL(file)
    if (file.type.startsWith('image/')) {
      const image = new Image()
      image.src = objectUrl
      await image.decode()
      this.sources.set(id, { drawable: image, objectUrl })
      return { id, type: 'file-image', name: file.name, status: 'ready' }
    }

    if (!file.type.startsWith('video/')) {
      URL.revokeObjectURL(objectUrl)
      throw new Error('只支援圖片或影片檔案')
    }

    const video = document.createElement('video')
    video.src = objectUrl
    video.playsInline = true
    video.preload = 'auto'
    video.loop = true
    video.muted = true
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true })
      video.addEventListener('error', () => reject(new Error('無法解碼這個影片格式')), { once: true })
    })
    this.sources.set(id, { drawable: video, objectUrl })
    return {
      id,
      type: 'file-video',
      name: file.name,
      status: 'ready',
      playback: defaultPlayback(video.duration),
    }
  }

  async captureDisplay(existingId?: string): Promise<SourceDescriptor> {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('此瀏覽器不支援畫面擷取')
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60, max: 60 } },
      audio: true,
    })
    const id = existingId ?? crypto.randomUUID()
    if (existingId) this.remove(existingId)
    const video = document.createElement('video')
    video.srcObject = stream
    video.playsInline = true
    video.autoplay = true
    video.muted = true
    await video.play()
    this.sources.set(id, { drawable: video, stream })
    const track = stream.getVideoTracks()[0]
    const name = track?.label || '畫面擷取'
    return {
      id,
      type: 'display-capture',
      name,
      status: 'ready',
      playback: { ...defaultPlayback(), playing: true },
    }
  }

  onCaptureEnded(sourceId: string, callback: () => void): void {
    this.sources.get(sourceId)?.stream?.getVideoTracks()[0]?.addEventListener('ended', callback, { once: true })
  }

  updatePlayback(source: SourceDescriptor): void {
    const drawable = this.sources.get(source.id)?.drawable
    if (!(drawable instanceof HTMLVideoElement) || !source.playback) return
    drawable.loop = source.playback.loop
    drawable.muted = !source.playback.monitorAudio
    drawable.volume = source.playback.volume
    if (Math.abs(drawable.currentTime - source.playback.currentTime) > 0.45 && Number.isFinite(drawable.duration)) {
      drawable.currentTime = Math.min(source.playback.currentTime, drawable.duration || 0)
    }
    if (source.playback.playing && drawable.paused) void drawable.play().catch(() => undefined)
    if (!source.playback.playing && !drawable.paused) drawable.pause()
  }

  getPlaybackTime(sourceId: string): Pick<PlaybackSettings, 'currentTime' | 'duration' | 'playing'> | null {
    const drawable = this.sources.get(sourceId)?.drawable
    if (!(drawable instanceof HTMLVideoElement)) return null
    return {
      currentTime: Number.isFinite(drawable.currentTime) ? drawable.currentTime : 0,
      duration: Number.isFinite(drawable.duration) ? drawable.duration : 0,
      playing: !drawable.paused,
    }
  }

  remove(sourceId: string): void {
    const source = this.sources.get(sourceId)
    if (!source || sourceId === 'source-test-pattern') return
    source.stream?.getTracks().forEach((track) => track.stop())
    if (source.objectUrl) URL.revokeObjectURL(source.objectUrl)
    if (source.drawable instanceof HTMLVideoElement) {
      source.drawable.pause()
      source.drawable.srcObject = null
      source.drawable.removeAttribute('src')
    }
    this.sources.delete(sourceId)
  }

  dispose(): void {
    for (const sourceId of this.sources.keys()) this.remove(sourceId)
  }
}
