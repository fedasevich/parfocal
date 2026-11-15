import type { Layer } from "@deck.gl/core";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";

const pathStyleUniformsWgsl = /* wgsl */ `\
struct PathStyleUniforms {
  dashAlignMode: f32,
  dashGapPickable: i32,
  dashUnits: i32,
};

@group(0) @binding(auto)
var<uniform> pathStyle: PathStyleUniforms;

fn pathStyle_mod(value: f32, period: f32) -> f32 {
  return value - period * floor(value / period);
}

fn pathStyle_dashIntegral(position: f32, solidLength: f32, unitLength: f32) -> f32 {
  return floor(position / unitLength) * solidLength +
    min(pathStyle_mod(position, unitLength), solidLength);
}

fn pathStyle_dashCoverage(
  position: f32,
  solidLength: f32,
  unitLength: f32,
  filterWidth: f32
) -> f32 {
  let halfFilter = 0.5 * filterWidth;
  let reducedPosition = pathStyle_mod(position, unitLength);
  return (
    pathStyle_dashIntegral(reducedPosition + halfFilter, solidLength, unitLength) -
    pathStyle_dashIntegral(reducedPosition - halfFilter, solidLength, unitLength)
  ) / filterWidth;
}
`;

const attributeAnchor = "  @location(12) rowIndexes: u32,";
const varyingAnchor = "  @location(8) vPathBounds: vec2<f32>,";
const vertexEndAnchor = "    attributes.instanceColors.a * layer.opacity\n  );";
const fragmentStartKey = "fs:#main-start";
const fragmentEndAnchor = "  // DECKGL_FILTER_COLOR";

const dashArrayAttribute = /* wgsl */ `
  @location(13) instanceDashArrays: vec2<f32>,`;

const dashOffsetAttribute = /* wgsl */ `
  @location(14) instanceDashOffsets: vec2<f32>,`;

const dashVaryings = /* wgsl */ `
  @location(9) vDashArray: vec2<f32>,
  @location(10) vDashOffset: f32,
  @location(11) vDashPathLength: f32,`;

const vertexDashUnits = /* wgsl */ `

  let dashBillboard = path.billboard != 0.0;
  let dashStrokeWidth = select(project_pixel_size_float(widthPixels), widthPixels, dashBillboard);
  let dashWidthPixels =
    dashStrokeWidth * select(project.scale, project.focalDistance, dashBillboard);
  var dashUnitPixels = select(dashStrokeWidth * project.scale, dashStrokeWidth, dashBillboard);
  if (pathStyle.dashUnits == 1) {
    dashUnitPixels = 1.0;
  } else if (pathStyle.dashUnits == 2) {
    dashUnitPixels = project_meter_size_to_pixel(1.0);
  } else if (pathStyle.dashUnits == 3) {
    dashUnitPixels = project.scale;
  }
  varyings.vDashArray = attributes.instanceDashArrays * (dashUnitPixels / dashWidthPixels);`;

const vertexPathPhase = /* wgsl */ `
  let dashOffsetAndLength = attributes.instanceDashOffsets * project.scale / dashWidthPixels;
  varyings.vDashPathLength = dashOffsetAndLength.y;
  let dashVertexUnit = varyings.vDashArray.x + varyings.vDashArray.y;
  var dashPeriod = dashVertexUnit;
  if (pathStyle.dashAlignMode != 0.0) {
    dashPeriod =
      varyings.vDashPathLength /
      max(round(varyings.vDashPathLength / max(dashVertexUnit, 0.0001)), 1.0);
  }
  varyings.vDashOffset = 0.0;
  if (dashPeriod > 0.0) {
    varyings.vDashOffset = pathStyle_mod(dashOffsetAndLength.x, dashPeriod);
  }`;

const vertexSegmentPhase = /* wgsl */ `
  varyings.vDashOffset = 0.0;
  varyings.vDashPathLength = 0.0;`;

const fragmentDash = (justifiedLength: string): string => /* wgsl */ `
  let dashEnabled =
    varyings.vDashArray.x + varyings.vDashArray.y > 0.0 && varyings.vDashArray.y > 0.0;
  var dashSolidLength = varyings.vDashArray.x;
  var dashUnitLength = select(1.0, varyings.vDashArray.x + varyings.vDashArray.y, dashEnabled);
  var dashOffset = varyings.vDashOffset;
  if (pathStyle.dashAlignMode != 0.0) {
    dashUnitLength = max(
      ${justifiedLength} / max(round(${justifiedLength} / dashUnitLength), 1.0),
      0.0001
    );
    dashSolidLength = min(dashSolidLength, dashUnitLength);
    dashOffset = dashSolidLength / 2.0 + varyings.vDashOffset;
  }
  let dashAlongPath = varyings.vPathPosition.y + dashOffset;
  let dashUnitOffset = pathStyle_mod(dashAlongPath, dashUnitLength);
  let dashFilterWidth = max(fwidth(dashAlongPath), 0.0001);
  let dashDistanceAlongGap =
    min(dashUnitOffset - dashSolidLength, dashUnitLength - dashUnitOffset);
  let dashDistanceToEnd =
    length(vec2<f32>(max(dashDistanceAlongGap, 0.0), varyings.vPathPosition.x));
  let dashCapEdgePixels = (1.0 - dashDistanceToEnd) / max(fwidth(dashDistanceToEnd), 1e-6);
  var dashCoverage = 1.0;
  var dashDiscarded = false;
  var dashInRoundedGap = false;
  var dashRoundedCoverage = 1.0;
  var dashSubPixelBlend = 0.0;
  var dashDutyCycle = 1.0;
  if (dashEnabled) {
    if (picking.isActive > 0.5) {
      var dashInGap = dashUnitOffset > dashSolidLength;
      if (dashInGap && path.capType > 0.5) {
        dashInGap = length(vec2<f32>(dashDistanceAlongGap, varyings.vPathPosition.x)) > 1.0;
      }
      dashDiscarded = dashInGap && pathStyle.dashGapPickable == 0;
    } else if (path.capType <= 0.5) {
      dashCoverage =
        pathStyle_dashCoverage(dashAlongPath, dashSolidLength, dashUnitLength, dashFilterWidth);
    } else {
      if (dashDistanceAlongGap > 0.0) {
        dashInRoundedGap = true;
        dashRoundedCoverage = smoothedge(0.0, dashCapEdgePixels);
        dashCoverage = dashRoundedCoverage;
      }
      dashSubPixelBlend = smoothstep(dashUnitLength, 2.0 * dashUnitLength, dashFilterWidth);
      let dashBoundedSolid = min(dashSolidLength, dashUnitLength);
      let dashCapSpan =
        2.0 * sqrt(max(1.0 - varyings.vPathPosition.x * varyings.vPathPosition.x, 0.0));
      dashDutyCycle = clamp(
        (dashBoundedSolid + min(max(dashUnitLength - dashBoundedSolid, 0.0), dashCapSpan)) /
          dashUnitLength,
        0.0,
        1.0
      );
      dashCoverage = mix(dashCoverage, dashDutyCycle, dashSubPixelBlend);
    }
    dashCoverage = clamp(dashCoverage, 0.0, 1.0);
    dashDiscarded = dashDiscarded || dashCoverage <= 0.0;
  }
`;

const fragmentAntialiasedCap = /* wgsl */ `
  if (dashInRoundedGap) {
    let dashPathCoverage = smoothedge(0.0, edgePixels);
    dashCoverage = mix(
      min(dashPathCoverage, dashRoundedCoverage) / max(dashPathCoverage, 1e-6),
      dashDutyCycle,
      dashSubPixelBlend
    );
  }`;

const fragmentEnd = (color: string): string => /* wgsl */ `
  if (dashDiscarded) {
    discard;
  }
  clip_filterColor(varyings.clipCoordinates);
  return deckgl_premultiplied_alpha(vec4<f32>(${color}.rgb, ${color}.a * dashCoverage));`;

export function wgslDashInjections(options: {
  readonly pathPhase: boolean;
  readonly antialiasing: boolean;
}): Record<string, string> {
  const { pathPhase, antialiasing } = options;
  return {
    [attributeAnchor]: dashArrayAttribute + (pathPhase ? dashOffsetAttribute : ""),
    [varyingAnchor]: dashVaryings,
    [vertexEndAnchor]: vertexDashUnits + (pathPhase ? vertexPathPhase : vertexSegmentPhase),
    [fragmentStartKey]: fragmentDash(
      pathPhase ? "varyings.vDashPathLength" : "varyings.vPathLength",
    ),
    [fragmentEndAnchor]:
      (antialiasing ? fragmentAntialiasedCap : "") +
      fragmentEnd(antialiasing ? "color" : "varyings.vColor"),
  };
}

const pathStyleModule = {
  name: "pathStyle",
  source: pathStyleUniformsWgsl,
  uniformTypes: { dashAlignMode: "f32", dashGapPickable: "i32", dashUnits: "i32" },
} as const;

export class WgslDashExtension extends PathStyleExtension {
  static override extensionName = "WgslDashExtension";

  override getShaders(this: Layer<PathStyleExtensionProps>, extension: this): unknown {
    if (this.context.device.type !== "webgpu") return super.getShaders.call(this, extension);
    if (!("pathTesselator" in (this.state ?? {}))) return null;
    const pathPhase = extension.opts.dashMode === "path";
    const antialiasing = Boolean((this.props as { antialiasing?: boolean }).antialiasing);
    return {
      modules: [pathStyleModule],
      defines: { DASH_ENABLED: true, ...(pathPhase ? { HIGH_PRECISION_DASH: true } : {}) },
      inject: wgslDashInjections({ pathPhase, antialiasing }),
    };
  }
}

const converted = new WeakMap<object, WgslDashExtension | null>();

export function wgslDashExtensionFor(extension: unknown): WgslDashExtension | null {
  if (extension instanceof WgslDashExtension) return extension;
  if (!(extension instanceof PathStyleExtension)) return null;
  const known = converted.get(extension);
  if (known !== undefined) return known;
  const { dash, offset, dashMode } = extension.opts;
  const next =
    dash && !offset && dashMode !== undefined ? new WgslDashExtension({ dash, dashMode }) : null;
  converted.set(extension, next);
  return next;
}
