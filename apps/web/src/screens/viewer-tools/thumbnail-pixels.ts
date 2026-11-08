import type { GrayImage } from "@parfocal/viewer-engine";

const edge = 160;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The thumbnail did not load"));
    image.src = url;
  });
}

export async function grayPixelsOf(url: string): Promise<GrayImage> {
  const image = await loadImage(url);
  const width = edge;
  const height = Math.max(1, Math.round((edge * image.naturalHeight) / image.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("No canvas to read the thumbnail");
  context.drawImage(image, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] =
      0.299 * (rgba[i * 4] ?? 0) + 0.587 * (rgba[i * 4 + 1] ?? 0) + 0.114 * (rgba[i * 4 + 2] ?? 0);
  }
  return { width, height, data };
}
