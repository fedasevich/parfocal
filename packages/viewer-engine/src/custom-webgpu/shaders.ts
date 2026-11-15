export const tileShader = `
struct Frame {
  tint: vec4f,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var atlas: texture_2d_array<f32>;
@group(0) @binding(2) var tileSampler: sampler;

struct TileOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) uvMax: vec2f,
  @location(2) @interpolate(flat) layer: u32,
  @location(3) @interpolate(flat) alpha: f32,
};

@vertex
fn vs(
  @builtin(vertex_index) vertex: u32,
  @location(0) rect: vec4f,
  @location(1) uvMax: vec2f,
  @location(2) layerAlpha: vec2f,
) -> TileOut {
  let corner = vec2f(f32(vertex & 1u), f32((vertex >> 1u) & 1u));
  var out: TileOut;
  out.position = vec4f(mix(rect.xy, rect.zw, corner), 0.0, 1.0);
  out.uv = corner * uvMax;
  out.uvMax = uvMax;
  out.layer = u32(layerAlpha.x);
  out.alpha = layerAlpha.y;
  return out;
}

@fragment
fn fs(in: TileOut) -> @location(0) vec4f {
  let half = 0.5 / vec2f(textureDimensions(atlas));
  let uv = clamp(in.uv, half, in.uvMax - half);
  let texel = textureSampleLevel(atlas, tileSampler, uv, in.layer, 0.0);
  return vec4f(texel.rgb * frame.tint.rgb * in.alpha, in.alpha);
}
`;

const styleBlock = `
struct Style {
  centre: vec2f,
  pixelsPerUnit: f32,
  halfWidth: f32,
  viewport: vec2f,
  alpha: f32,
  colorMode: f32,
  color: vec4f,
  dash: vec2f,
  innerRadius: f32,
  stroked: f32,
  strokeColor: vec4f,
};

@group(0) @binding(0) var<uniform> style: Style;

fn toPixels(world: vec2f) -> vec2f {
  return (world - style.centre) * style.pixelsPerUnit;
}

fn toClip(pixels: vec2f) -> vec4f {
  return vec4f(pixels.x * 2.0 / style.viewport.x, -pixels.y * 2.0 / style.viewport.y, 0.0, 1.0);
}

fn styled(color: vec4f) -> vec4f {
  var base = color;
  if (style.colorMode > 1.5) {
    base = vec4f(style.color.rgb, color.a * style.color.a);
  } else if (style.colorMode > 0.5) {
    base = style.color;
  }
  return vec4f(base.rgb, base.a * style.alpha);
}

fn premultiplied(color: vec4f) -> vec4f {
  return vec4f(color.rgb * color.a, color.a);
}
`;

export const triangleShader = `
${styleBlock}

struct TriangleOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn vs(
  @builtin(vertex_index) vertex: u32,
  @location(0) a: vec2f,
  @location(1) b: vec2f,
  @location(2) c: vec2f,
  @location(3) color: vec4f,
) -> TriangleOut {
  var world = a;
  if (vertex == 1u) {
    world = b;
  }
  if (vertex == 2u) {
    world = c;
  }
  var out: TriangleOut;
  out.position = toClip(toPixels(world));
  out.color = premultiplied(styled(color));
  return out;
}

@fragment
fn fs(in: TriangleOut) -> @location(0) vec4f {
  return in.color;
}
`;

export const segmentShader = `
${styleBlock}

struct SegmentOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) place: vec2f,
  @location(2) @interpolate(flat) size: f32,
  @location(3) @interpolate(flat) travelled: f32,
};

@vertex
fn vs(
  @builtin(vertex_index) vertex: u32,
  @location(0) a: vec2f,
  @location(1) b: vec2f,
  @location(2) reach: f32,
  @location(3) color: vec4f,
) -> SegmentOut {
  let along = f32(vertex & 1u);
  let side = f32((vertex >> 1u) & 1u) * 2.0 - 1.0;
  let start = toPixels(a);
  let end = toPixels(b);
  let delta = end - start;
  let size = length(delta);
  var direction = vec2f(1.0, 0.0);
  if (size > 0.0) {
    direction = delta / size;
  }
  let normal = vec2f(-direction.y, direction.x);
  var out: SegmentOut;
  out.color = premultiplied(styled(color));
  out.travelled = reach * style.pixelsPerUnit;
  if (style.innerRadius > 0.5) {
    let dashed = style.dash.x + style.dash.y > 0.0 && style.dash.y > 0.0;
    let place = vec2f(along * 2.0 - 1.0, side) * style.halfWidth;
    out.position = toClip(start + place);
    if (dashed && (reach <= 0.0 || size == 0.0)) {
      out.position = vec4f(2.0, 2.0, 2.0, 1.0);
    }
    out.place = place;
    out.size = 0.0;
  } else {
    let place = vec2f(along * size, side * style.halfWidth);
    out.position = toClip(start + direction * place.x + normal * place.y);
    out.place = place;
    out.size = size;
  }
  return out;
}

fn dashIntegral(position: f32, solid: f32, period: f32) -> f32 {
  return floor(position / period) * solid + min(position - period * floor(position / period), solid);
}

@fragment
fn fs(in: SegmentOut) -> @location(0) vec4f {
  let nearest = clamp(in.place.x, 0.0, in.size);
  let position = in.travelled + nearest;
  let spread = max(fwidth(position), 0.0001);
  if (length(vec2f(in.place.x - nearest, in.place.y)) > style.halfWidth) {
    discard;
  }
  let period = style.dash.x + style.dash.y;
  var coverage = 1.0;
  if (period > 0.0 && style.dash.y > 0.0) {
    let reduced = position - period * floor(position / period);
    coverage = clamp(
      (dashIntegral(reduced + 0.5 * spread, style.dash.x, period)
        - dashIntegral(reduced - 0.5 * spread, style.dash.x, period)) / spread,
      0.0,
      1.0,
    );
    if (coverage <= 0.0) {
      discard;
    }
  }
  return in.color * coverage;
}
`;

export const pointShader = `
${styleBlock}

struct PointOut {
  @builtin(position) position: vec4f,
  @location(0) fill: vec4f,
  @location(1) place: vec2f,
};

@vertex
fn vs(
  @builtin(vertex_index) vertex: u32,
  @location(0) centre: vec2f,
  @location(1) color: vec4f,
) -> PointOut {
  let corner = vec2f(f32(vertex & 1u), f32((vertex >> 1u) & 1u)) * 2.0 - 1.0;
  let place = corner * (style.halfWidth + 0.5);
  var out: PointOut;
  out.position = toClip(toPixels(centre) + place);
  out.fill = styled(color);
  out.place = place;
  return out;
}

@fragment
fn fs(in: PointOut) -> @location(0) vec4f {
  let reach = length(in.place);
  let inCircle = smoothstep(reach - 0.5, reach + 0.5, style.halfWidth);
  if (inCircle == 0.0) {
    discard;
  }
  var color = in.fill;
  if (style.stroked > 0.5) {
    let stroke = vec4f(style.strokeColor.rgb, style.strokeColor.a * style.alpha);
    let isLine = smoothstep(style.innerRadius - 0.5, style.innerRadius + 0.5, reach);
    color = mix(in.fill, stroke, isLine);
  }
  return premultiplied(vec4f(color.rgb, color.a * inCircle));
}
`;

export const rasterShader = `
${styleBlock}

@group(1) @binding(0) var image: texture_2d<f32>;
@group(1) @binding(1) var imageSampler: sampler;

struct RasterOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> RasterOut {
  let corner = vec2f(f32(vertex & 1u), f32((vertex >> 1u) & 1u));
  var out: RasterOut;
  out.position = toClip(toPixels(style.color.xy + corner * style.color.zw));
  out.uv = corner;
  return out;
}

@fragment
fn fs(in: RasterOut) -> @location(0) vec4f {
  let texel = textureSampleLevel(image, imageSampler, in.uv, 0.0);
  return premultiplied(vec4f(texel.rgb, texel.a * style.alpha));
}
`;

export const pinShader = `
${styleBlock}

@group(1) @binding(0) var icons: texture_2d<f32>;
@group(1) @binding(1) var iconSampler: sampler;

struct PinOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(
  @builtin(vertex_index) vertex: u32,
  @location(0) centre: vec2f,
  @location(1) icon: f32,
) -> PinOut {
  let corner = vec2f(f32(vertex & 1u), f32((vertex >> 1u) & 1u));
  let frameSize = style.color.xy;
  let anchor = style.color.zw;
  let scale = style.halfWidth / frameSize.y;
  let shift = ((corner - 0.5) * frameSize + frameSize * 0.5 - anchor) * scale;
  let frameX = mix(style.dash.x, style.dash.y, icon);
  var out: PinOut;
  out.position = toClip(toPixels(centre) + shift);
  out.uv = (vec2f(frameX, style.innerRadius) + corner * frameSize) / style.strokeColor.xy;
  return out;
}

@fragment
fn fs(in: PinOut) -> @location(0) vec4f {
  let texel = textureSample(icons, iconSampler, in.uv);
  let alpha = texel.a * style.alpha;
  if (alpha < 0.05) {
    discard;
  }
  return premultiplied(vec4f(texel.rgb, alpha));
}
`;

export const labelBoxShader = `
${styleBlock}

struct BoxOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) size: vec2f,
  @location(2) @interpolate(flat) line: vec4f,
};

@vertex
fn vs(
  @builtin(vertex_index) vertex: u32,
  @location(0) anchor: vec2f,
  @location(1) offset: vec2f,
  @location(2) size: vec2f,
  @location(3) line: vec4f,
) -> BoxOut {
  let corner = vec2f(f32(vertex & 1u), f32((vertex >> 1u) & 1u));
  var out: BoxOut;
  out.position = toClip(toPixels(anchor) + offset + corner * size);
  out.uv = corner;
  out.size = size;
  out.line = line;
  return out;
}

@fragment
fn fs(in: BoxOut) -> @location(0) vec4f {
  let place = in.uv * in.size;
  let toEdge = min(min(place.x, in.size.x - place.x), min(place.y, in.size.y - place.y));
  let isLine = smoothstep(toEdge - 0.5, toEdge + 0.5, style.halfWidth);
  let fill = vec4f(style.color.rgb, style.color.a * style.alpha);
  let line = vec4f(in.line.rgb, in.line.a * style.alpha);
  return premultiplied(mix(fill, line, isLine));
}
`;

export const glyphShader = `
${styleBlock}

@group(1) @binding(0) var glyphs: texture_2d<f32>;
@group(1) @binding(1) var glyphSampler: sampler;

struct GlyphOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(
  @builtin(vertex_index) vertex: u32,
  @location(0) anchor: vec2f,
  @location(1) offset: vec2f,
  @location(2) size: vec2f,
  @location(3) frame: vec4f,
) -> GlyphOut {
  let corner = vec2f(f32(vertex & 1u), f32((vertex >> 1u) & 1u));
  var out: GlyphOut;
  out.position = toClip(toPixels(anchor) + offset + corner * size);
  out.uv = (frame.xy + corner * frame.zw) / style.strokeColor.xy;
  return out;
}

@fragment
fn fs(in: GlyphOut) -> @location(0) vec4f {
  let alpha = textureSample(glyphs, glyphSampler, in.uv).a * style.color.a;
  if (alpha < 0.001) {
    discard;
  }
  return premultiplied(vec4f(style.color.rgb, alpha * style.alpha));
}
`;
