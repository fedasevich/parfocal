export interface ReferenceScene {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly tileBase64: string;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly filter: "nearest" | "linear";
  readonly channelOrder: "rgb" | "bgr";
  readonly drawTile: boolean;
  readonly background: readonly [number, number, number];
}

export function renderReferenceScene(scene: ReferenceScene): string {
  const canvas = document.createElement("canvas");
  canvas.id = "golden-view";
  canvas.width = scene.canvasWidth;
  canvas.height = scene.canvasHeight;
  canvas.style.width = `${scene.canvasWidth}px`;
  canvas.style.height = `${scene.canvasHeight}px`;
  canvas.style.display = "block";
  document.body.style.margin = "0";
  document.body.replaceChildren(canvas);
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) {
    throw new Error("WebGL2 is not available");
  }
  gl.viewport(0, 0, scene.canvasWidth, scene.canvasHeight);
  gl.clearColor(scene.background[0] / 255, scene.background[1] / 255, scene.background[2] / 255, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!scene.drawTile) {
    gl.finish();
    return `#${canvas.id}`;
  }

  const vertexSource = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;
  const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D tile;
uniform vec2 tileSize;
uniform vec2 offset;
uniform float scale;
uniform float canvasHeight;
uniform vec3 background;
uniform int swapRedBlue;
out vec4 colour;
void main() {
  vec2 screen = vec2(gl_FragCoord.x, canvasHeight - gl_FragCoord.y);
  vec2 texel = (screen - offset) / scale;
  if (any(lessThan(texel, vec2(0.0))) || any(greaterThanEqual(texel, tileSize))) {
    colour = vec4(background, 1.0);
    return;
  }
  vec4 sampled = texture(tile, texel / tileSize);
  colour = vec4(swapRedBlue == 1 ? sampled.bgr : sampled.rgb, 1.0);
}`;

  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error("Could not create a shader");
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed");
    }
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed");
  }
  gl.useProgram(program);

  const binary = atob(scene.tileBase64);
  const pixels = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    pixels[index] = binary.charCodeAt(index);
  }
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    scene.tileWidth,
    scene.tileHeight,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  );
  const filter = scene.filter === "linear" ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const uniform = (name: string): WebGLUniformLocation | null =>
    gl.getUniformLocation(program, name);
  gl.uniform1i(uniform("tile"), 0);
  gl.uniform2f(uniform("tileSize"), scene.tileWidth, scene.tileHeight);
  gl.uniform2f(uniform("offset"), scene.offsetX, scene.offsetY);
  gl.uniform1f(uniform("scale"), scene.scale);
  gl.uniform1f(uniform("canvasHeight"), scene.canvasHeight);
  gl.uniform3f(
    uniform("background"),
    scene.background[0] / 255,
    scene.background[1] / 255,
    scene.background[2] / 255,
  );
  gl.uniform1i(uniform("swapRedBlue"), scene.channelOrder === "bgr" ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.finish();
  return `#${canvas.id}`;
}
