import { labelFontSizePx, labelPadding } from "../overlay/draw-constants.ts";
import type { LabelBatch } from "../overlay/types.ts";
import { glyphInstanceBytes, labelBoxInstanceBytes } from "./protocol.ts";

export const glyphAtlasFontPx = 64;

export const glyphAtlasWidth = 1024;

export const glyphAtlasFont = `600 ${glyphAtlasFontPx}px monospace`;

const glyphBuffer = 4;

const fallbackAscent = 0.9;

const fallbackDescent = 0.3;

const missingGlyphAdvance = 32;

const firstGlyphCode = 32;

const lastGlyphCode = 127;

export interface GlyphMeasure {
  readonly advance: number;
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
}

export interface GlyphFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly advance: number;
  readonly ascent: number;
}

export interface GlyphLayout {
  readonly frames: ReadonlyMap<string, GlyphFrame>;
  readonly baselineOffset: number;
  readonly width: number;
  readonly height: number;
}

export interface GlyphAtlas extends GlyphLayout {
  readonly rgba: Uint8Array<ArrayBuffer>;
}

export interface LabelInstances {
  readonly boxes: ArrayBuffer;
  readonly boxCount: number;
  readonly glyphs: ArrayBuffer;
  readonly glyphCount: number;
}

export function glyphCharacters(): string[] {
  const characters: string[] = [];
  for (let code = firstGlyphCode; code <= lastGlyphCode; code++) {
    characters.push(String.fromCharCode(code));
  }
  return characters;
}

export function layoutGlyphs(
  characters: readonly string[],
  measure: (character: string) => GlyphMeasure,
  fontMeasure: { readonly ascent: number; readonly descent: number },
): GlyphLayout {
  const frames = new Map<string, GlyphFrame>();
  let x = 0;
  let rowTop = 0;
  let rowBottom = 0;
  for (const character of characters) {
    if (frames.has(character)) continue;
    const { advance, width, ascent, descent } = measure(character);
    const height = ascent + descent;
    if (x + width + glyphBuffer * 2 > glyphAtlasWidth) {
      x = 0;
      rowTop = rowBottom;
    }
    frames.set(character, {
      x: x + glyphBuffer,
      y: rowTop + glyphBuffer,
      width,
      height,
      advance,
      ascent,
    });
    x += width + glyphBuffer * 2;
    rowBottom = Math.max(rowBottom, rowTop + height + glyphBuffer * 2);
  }
  return {
    frames,
    baselineOffset: (fontMeasure.ascent - fontMeasure.descent) / 2,
    width: glyphAtlasWidth,
    height: 2 ** Math.ceil(Math.log2(rowBottom)),
  };
}

function styleContext(context: CanvasRenderingContext2D): void {
  context.font = glyphAtlasFont;
  context.fillStyle = "#000";
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
}

export function createGlyphAtlas(): GlyphAtlas {
  const canvas = document.createElement("canvas");
  canvas.width = glyphAtlasWidth;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("No 2D canvas context for the label glyphs");
  styleContext(context);
  const measure = (character: string): GlyphMeasure => {
    const metrics = context.measureText(character);
    if (!metrics.actualBoundingBoxAscent) {
      return {
        advance: metrics.width,
        width: metrics.width,
        ascent: glyphAtlasFontPx * fallbackAscent,
        descent: glyphAtlasFontPx * fallbackDescent,
      };
    }
    return {
      advance: metrics.width,
      width: Math.ceil(metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft),
      ascent: Math.ceil(metrics.actualBoundingBoxAscent),
      descent: Math.ceil(metrics.actualBoundingBoxDescent),
    };
  };
  const font = context.measureText("A");
  const fontMeasure = font.fontBoundingBoxAscent
    ? {
        ascent: Math.ceil(font.fontBoundingBoxAscent),
        descent: Math.ceil(font.fontBoundingBoxDescent),
      }
    : { ascent: glyphAtlasFontPx * fallbackAscent, descent: glyphAtlasFontPx * fallbackDescent };
  const layout = layoutGlyphs(glyphCharacters(), measure, fontMeasure);
  canvas.height = layout.height;
  styleContext(context);
  for (const [character, frame] of layout.frames) {
    context.fillText(character, frame.x, frame.y + frame.ascent);
  }
  const image = context.getImageData(0, 0, layout.width, layout.height);
  const rgba = new Uint8Array(image.data.length);
  rgba.set(image.data);
  return { ...layout, rgba };
}

export function buildLabelInstances(labels: LabelBatch, layout: GlyphLayout): LabelInstances {
  const scale = labelFontSizePx / glyphAtlasFontPx;
  const [padX, padY] = labelPadding;
  const texts = Array.from({ length: labels.count }, (_, index) =>
    Array.from(labels.texts[index] ?? ""),
  );
  const drawn = (character: string) => {
    const frame = layout.frames.get(character);
    return frame !== undefined && frame.width > 0 && frame.height > 0 ? frame : null;
  };
  const glyphCount = texts.reduce(
    (count, text) => count + text.filter((character) => drawn(character) !== null).length,
    0,
  );
  const boxes = new ArrayBuffer(labels.count * labelBoxInstanceBytes);
  const boxFloats = new DataView(boxes);
  const boxBytes = new Uint8Array(boxes);
  const glyphs = new Float32Array(glyphCount * (glyphInstanceBytes / 4));
  let glyph = 0;
  texts.forEach((text, index) => {
    const anchorX = labels.positions[index * 2] ?? 0;
    const anchorY = labels.positions[index * 2 + 1] ?? 0;
    const offsetX = labels.offsets[index * 2] ?? 0;
    const offsetY = labels.offsets[index * 2 + 1] ?? 0;
    let travelled = 0;
    for (const character of text) {
      const frame = layout.frames.get(character);
      if (frame === undefined) {
        travelled += missingGlyphAdvance;
        continue;
      }
      if (drawn(character) !== null) {
        const top = glyphAtlasFontPx / 2 + layout.baselineOffset - frame.ascent;
        glyphs.set(
          [
            anchorX,
            anchorY,
            offsetX + padX + travelled * scale,
            offsetY + padY + top * scale,
            frame.width * scale,
            frame.height * scale,
            frame.x,
            frame.y,
            frame.width,
            frame.height,
          ],
          glyph * (glyphInstanceBytes / 4),
        );
        glyph += 1;
      }
      travelled += frame.advance;
    }
    const at = index * labelBoxInstanceBytes;
    const values = [
      anchorX,
      anchorY,
      offsetX,
      offsetY,
      travelled * scale + 2 * padX,
      glyphAtlasFontPx * scale + 2 * padY,
    ];
    values.forEach((value, slot) => {
      boxFloats.setFloat32(at + slot * 4, value, true);
    });
    boxBytes.set(labels.colors.subarray(index * 4, index * 4 + 4), at + 24);
  });
  return { boxes, boxCount: labels.count, glyphs: glyphs.buffer, glyphCount };
}
