addEventListener("message", (event: MessageEvent<unknown>) => {
  postMessage({ type: "echo", payload: event.data });
});
