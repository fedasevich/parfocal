import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { IngestFailure } from "../src/components/ingest-failure.tsx";
import { IngestSkipped } from "../src/components/ingest-skipped.tsx";

function Retryable({ fileName, message }: { fileName: string; message: string }) {
  const [tried, setTried] = useState(false);
  return (
    <div className="grid gap-3">
      <IngestFailure
        fileName={fileName}
        message={message}
        failureClass="transient"
        onRetry={() => setTried(true)}
      />
      {tried ? <p className="m-0 text-body-sm text-fg-dim">Retry pressed</p> : null}
    </div>
  );
}

const meta = {
  title: "Components/Ingest failures",
  decorators: [
    (Story) => (
      <div className="w-[560px] rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const CheckStopped: Story = {
  render: () => (
    <Retryable
      fileName="tumor_044.svs"
      message="Checking this file was stopped before it finished. Upload it again."
    />
  ),
};

export const SizeMismatch: Story = {
  render: () => (
    <Retryable
      fileName="tumor_052.ndpi"
      message="The stored file is not the size the upload announced, so parts are missing. Upload it again."
    />
  ),
};

export const Truncated: Story = {
  render: () => (
    <Retryable
      fileName="cut-short.tiff"
      message="The file is cut short, so parts of the slide are missing. Upload it again."
    />
  ),
};

export const UnsupportedFormat: Story = {
  render: () => (
    <IngestFailure
      fileName="tumor_060.czi"
      message="Zeiss CZI files are not supported. Export the slide as OME-TIFF."
      failureClass="permanent"
      supportHref="mailto:support@parfocal.eu?subject=Refused%20upload%20zeiss-czi"
    />
  ),
};

export const UnreadableSlide: Story = {
  render: () => (
    <IngestFailure
      fileName="tumor_071.svs"
      message="Parfocal recognises this format but cannot read the pixels of this file. It may be damaged or written by a scanner version that is not supported yet."
      failureClass="permanent"
      supportHref="mailto:support@parfocal.eu?subject=Refused%20upload%20unreadable"
    />
  ),
};

export const ResultFile: Story = {
  render: () => (
    <IngestFailure
      fileName="lab_model_v3.geojson"
      message="Every object in this result file lies outside its slide, so nothing was imported."
      failureClass="permanent"
      supportHref="mailto:support@parfocal.eu?subject=Refused%20upload%20result-outside-slide"
    />
  ),
};

export const PermanentWithoutSupportAddress: Story = {
  render: () => (
    <IngestFailure
      fileName="notes.svs"
      message="Parfocal does not recognise this file as a whole slide image."
      failureClass="permanent"
    />
  ),
};

export const SkippedDuplicate: Story = {
  render: () => <IngestSkipped fileName="renamed-copy.svs" />,
};
