/**
 * Page Tint. `smart` maps each pixel's luminance onto the line fg -> bg (white paper becomes the
 * theme background, black ink the theme text colour), keeps a little chroma so links and diagrams
 * stay legible, and leaves rects that hold images untouched. `invert` is a CSS filter on the canvas.
 * The tint pass runs on the GPU (WebGL2) when available and falls back to a CPU loop.
 */
export type RGB = [number, number, number];
/** Rect in 0..1 bitmap space (x0, y0, x1, y1), origin top-left. */
export type NormRect = [number, number, number, number];

export const INVERT_FILTER = 'invert(1) hue-rotate(180deg)';
/** How much of a pixel's own colour (relative to its luminance) survives Smart tint. */
export const SMART_CHROMA = 0.4;
export const MAX_IMAGE_RECTS = 32;

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** The Smart tint of one pixel (0..255 channels). The GLSL shader below mirrors this. */
export function smartTintPixel(r: number, g: number, b: number, bg: RGB, fg: RGB): RGB {
  const l = luminance(r, g, b) / 255;
  const out: RGB = [0, 0, 0];
  const src = [r, g, b];
  for (let i = 0; i < 3; i++) out[i] = clamp255(fg[i] + (bg[i] - fg[i]) * l + (src[i] - l * 255) * SMART_CHROMA);
  return out;
}

export function inRects(x: number, y: number, rects: NormRect[]): boolean {
  for (const r of rects) if (x >= r[0] && x < r[2] && y >= r[1] && y < r[3]) return true;
  return false;
}

/** CPU path: tints `img` in place. Used when WebGL2 is missing, and as the reference for tests. */
export function smartTintImageData(img: { data: Uint8ClampedArray; width: number; height: number }, bg: RGB, fg: RGB, rects: NormRect[]): void {
  const { data, width, height } = img;
  // 256-step LUT for the luminance part keeps the loop cheap.
  const lut = new Float32Array(256 * 3);
  for (let v = 0; v < 256; v++) for (let c = 0; c < 3; c++) lut[v * 3 + c] = fg[c] + (bg[c] - fg[c]) * (v / 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rects.length && inRects(x / width, y / height, rects)) continue;
      const o = (y * width + x) * 4;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const l = luminance(r, g, b);
      const li = Math.round(l);
      data[o] = lut[li * 3] + (r - l) * SMART_CHROMA;
      data[o + 1] = lut[li * 3 + 1] + (g - l) * SMART_CHROMA;
      data[o + 2] = lut[li * 3 + 2] + (b - l) * SMART_CHROMA;
    }
  }
}

// -----------------------------------------------------------------------------------------------
// Colour parsing
// -----------------------------------------------------------------------------------------------

let colorCtx: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour -> RGB. Hex/rgb() are parsed directly; everything else goes through a canvas. */
export function parseCssColor(css: string): RGB {
  const s = css.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  if (typeof document !== 'undefined') {
    colorCtx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (colorCtx) {
      colorCtx.clearRect(0, 0, 1, 1);
      colorCtx.fillStyle = '#000';
      colorCtx.fillStyle = s;
      colorCtx.fillRect(0, 0, 1, 1);
      const d = colorCtx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    }
  }
  return [255, 255, 255];
}

// -----------------------------------------------------------------------------------------------
// WebGL2 tinter
// -----------------------------------------------------------------------------------------------

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = vec2(p.x*0.5+0.5, 0.5-p.y*0.5); gl_Position = vec4(p,0.,1.); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex; uniform vec3 bg; uniform vec3 fg; uniform int n; uniform vec4 rects[${MAX_IMAGE_RECTS}];
void main(){
  vec3 c = texture(tex, uv).rgb;
  for (int i = 0; i < ${MAX_IMAGE_RECTS}; i++) {
    if (i >= n) break;
    vec4 r = rects[i];
    if (uv.x >= r.x && uv.x < r.z && uv.y >= r.y && uv.y < r.w) { o = vec4(c, 1.); return; }
  }
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  o = vec4(clamp(fg + (bg - fg) * l + (c - l) * ${SMART_CHROMA.toFixed(2)}, 0., 1.), 1.);
}`;

export class GlTinter {
  readonly canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private tex: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};

  private constructor(canvas: OffscreenCanvas, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['tex', 'bg', 'fg', 'n', 'rects']) this.u[n] = gl.getUniformLocation(prog, n);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.uniform1i(this.u.tex, 0);
  }

  /** null when WebGL2 isn't available (caller uses the CPU path). */
  static create(): GlTinter | null {
    try {
      if (typeof OffscreenCanvas === 'undefined') return null;
      const c = new OffscreenCanvas(2, 2);
      const gl = c.getContext('webgl2', { premultipliedAlpha: false, antialias: false, alpha: false, preserveDrawingBuffer: true });
      return gl ? new GlTinter(c, gl as WebGL2RenderingContext) : null;
    } catch {
      return null;
    }
  }

  /** Draws the tinted bitmap into `this.canvas` (resized to the bitmap) and returns it. */
  tint(bitmap: ImageBitmap, bg: RGB, fg: RGB, rects: NormRect[]): OffscreenCanvas {
    const { gl, canvas } = this;
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    gl.viewport(0, 0, bitmap.width, bitmap.height);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.uniform3f(this.u.bg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
    gl.uniform3f(this.u.fg, fg[0] / 255, fg[1] / 255, fg[2] / 255);
    const r = rects.slice(0, MAX_IMAGE_RECTS);
    gl.uniform1i(this.u.n, r.length);
    if (r.length) gl.uniform4fv(this.u.rects, new Float32Array(r.flat()));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return canvas;
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
