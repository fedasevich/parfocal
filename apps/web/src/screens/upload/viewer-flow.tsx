import type { Project, UploadBatch } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { FlowBar, FlowPage } from "@parfocal/ui/components/flow-page";
import { Icon } from "@parfocal/ui/components/icon";
import { FactList } from "@parfocal/ui/components/inspector";
import { Switch } from "@parfocal/ui/components/switch";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { type ReactNode, useState } from "react";
import { CheckRow, FileIcon, FileList, FileRow, SlideOverlay, useCrumbLink } from "./parts.tsx";

export function ViewerFlow({
  project,
  batch,
  slideHref,
  onCancel,
  onAdded,
}: {
  project: Project;
  batch: UploadBatch;
  slideHref: string;
  onCancel: () => void;
  onAdded: (message: ReactNode) => void;
}) {
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [show, setShow] = useState(true);
  const renderLink = useCrumbLink();
  const preview = batch.result_preview;
  const go = (next: number) => {
    setStep(next);
    setReached(Math.max(reached, next));
  };
  return (
    <FlowPage
      data-testid="add-result-set"
      className="h-full"
      renderLink={renderLink}
      crumbs={[
        { label: project.name, href: `/projects/${project.id}` },
        { label: `Slide ${batch.result_preview.slide_label}`, href: slideHref },
        { label: "Add a result set" },
      ]}
      title="Add a result set"
      subtitle={
        <>
          To slide {preview.slide_label} in case{" "}
          <span className="font-mono">{preview.case_label}</span>, {project.name}
        </>
      }
      steps={[
        { label: "File", ...(step !== 0 ? { why: "Go to File" } : {}) },
        {
          label: "Check",
          ...(reached < 1 ? { why: "Not reached yet. Use Next." } : {}),
          ...(reached >= 1 && step !== 1 ? { state: "done" as const } : {}),
        },
      ]}
      current={step}
      onStepSelect={go}
      bar={
        step === 0 ? (
          <FlowBar
            back={<Button onClick={onCancel}>Cancel</Button>}
            hint="Parfocal reads the file and lines it up with A1 before anything is added."
            next={
              <Button variant="primary" onClick={() => go(1)}>
                Next
              </Button>
            }
          />
        ) : (
          <FlowBar
            back={<Button onClick={() => go(0)}>Back</Button>}
            hint="It goes on A1 only. Every result set records its file, model and version."
            next={
              <Button
                variant="primary"
                onClick={() =>
                  onAdded(`${preview.model} ${preview.version} is a result set on A1 (mock)`)
                }
              >
                <Icon name="layers" />
                Add result set
              </Button>
            }
          />
        )
      }
    >
      {step === 0 ? (
        <Zone title="File">
          <FileList>
            <FileRow lead={<FileIcon />} name={preview.file} detail={preview.detail} />
          </FileList>
          <FactList
            rows={[
              { icon: "smart", label: "Model", value: preview.model },
              {
                icon: "flag",
                label: "Version",
                value: (
                  <>
                    <span className="font-mono">{preview.version}</span>, read from the file
                  </>
                ),
              },
            ]}
          />
        </Zone>
      ) : (
        <>
          <Zone title="Preview" end={<Hint>In cyan, not saved yet</Hint>}>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-5">
              <SlideOverlay kind="regions" height={196} />
              <div className="grid gap-1.5">
                {preview.checks.map((check) => (
                  <CheckRow key={check} tone="ok">
                    {check}
                  </CheckRow>
                ))}
              </div>
            </div>
          </Zone>
          <Zone title="Alignment" end={<StatusTag tone="ok">Looks right</StatusTag>}>
            <FactList
              rows={[
                {
                  icon: "layers",
                  label: "Pyramid level",
                  value: <span className="font-mono">{preview.level}</span>,
                },
                {
                  icon: "expand",
                  label: "Scale",
                  value: <span className="font-mono">{preview.scale.toFixed(2)}</span>,
                },
                {
                  icon: "target",
                  label: "Shift x, y",
                  value: <span className="font-mono">{preview.shift.join(", ")}</span>,
                },
              ]}
            />
          </Zone>
          <Zone title="After adding">
            <label className="flex cursor-pointer items-center justify-between gap-4">
              <span className="grid gap-0.5">
                <b className="text-body-sm font-semibold">
                  Show next to {preview.beside} after adding
                </b>
                <small className="text-body-sm text-fg-dim">
                  Both result sets draw on A1, each in its own color
                </small>
              </span>
              <Switch checked={show} onCheckedChange={setShow} aria-label="Show after adding" />
            </label>
          </Zone>
        </>
      )}
    </FlowPage>
  );
}
