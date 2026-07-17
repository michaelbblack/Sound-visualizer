/**
 * PostFX: a WebGL post-processing pass for canvas-drawn scenes.
 * The 2D canvas provides the shapes; this shader provides the "console
 * generation": screen-space god rays (light shafts that stream from the
 * stage glow and are OCCLUDED by dark silhouettes), bloom, filmic tone
 * mapping, chromatic aberration, vignette and animated grain — the classic
 * PS2/early-HD lighting pipeline.
 *
 * Renders at reduced internal resolution and upscales: cheaper, and the
 * softness reads as footage rather than vector art.
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uLight;   // light position in uv space (y up)
uniform vec2 uRes;
uniform float uTime;
uniform float uBeat;   // beat pulse 0..1
uniform vec3 uTint;    // ray/bloom tint from the current wall hue

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;

  // chromatic aberration, stronger at the edges and on the beat
  float ca = (0.0022 + uBeat * 0.002) * smoothstep(0.1, 0.7, length(d));
  vec3 col;
  col.r = texture2D(uScene, uv + d * ca).r;
  col.g = texture2D(uScene, uv).g;
  col.b = texture2D(uScene, uv - d * ca).b;

  // ---- god rays: march toward the light, silhouettes block the shafts ----
  vec2 stepv = (uLight - uv) / 44.0;
  float weight = 1.0;
  float rays = 0.0;
  vec2 s = uv;
  for (int i = 0; i < 44; i++) {
    s += stepv;
    float l = max(0.0, lum(texture2D(uScene, s).rgb) - 0.42);
    rays += l * weight;
    weight *= 0.958;
  }
  rays /= 44.0;
  col += uTint * rays * (1.7 + uBeat * 1.5);

  // ---- cheap wide bloom: bright-passed diagonal taps at two radii ----
  vec3 bloom = vec3(0.0);
  float o1 = 3.0 / uRes.y;
  float o2 = 8.0 / uRes.y;
  bloom += texture2D(uScene, uv + vec2( o1,  o1)).rgb;
  bloom += texture2D(uScene, uv + vec2(-o1,  o1)).rgb;
  bloom += texture2D(uScene, uv + vec2( o1, -o1)).rgb;
  bloom += texture2D(uScene, uv + vec2(-o1, -o1)).rgb;
  bloom += texture2D(uScene, uv + vec2( o2, 0.0)).rgb;
  bloom += texture2D(uScene, uv + vec2(-o2, 0.0)).rgb;
  bloom += texture2D(uScene, uv + vec2(0.0,  o2)).rgb;
  bloom += texture2D(uScene, uv + vec2(0.0, -o2)).rgb;
  bloom *= 0.125;
  col += max(vec3(0.0), bloom - 0.5) * (0.85 + uBeat * 0.5);

  // ---- grade: exposure, filmic tonemap, saturation, contrast S-curve ----
  col *= 1.4;
  col = col / (col + 0.9);
  col = pow(col, vec3(0.85));
  col = mix(vec3(lum(col)), col, 1.35);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.4);

  // vignette
  col *= mix(0.5, 1.0, smoothstep(0.95, 0.3, length(d) * 1.35));

  // animated grain + dither (also kills gradient banding)
  col += (hash(uv * uRes + fract(uTime) * 61.7) - 0.5) * 0.04;

  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
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
        console.warn('PostFX shader error:', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    this.prog = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.u = {
      light: gl.getUniformLocation(prog, 'uLight'),
      res: gl.getUniformLocation(prog, 'uRes'),
      time: gl.getUniformLocation(prog, 'uTime'),
      beat: gl.getUniformLocation(prog, 'uBeat'),
      tint: gl.getUniformLocation(prog, 'uTint'),
    };
    this.ok = true;
  }

  /**
   * scene: a canvas to process. lightX/lightY in scene pixel coords.
   * Returns the processed canvas (internal resolution ~0.55x).
   */
  render(scene, { lightX, lightY, time, beat, tint }) {
    const gl = this.gl;
    const W = Math.max(2, Math.round(scene.width * 0.55));
    const H = Math.max(2, Math.round(scene.height * 0.55));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);

    gl.uniform2f(this.u.light, lightX / scene.width, 1 - lightY / scene.height);
    gl.uniform2f(this.u.res, W, H);
    gl.uniform1f(this.u.time, time % 1000);
    gl.uniform1f(this.u.beat, beat);
    gl.uniform3f(this.u.tint, tint[0], tint[1], tint[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
}
