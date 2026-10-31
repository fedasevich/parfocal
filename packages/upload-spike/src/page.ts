export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Upload spike</title></head>
<body>
<input type="file" id="file">
<script type="module">
import { AwsS3, Uppy } from "/uppy.min.mjs";

const state = {
  status: "idle",
  bytesUploaded: 0,
  bytesTotal: 0,
  error: null,
  errors: [],
  partsUploaded: [],
  result: null,
};
window.spikeState = state;
let uppy = null;

window.spikeUpload = async ({ partBytes, resume }) => {
  const file = document.getElementById("file").files[0];
  uppy = new Uppy({ autoProceed: false });
  uppy.use(AwsS3, {
    companionEndpoint: location.origin,
    shouldUseMultipart: true,
    getChunkSize: () => partBytes,
    limit: 1,
  });
  uppy.on("upload-progress", (_file, progress) => {
    state.bytesUploaded = progress.bytesUploaded;
    state.bytesTotal = progress.bytesTotal;
  });
  uppy.on("s3-multipart:part-uploaded", (_file, part) => {
    state.partsUploaded.push(part.PartNumber);
  });
  uppy.on("upload-error", (_file, error) => {
    state.status = "error";
    state.error = String(error && error.message ? error.message : error);
    state.errors.push(state.error);
  });
  uppy.on("upload-success", (_file, response) => {
    state.status = "done";
    state.result = response.body;
  });
  const fileId = uppy.addFile({
    name: file.name,
    type: "application/octet-stream",
    data: file,
    meta: { size: file.size },
  });
  if (resume) {
    const open = await fetch("/uploads/open?name=" + encodeURIComponent(file.name) + "&size=" + file.size);
    if (!open.ok) {
      throw new Error("no open upload to resume");
    }
    uppy.setFileState(fileId, { s3Multipart: await open.json() });
  }
  state.status = "uploading";
  state.error = null;
  void uppy.upload();
  return { name: file.name, size: file.size };
};

window.spikeRetry = () => {
  state.status = "uploading";
  state.error = null;
  void uppy.retryAll();
};
</script>
</body>
</html>
`;
