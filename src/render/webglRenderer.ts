import type { SymbolId } from '../types';
import { normalizeSegment } from '../utils/math';

type WebGLUniforms = {
  resolution: WebGLUniformLocation | null;
  destRect: WebGLUniformLocation | null;
  srcRect: WebGLUniformLocation | null;
  color: WebGLUniformLocation | null;
  useTexture: WebGLUniformLocation | null;
  shapeMode: WebGLUniformLocation | null;
  texture: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  borderPx: WebGLUniformLocation | null;
  borderInsetPx: WebGLUniformLocation | null;
  cornerRadiusPx: WebGLUniformLocation | null;
  noiseAmp: WebGLUniformLocation | null;
  pulseStrength: WebGLUniformLocation | null;
};

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_pos;
uniform vec2 u_resolution;
uniform mediump vec4 u_destRect;
varying vec2 v_uv;

void main() {
  vec2 local = a_pos;
  vec2 pixel = vec2(
    u_destRect.x + local.x * u_destRect.z,
    u_destRect.y + local.y * u_destRect.w
  );

  vec2 zeroToOne = pixel / u_resolution;
  vec2 clip = vec2(
    zeroToOne.x * 2.0 - 1.0,
    1.0 - zeroToOne.y * 2.0
  );

  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = local;
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

uniform sampler2D u_texture;
uniform mediump vec4 u_destRect;
uniform vec4 u_srcRect;
uniform vec4 u_color;
uniform float u_useTexture;
uniform float u_shapeMode;
uniform float u_time;
uniform float u_borderPx;
uniform float u_borderInsetPx;
uniform float u_cornerRadiusPx;
uniform float u_noiseAmp;
uniform float u_pulseStrength;
varying vec2 v_uv;

float hash1(float n) {
  return fract(sin(n) * 43758.5453);
}

void main() {
  if (u_shapeMode > 1.5) {
    vec2 sizePx = max(vec2(1.0), u_destRect.zw);
    vec2 px = v_uv * sizePx;
    float cornerRadius = clamp(u_cornerRadiusPx, 0.0, max(0.0, min(sizePx.x, sizePx.y) * 0.5 - 0.01));

    vec2 halfSize = sizePx * 0.5;
    vec2 p = px - halfSize;
    vec2 q = abs(p) - (halfSize - vec2(cornerRadius));
    float outside = length(max(q, vec2(0.0)));
    float inside = min(max(q.x, q.y), 0.0);
    float d = -(outside + inside - cornerRadius);

    float left = px.x;
    float right = sizePx.x - px.x;
    float top = px.y;
    float bottom = sizePx.y - px.y;

    float side = 0.0;
    float s = 0.0;
    float perimeter = max(1.0, (sizePx.x + sizePx.y) * 2.0);
    if (top <= left && top <= right && top <= bottom) {
      side = 0.0;
      s = px.x;
    } else if (right <= left && right <= top && right <= bottom) {
      side = 1.0;
      s = sizePx.x + px.y;
    } else if (bottom <= left && bottom <= right && bottom <= top) {
      side = 2.0;
      s = sizePx.x + sizePx.y + (sizePx.x - px.x);
    } else {
      side = 3.0;
      s = sizePx.x + sizePx.y + sizePx.x + (sizePx.y - px.y);
    }

    float sideSeed = hash1(side * 17.31 + sizePx.x * 0.013 + sizePx.y * 0.007);
    float phase = s * (0.12 + sideSeed * 0.06) + u_time * (6.0 + sideSeed * 4.0);
    float n1 = sin(phase);
    float n2 = sin(phase * 1.87 + 1.6 + sideSeed * 5.1);
    float n3 = sin(phase * 2.53 + 0.73);
    float waviness = (n1 * 0.58 + n2 * 0.3 + n3 * 0.12) * u_noiseAmp;

    float borderCenter = max(0.5, u_borderInsetPx + waviness);
    float borderDist = d - borderCenter;
    float core = exp(-pow(borderDist / max(1.0, u_borderPx * 0.72), 2.0));
    float glow = exp(-pow(borderDist / max(1.0, u_borderPx * 2.1), 2.0)) * 0.55;

    float pulseA = fract(u_time * 0.11 + 0.07);
    float pulseB = fract(u_time * 0.11 + 0.41);
    float pulseC = fract(u_time * 0.11 + 0.78);
    float posA = pulseA * perimeter;
    float posB = pulseB * perimeter;
    float posC = pulseC * perimeter;
    float dsA = min(abs(s - posA), perimeter - abs(s - posA));
    float dsB = min(abs(s - posB), perimeter - abs(s - posB));
    float dsC = min(abs(s - posC), perimeter - abs(s - posC));
    float pulseBand = exp(-pow(dsA / 18.0, 2.0)) + exp(-pow(dsB / 22.0, 2.0)) + exp(-pow(dsC / 16.0, 2.0));
    pulseBand *= exp(-pow(borderDist / max(1.0, u_borderPx * 1.25), 2.0));
    float outerFade = smoothstep(0.0, max(0.75, u_borderInsetPx * 0.95), d);

    float flicker = 0.84 + 0.16 * sin(u_time * 21.0 + s * 0.2 + side * 3.1);
    float alpha = (core + glow + pulseBand * u_pulseStrength) * u_color.a * flicker * outerFade;
    if (alpha <= 0.003) {
      discard;
    }
    gl_FragColor = vec4(u_color.rgb * (0.9 + pulseBand * 0.24), alpha);
  } else if (u_shapeMode > 0.5) {
    vec2 centered = v_uv - vec2(0.5, 0.5);
    float dist = length(centered) * 2.0;
    if (dist > 1.0) {
      discard;
    }
    float feather = smoothstep(1.0, 0.72, dist);
    gl_FragColor = vec4(u_color.rgb, u_color.a * feather);
  } else if (u_useTexture > 0.5) {
    vec2 uv = vec2(
      mix(u_srcRect.x, u_srcRect.z, v_uv.x),
      mix(u_srcRect.y, u_srcRect.w, v_uv.y)
    );
    vec4 tex = texture2D(u_texture, uv);
    gl_FragColor = tex * u_color;
  } else {
    gl_FragColor = u_color;
  }
}
`;

export class WebGLRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly spriteImage: HTMLImageElement;
  private readonly spriteElementsCount: number;

  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: WebGLUniforms;
  private readonly quadBuffer: WebGLBuffer;
  private readonly texture: WebGLTexture;

  private viewportW = 1;
  private viewportH = 1;
  private readonly spriteWidth: number;
  private readonly spriteHeight: number;
  private readonly spriteSegmentHeight: number;

  public constructor(params: {
    canvas: HTMLCanvasElement;
    spriteImage: HTMLImageElement;
    spriteElementsCount: number;
  }) {
    this.canvas = params.canvas;
    this.spriteImage = params.spriteImage;
    this.spriteElementsCount = Math.max(1, params.spriteElementsCount);
    this.spriteWidth = this.spriteImage.width;
    this.spriteHeight = this.spriteImage.height;
    this.spriteSegmentHeight = this.spriteHeight / this.spriteElementsCount;

    const gl =
      (this.canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
      }) as WebGLRenderingContext | null) ??
      this.canvas.getContext('webgl', { alpha: true, antialias: false });
    if (!gl) {
      throw new Error('WebGL context is not available');
    }
    this.gl = gl;

    const vertexShader = this.createShader(this.gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    this.program = this.createProgram(vertexShader, fragmentShader);
    this.gl.deleteShader(vertexShader);
    this.gl.deleteShader(fragmentShader);

    const quadBuffer = this.gl.createBuffer();
    if (!quadBuffer) {
      throw new Error('Failed to create WebGL quad buffer');
    }
    this.quadBuffer = quadBuffer;

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      this.gl.STATIC_DRAW,
    );

    const texture = this.gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create WebGL texture');
    }
    this.texture = texture;

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 0);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      this.spriteImage,
    );
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    this.gl.useProgram(this.program);
    const posLocation = this.gl.getAttribLocation(this.program, 'a_pos');
    this.gl.enableVertexAttribArray(posLocation);
    this.gl.vertexAttribPointer(posLocation, 2, this.gl.FLOAT, false, 8, 0);

    this.uniforms = {
      resolution: this.gl.getUniformLocation(this.program, 'u_resolution'),
      destRect: this.gl.getUniformLocation(this.program, 'u_destRect'),
      srcRect: this.gl.getUniformLocation(this.program, 'u_srcRect'),
      color: this.gl.getUniformLocation(this.program, 'u_color'),
      useTexture: this.gl.getUniformLocation(this.program, 'u_useTexture'),
      shapeMode: this.gl.getUniformLocation(this.program, 'u_shapeMode'),
      texture: this.gl.getUniformLocation(this.program, 'u_texture'),
      time: this.gl.getUniformLocation(this.program, 'u_time'),
      borderPx: this.gl.getUniformLocation(this.program, 'u_borderPx'),
      borderInsetPx: this.gl.getUniformLocation(this.program, 'u_borderInsetPx'),
      cornerRadiusPx: this.gl.getUniformLocation(this.program, 'u_cornerRadiusPx'),
      noiseAmp: this.gl.getUniformLocation(this.program, 'u_noiseAmp'),
      pulseStrength: this.gl.getUniformLocation(this.program, 'u_pulseStrength'),
    };

    this.gl.uniform1i(this.uniforms.texture, 0);
    this.gl.uniform1f(this.uniforms.time, 0);
    this.gl.uniform1f(this.uniforms.borderPx, 1);
    this.gl.uniform1f(this.uniforms.borderInsetPx, 0);
    this.gl.uniform1f(this.uniforms.cornerRadiusPx, 0);
    this.gl.uniform1f(this.uniforms.noiseAmp, 0);
    this.gl.uniform1f(this.uniforms.pulseStrength, 0);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
  }

  public resize(width: number, height: number): void {
    this.viewportW = Math.max(1, Math.floor(width));
    this.viewportH = Math.max(1, Math.floor(height));
    this.gl.viewport(0, 0, this.viewportW, this.viewportH);
  }

  public beginFrame(): void {
    this.gl.useProgram(this.program);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.uniform2f(this.uniforms.resolution, this.viewportW, this.viewportH);
    this.gl.uniform1f(this.uniforms.shapeMode, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  public drawSprite(
    symbolId: SymbolId,
    x: number,
    y: number,
    width: number,
    height: number,
    alpha = 1,
  ): void {
    const segmentIndex = normalizeSegment(symbolId, this.spriteElementsCount);
    const srcTop = segmentIndex * this.spriteSegmentHeight;
    const srcBottom = srcTop + this.spriteSegmentHeight;

    const inset = 0.5;
    const u0 = inset / this.spriteWidth;
    const u1 = 1 - inset / this.spriteWidth;
    const v0 = 1 - (srcBottom - inset) / this.spriteHeight;
    const v1 = 1 - (srcTop + inset) / this.spriteHeight;

    this.gl.uniform4f(this.uniforms.destRect, x, y, width, height);
    this.gl.uniform4f(this.uniforms.srcRect, u0, v0, u1, v1);
    this.gl.uniform4f(this.uniforms.color, 1, 1, 1, alpha);
    this.gl.uniform1f(this.uniforms.shapeMode, 0);
    this.gl.uniform1f(this.uniforms.useTexture, 1);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  public drawSolidRect(
    x: number,
    y: number,
    width: number,
    height: number,
    rgba: [number, number, number, number],
  ): void {
    this.gl.uniform4f(this.uniforms.destRect, x, y, width, height);
    this.gl.uniform4f(this.uniforms.srcRect, 0, 0, 1, 1);
    this.gl.uniform4f(this.uniforms.color, rgba[0], rgba[1], rgba[2], rgba[3]);
    this.gl.uniform1f(this.uniforms.shapeMode, 0);
    this.gl.uniform1f(this.uniforms.useTexture, 0);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  public drawSoftCircle(
    centerX: number,
    centerY: number,
    radius: number,
    rgba: [number, number, number, number],
  ): void {
    const diameter = radius * 2;
    this.gl.uniform4f(
      this.uniforms.destRect,
      centerX - radius,
      centerY - radius,
      diameter,
      diameter,
    );
    this.gl.uniform4f(this.uniforms.srcRect, 0, 0, 1, 1);
    this.gl.uniform4f(this.uniforms.color, rgba[0], rgba[1], rgba[2], rgba[3]);
    this.gl.uniform1f(this.uniforms.useTexture, 0);
    this.gl.uniform1f(this.uniforms.shapeMode, 1);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    this.gl.uniform1f(this.uniforms.shapeMode, 0);
  }

  public drawElectricBorder(params: {
    x: number;
    y: number;
    width: number;
    height: number;
    rgba: [number, number, number, number];
    timeMs: number;
    borderThicknessPx: number;
    borderInsetPx: number;
    cornerRadiusPx: number;
    noiseAmplitudePx: number;
    pulseStrength: number;
  }): void {
    this.gl.uniform4f(this.uniforms.destRect, params.x, params.y, params.width, params.height);
    this.gl.uniform4f(this.uniforms.srcRect, 0, 0, 1, 1);
    this.gl.uniform4f(
      this.uniforms.color,
      params.rgba[0],
      params.rgba[1],
      params.rgba[2],
      params.rgba[3],
    );
    this.gl.uniform1f(this.uniforms.useTexture, 0);
    this.gl.uniform1f(this.uniforms.shapeMode, 2);
    this.gl.uniform1f(this.uniforms.time, params.timeMs * 0.001);
    this.gl.uniform1f(this.uniforms.borderPx, Math.max(0.5, params.borderThicknessPx));
    this.gl.uniform1f(this.uniforms.borderInsetPx, Math.max(0, params.borderInsetPx));
    this.gl.uniform1f(this.uniforms.cornerRadiusPx, Math.max(0, params.cornerRadiusPx));
    this.gl.uniform1f(this.uniforms.noiseAmp, Math.max(0, params.noiseAmplitudePx));
    this.gl.uniform1f(this.uniforms.pulseStrength, Math.max(0, params.pulseStrength));
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    this.gl.uniform1f(this.uniforms.shapeMode, 0);
  }

  public beginAdditiveBlend(): void {
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
  }

  public endAdditiveBlend(): void {
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
  }

  public dispose(): void {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteBuffer(this.quadBuffer);
    this.gl.deleteProgram(this.program);
  }

  private createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error('Failed to create WebGL shader');
    }
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message = this.gl.getShaderInfoLog(shader) ?? 'unknown error';
      this.gl.deleteShader(shader);
      throw new Error(`WebGL shader compile failed: ${message}`);
    }
    return shader;
  }

  private createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram {
    const program = this.gl.createProgram();
    if (!program) {
      throw new Error('Failed to create WebGL program');
    }
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const message = this.gl.getProgramInfoLog(program) ?? 'unknown error';
      this.gl.deleteProgram(program);
      throw new Error(`WebGL program link failed: ${message}`);
    }
    return program;
  }
}
