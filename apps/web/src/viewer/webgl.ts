let known: boolean | undefined;

export function webglAvailable(): boolean {
  if (known !== undefined) return known;
  try {
    const canvas = document.createElement("canvas");
    known = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) !== null;
  } catch {
    known = false;
  }
  return known;
}
