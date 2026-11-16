import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { type SamOutputs, type SamPromptOutcome, samFrame } from "@parfocal/viewer-engine";
import { promptFallback } from "../src/aiseg/prompt-fallback.ts";
import { type PromptQuality, promptPassOptionsFor } from "../src/aiseg/prompt-pass.ts";

interface ImageMessage {
  readonly type: "image";
  readonly name: string;
  readonly rgb: string;
  readonly width: number;
  readonly height: number;
  readonly micronsPerPixel: number;
  readonly quality: PromptQuality;
}

interface MaskMessage {
  readonly type: "mask";
  readonly file: string;
  readonly side: number;
  readonly score: number;
}

type Incoming = ImageMessage | MaskMessage | { readonly type: "done" };

const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();

async function next(): Promise<Incoming> {
  const line = await lines.next();
  if (line.done === true) return { type: "done" };
  return JSON.parse(line.value) as Incoming;
}

function send(message: object) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function readFloats(file: string): Float32Array {
  const bytes = readFileSync(file);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

function outputs(mask: MaskMessage): SamOutputs {
  const lowSide = 256;
  return {
    masks: { dims: [1, 1, mask.side, mask.side], data: readFloats(mask.file) },
    iou_predictions: { dims: [1, 1], data: Float32Array.of(mask.score) },
    low_res_masks: { dims: [1, 1, lowSide, lowSide], data: new Float32Array(lowSide * lowSide) },
  };
}

async function outline(image: ImageMessage) {
  let decodes = 0;
  const sam = {
    async prompt(
      _id: string,
      prompt: { readonly points: readonly { x: number; y: number }[] },
    ): Promise<SamPromptOutcome> {
      decodes++;
      const point = prompt.points[0];
      send({ type: "prompt", x: point?.x ?? 0, y: point?.y ?? 0 });
      const reply = await next();
      if (reply.type !== "mask") throw new Error(`expected a mask, got ${reply.type}`);
      return { status: "answer", outputs: outputs(reply), ms: 0 };
    },
  };
  const patch = { x: 0, y: 0, width: image.width, height: image.height, downsample: 1 };
  const rgb = new Uint8Array(readFileSync(image.rgb));
  const started = performance.now();
  const nuclei = await promptFallback(
    sam,
    promptPassOptionsFor(image.micronsPerPixel, image.quality),
  )({ id: image.name, rgb, frame: samFrame(patch) });
  const ms = performance.now() - started;
  send({
    type: "rings",
    name: image.name,
    rings: nuclei.map((nucleus) => Array.from(nucleus.ring, (value) => value - 0.5)),
    decodes,
    ms,
  });
}

for (;;) {
  const message = await next();
  if (message.type === "done") break;
  if (message.type !== "image") throw new Error(`expected an image, got ${message.type}`);
  await outline(message);
}
