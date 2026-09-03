import { invertMatrix3, quadHomography, toGlMatrix3, triangulatePolygon } from './geometry'
import { sortSurfaces } from './projectState'
import type { ProjectState } from './types'

const vertexShaderSource = `#version 300 es
precision highp float;
precision highp int;
in vec2 a_position;
in vec2 a_uv;
uniform int u_meshMode;
out vec2 v_screen;
out vec2 v_uv;
void main() {
  if (u_meshMode == 1) {
    gl_Position = vec4(a_position.x * 2.0 - 1.0, 1.0 - a_position.y * 2.0, 0.0, 1.0);
    v_screen = a_position;
    v_uv = a_uv;
  } else {
    gl_Position = vec4(a_position, 0.0, 1.0);
    vec2 normalized = a_position * 0.5 + 0.5;
    v_screen = vec2(normalized.x, 1.0 - normalized.y);
    v_uv = vec2(0.0);
  }
}`

const fragmentShaderSource = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_texture;
uniform mat3 u_inverseHomography;
uniform float u_opacity;
uniform int u_meshMode;
in vec2 v_screen;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec2 uv = v_uv;
  if (u_meshMode == 0) {
    vec3 projected = u_inverseHomography * vec3(v_screen, 1.0);
    if (abs(projected.z) < 0.000001) discard;
    uv = projected.xy / projected.z;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  }
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
  private screenPositionBuffer: WebGLBuffer
  private meshPositionBuffer: WebGLBuffer
  private meshUvBuffer: WebGLBuffer
  private positionLocation: number
  private uvLocation: number
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

    const screenPositionBuffer = gl.createBuffer()
    const meshPositionBuffer = gl.createBuffer()
    const meshUvBuffer = gl.createBuffer()
    if (!screenPositionBuffer || !meshPositionBuffer || !meshUvBuffer) throw new Error('無法建立 WebGL buffer')
    this.screenPositionBuffer = screenPositionBuffer
    this.meshPositionBuffer = meshPositionBuffer
    this.meshUvBuffer = meshUvBuffer
    gl.bindBuffer(gl.ARRAY_BUFFER, screenPositionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    this.positionLocation = gl.getAttribLocation(this.program, 'a_position')
    this.uvLocation = gl.getAttribLocation(this.program, 'a_uv')

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
      const meshModeLocation = gl.getUniformLocation(this.program, 'u_meshMode')
      const uploaded = new Set<string>()
      for (const surface of sortSurfaces(this.state.surfaces)) {
        if (!surface.visible || !surface.sourceId) continue
        const source = this.getDrawable(surface.sourceId)
        if (!source || !isDrawableReady(source)) continue
        try {
          gl.uniform1f(opacityLocation, surface.opacity)
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
          const maskUvs = surface.maskUvs
          if (surface.mask && maskUvs?.length === surface.mask.length) {
            const indices = triangulatePolygon(surface.mask)
            if (!indices.length) continue
            const positions = new Float32Array(indices.flatMap((index) => [surface.mask![index].x, surface.mask![index].y]))
            const uvs = new Float32Array(indices.flatMap((index) => [maskUvs[index].x, maskUvs[index].y]))
            gl.uniform1i(meshModeLocation, 1)
            gl.bindBuffer(gl.ARRAY_BUFFER, this.meshPositionBuffer)
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
            gl.enableVertexAttribArray(this.positionLocation)
            gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0)
            gl.bindBuffer(gl.ARRAY_BUFFER, this.meshUvBuffer)
            gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.DYNAMIC_DRAW)
            gl.enableVertexAttribArray(this.uvLocation)
            gl.vertexAttribPointer(this.uvLocation, 2, gl.FLOAT, false, 0, 0)
            gl.drawArrays(gl.TRIANGLES, 0, indices.length)
          } else {
            const inverse = invertMatrix3(quadHomography(surface.corners))
            gl.uniform1i(meshModeLocation, 0)
            gl.uniformMatrix3fv(matrixLocation, false, toGlMatrix3(inverse))
            gl.bindBuffer(gl.ARRAY_BUFFER, this.screenPositionBuffer)
            gl.enableVertexAttribArray(this.positionLocation)
            gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0)
            gl.disableVertexAttribArray(this.uvLocation)
            gl.vertexAttrib2f(this.uvLocation, 0, 0)
            gl.drawArrays(gl.TRIANGLES, 0, 3)
          }
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
    this.gl.deleteBuffer(this.screenPositionBuffer)
    this.gl.deleteBuffer(this.meshPositionBuffer)
    this.gl.deleteBuffer(this.meshUvBuffer)
    this.gl.deleteProgram(this.program)
  }
}
