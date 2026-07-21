/**
 * WarpEngine: the MilkDrop/Geiss core — per-pixel framebuffer feedback.
 *
 * Two textures ping-pong: each frame the previous frame is re-sampled
 * through a parametric warp field (zoom, rotation, radial swirl, ripple,
 * xy shear), decayed, hue-rotated, and fresh "ink" (a 2D canvas the caller
 * draws into) is added on top. Everything ever drawn becomes fluid, smearing
 * trails that keep evolving — the thing uniform canvas zoom-feedback can't do.
 *
 * A final display pass adds gamma/saturation and a soft vignette.
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const WARP_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform sampler2D uInk;
uniform vec2 uCenter;
uniform vec2 uAspect;
uniform float uZoom;
uniform float uRot;
uniform float uSwirl;
uniform float uSwirlFreq;
uniform float uRipple;
uniform float uRippleFreq;
uniform float uShear;
uniform float uDecay;
uniform float uTime;
uniform vec2 uAdvect;
uniform mat3 uHue;

void main() {
  vec2 p = (vUv - uCenter) * uAspect;
  float r = length(p);
  float a = atan(p.y, p.x);

  a += uRot + uSwirl * sin(r * uSwirlFreq - uTime * 0.9);
  float rr = r * uZoom + uRipple * sin(r * uRippleFreq - uTime * 1.3) * 0.013;

  vec2 q = vec2(cos(a), sin(a)) * rr / uAspect + uCenter;
  q.x += uShear * sin(q.y * 11.0 + uTime * 0.8) * 0.004;
  q.y += uShear * sin(q.x * 13.0 - uTime * 0.7) * 0.004;
  q -= uAdvect; // constant drift: sampling upstream makes content flow +uAdvect

  vec3 prev = uHue * texture2D(uPrev, q).rgb;

  // fade anything dragged in from beyond the borders
  vec2 b = abs(q - 0.5);
  prev *= smoothstep(0.56, 0.47, max(b.x, b.y)) * 0.35 + 0.65;

  vec3 ink = texture2D(uInk, vUv).rgb;
  vec3 c = prev * uDecay - 0.0015 + ink;
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`;

const DISPLAY_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  // soft-knee highlights, slight saturation lift, gentle gamma
  c = c / (1.0 + c * 0.25);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.22);
  c = pow(c, vec3(0.9));
  vec2 d = vUv - 0.5;
  c *= mix(0.72, 1.0, smoothstep(0.85, 0.3, length(d) * 1.3));
  gl_FragColor = vec4(c, 1.0);
}`;

export class WarpEngine {
  constructor() {
    this.ok = false;
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) return;
    this.gl = gl;

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('WarpEngine shader error:', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const link = (fragSrc) => {
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
      if (!vs || !fs) return null;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      return prog;
    };
    this.warpProg = link(WARP_FRAG);
    this.dispProg = link(DISPLAY_FRAG);
    if (!this.warpProg || !this.dispProg) return;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const prog of [this.warpProg, this.dispProg]) {
      gl.useProgram(prog);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }

    this.u = {};
    for (const name of ['uPrev', 'uInk', 'uCenter', 'uAspect', 'uZoom', 'uRot', 'uSwirl', 'uSwirlFreq',
      'uRipple', 'uRippleFreq', 'uShear', 'uDecay', 'uTime', 'uAdvect', 'uHue']) {
      this.u[name] = gl.getUniformLocation(this.warpProg, name);
    }
    this.uDispTex = gl.getUniformLocation(this.dispProg, 'uTex');

    this.inkTex = this._makeTex();
    this.fbos = null;
    this.ok = true;
  }

  _makeTex() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  _resize(w, h) {
    const gl = this.gl;
    // internal resolution ~0.5x: cheaper, and the linear resampling adds the
    // classic soft diffusion every generation of the feedback
    const W = Math.max(320, Math.min(960, Math.round(w * 0.5)));
    const H = Math.max(180, Math.round((W * h) / w));
    if (this.canvas.width === W && this.canvas.height === H && this.fbos) return;
    this.canvas.width = W;
    this.canvas.height = H;
    this.fbos = [0, 1].map(() => {
      const tex = this._makeTex();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cur = 0;
  }

  /**
   * Advance one generation: warp previous frame, add ink, display.
   * inkCanvas must match the engine's internal canvas size (see .canvas).
   */
  step(inkCanvas, p, outW, outH) {
    const gl = this.gl;
    this._resize(outW, outH);
    const W = this.canvas.width;
    const H = this.canvas.height;

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.inkTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inkCanvas);

    const src = this.fbos[this.cur];
    const dst = this.fbos[1 - this.cur];

    gl.useProgram(this.warpProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(this.u.uPrev, 0);
    gl.uniform1i(this.u.uInk, 1);
    gl.uniform2f(this.u.uCenter, p.centerX, p.centerY);
    gl.uniform2f(this.u.uAspect, W / H, 1);
    gl.uniform1f(this.u.uZoom, p.zoom);
    gl.uniform1f(this.u.uRot, p.rot);
    gl.uniform1f(this.u.uSwirl, p.swirl);
    gl.uniform1f(this.u.uSwirlFreq, p.swirlFreq);
    gl.uniform1f(this.u.uRipple, p.ripple);
    gl.uniform1f(this.u.uRippleFreq, p.rippleFreq);
    gl.uniform1f(this.u.uShear, p.shear);
    gl.uniform1f(this.u.uDecay, p.decay);
    gl.uniform1f(this.u.uTime, p.time);
    gl.uniform2f(this.u.uAdvect, p.advectX || 0, p.advectY || 0);
    gl.uniformMatrix3fv(this.u.uHue, false, p.hueMat);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.dispProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    gl.uniform1i(this.uDispTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.cur = 1 - this.cur;
    return this.canvas;
  }
}

/** RGB hue-rotation matrix (column-major mat3) for a small angle in radians. */
export function hueMatrix(theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const a = 1 / 3;
  const b = Math.sqrt(1 / 3);
  return new Float32Array([
    c + (1 - c) * a, a * (1 - c) + b * s, a * (1 - c) - b * s,
    a * (1 - c) - b * s, c + (1 - c) * a, a * (1 - c) + b * s,
    a * (1 - c) + b * s, a * (1 - c) - b * s, c + (1 - c) * a,
  ]);
}
