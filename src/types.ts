export type Point = { x: number; y: number }
export type SourceType = 'file-video' | 'file-image' | 'display-capture' | 'test-pattern'
export type SourceStatus = 'ready' | 'disconnected' | 'ended' | 'error'

export interface PlaybackSettings {
  playing: boolean
  loop: boolean
  monitorAudio: boolean
  volume: number
  currentTime: number
  duration: number
}

export interface SourceDescriptor {
  id: string
  type: SourceType
  name: string
  status: SourceStatus
  playback?: PlaybackSettings
  error?: string
}

export interface Surface {
  id: string
  name: string
  sourceId: string | null
  corners: [Point, Point, Point, Point]
  mask: Point[] | null
  opacity: number
  visible: boolean
  zIndex: number
}

export interface ProjectState {
  version: 1
  outputBackground: string
  surfaces: Surface[]
  sources: SourceDescriptor[]
  selectedSurfaceId: string | null
  blackout: boolean
  showGrid: boolean
}

export interface ProjectionBridge {
  getDrawable: (sourceId: string) => TexImageSource | null
  getState: () => ProjectState
}

export type ProjectionMessage =
  | { type: 'projection:state'; state: ProjectState }
  | { type: 'projection:ready' }
  | { type: 'projection:closed' }

declare global {
  interface Window {
    __projectionBridge?: ProjectionBridge
  }
}
