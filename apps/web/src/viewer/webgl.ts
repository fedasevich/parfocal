import { useEffect, useState } from "react";

let known: boolean | undefined;

function probe(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (context === null) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function webglAvailable(): boolean {
  known ??= probe();
  return known;
}

export function useWebglAvailable(): boolean {
  const [available, setAvailable] = useState(known ?? false);
  useEffect(() => {
    setAvailable(webglAvailable());
  }, []);
  return available;
}
