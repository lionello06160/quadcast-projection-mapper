import { invertMatrix3, quadHomography, toGlMatrix3 } from './geometry'
import { sortSurfaces } from './projectState'
import type { ProjectState } from './types'

const vertexShaderSource = `#version 300 es
in vec2 a_position;
out vec2 v_screen;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  vec2 normalized = a_position * 0.5 + 0.5;
  v_screen = vec2(normalized.x, 1.0 - normalized.y);
}`

const fragmentShaderSource = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform mat3 u_inverseHomography;
uniform float u_opacity;
uniform int u_maskCount;
uniform vec2 u_mask[32];
in vec2 v_screen;
out vec4 outColor;
void main() {
  if (u_maskCount >= 3) {
    bool inside = false;
    int previous = u_maskCount - 1;
    for (int index = 0; index < 32; index++) {
      if (index >= u_maskCount) break;
      vec2 currentPoint = u_mask[index];
      vec2 previousPoint = u_mask[previous];
      bool crosses = ((currentPoint.y > v_screen.y) != (previousPoint.y > v_screen.y)) &&
        (v_screen.x < (previousPoint.x - currentPoint.x) * (v_screen.y - currentPoint.y) /
        (previousPoint.y - currentPoint.y + 0.000001) + currentPoint.x);
      if (crosses) inside = !inside;
      previous = index;
    }
    if (!inside) discard;
  }
  vec3 projected = u_inverseHomography * vec3(v_screen, 1.0);
  if (abs(projected.z) < 0.000001) discard;
  vec2 uv = projected.xy / projected.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  vec4 color = texture(u_texture, uv);
  outColor = vec4(color.rgb, color.a * u_opacity);
}`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('無法建立 WebGL shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Shader 編譯失敗'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('無法建立 WebGL program')
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL 連結失敗')
  return program
}

function colorToRgb(color: string): [number, number, number] {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
  if (!match) return [0, 0, 0]
  return [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255]
}

function isDrawableReady(source: TexImageSource): boolean {
  if (source instanceof HTMLVideoElement) return source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  if (source instanceof HTMLImageElement) return source.complete && source.naturalWidth > 0
  return true
}

export class ProjectionRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private textures = new Map<string, WebGLTexture>()
  private resizeObserver: ResizeObserver
  private animationFrame = 0
  private state: ProjectState
  private getDrawable: (id: string) => TexImageSource | null

  constructor(canvas: HTMLCanvasElement, state: ProjectState, getDrawable: (id: string) => TexImageSource | null) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: false })
    if (!gl) throw new Error('此裝置無法啟用 WebGL2')
    this.gl = gl
    this.program = createProgram(gl)
    this.state = state
    this.getDrawable = getDrawable

    const positionBuffer = gl.createBuffer()
    if (!positionBuffer) throw new Error('無法建立 WebGL buffer')
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const positionLocation = gl.getAttribLocation(this.program, 'a_position')
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
    this.render()
  }

  setState(state: ProjectState): void {
    this.state = state
  }

  private resize(): void {
    const canvas = this.gl.canvas as HTMLCanvasElement
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      this.gl.viewport(0, 0, width, height)
    }
  }

  private render = (): void => {
    const gl = this.gl
    this.resize()
    const [red, green, blue] = colorToRgb(this.state.outputBackground)
    gl.clearColor(red, green, blue, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)

    if (!this.state.blackout) {
      const matrixLocation = gl.getUniformLocation(this.program, 'u_inverseHomography')
      const opacityLocation = gl.getUniformLocation(this.program, 'u_opacity')
      const maskCountLocation = gl.getUniformLocation(this.program, 'u_maskCount')
      const maskLocation = gl.getUniformLocation(this.program, 'u_mask[0]')
      const uploaded = new Set<string>()
      for (const surface of sortSurfaces(this.state.surfaces)) {
        if (!surface.visible || !surface.sourceId) continue
        const source = this.getDrawable(surface.sourceId)
        if (!source || !isDrawableReady(source)) continue
        try {
          const inverse = invertMatrix3(quadHomography(surface.corners))
          gl.uniformMatrix3fv(matrixLocation, false, toGlMatrix3(inverse))
          gl.uniform1f(opacityLocation, surface.opacity)
          const mask = surface.mask ?? []
          const maskData = new Float32Array(64)
          mask.slice(0, 32).forEach((point, index) => {
            maskData[index * 2] = point.x
            maskData[index * 2 + 1] = point.y
          })
          gl.uniform1i(maskCountLocation, mask.length)
          gl.uniform2fv(maskLocation, maskData)
          let texture = this.textures.get(surface.sourceId)
          if (!texture) {
            texture = gl.createTexture() ?? undefined
            if (!texture) continue
            gl.bindTexture(gl.TEXTURE_2D, texture)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            this.textures.set(surface.sourceId, texture)
          } else {
            gl.bindTexture(gl.TEXTURE_2D, texture)
          }
          if (!uploaded.has(surface.sourceId)) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
            uploaded.add(surface.sourceId)
          }
          gl.drawArrays(gl.TRIANGLES, 0, 3)
        } catch {
          // Invalid or temporarily unavailable media is intentionally skipped.
        }
      }
    }
    this.animationFrame = requestAnimationFrame(this.render)
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver.disconnect()
    this.textures.forEach((texture) => this.gl.deleteTexture(texture))
    this.textures.clear()
    this.gl.deleteProgram(this.program)
  }
}
