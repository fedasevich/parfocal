import { type UploadBatch, useListSourceFiles } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import type { ReactNode } from "react";
import { FileIcon, FileList, FileName, FileRow, TextLink, Thumb } from "./parts.tsx";
import {
  gb,
  type PairRule,
  plural,
  shortName,
  type UploadModel,
  type UploadScene,
  type UploadState,
} from "./state.ts";

const ruleText: Record<PairRule, string> = {
  auto: "Grouped by folder, then name, then the slide ID inside",
  name: "Grouped by same name only",
  id: "Grouped by the slide ID inside each file",
};

const ruleOptions = [
  { value: "auto", label: "Folder, then name, then ID" },
  { value: "name", label: "Same name only" },
  { value: "id", label: "Slide ID inside only" },
];

type StepProps = {
  batch: UploadBatch;
  model: UploadModel;
  state: UploadState;
  set: (change: Partial<UploadState>) => void;
  scene: UploadScene;
  projectId: string;
  projectCode: string;
  go: (scene: UploadScene) => void;
  openFormats: () => void;
};

export function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      title="Remove from this upload"
      aria-label={`Remove ${name}`}
      onClick={onClick}
    >
      <Icon name="close" />
    </Button>
  );
}

export function ResultRow({
  lead = (
    <span className="grid w-5 place-items-center text-fg-faint">
      <Icon name="file" />
    </span>
  ),
  name,
  detail,
  how,
  warn,
  end,
}: {
  lead?: ReactNode;
  name: string;
  detail: string;
  how: string;
  warn?: string | null | undefined;
  end?: ReactNode;
}) {
  return (
    <div className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_minmax(0,230px)_auto] items-center gap-3 rounded-ctl border border-line bg-surf-section py-1 pr-1.5 pl-2.5">
      {lead}
      <FileName name={name} detail={detail} />
      <span className="flex min-w-0 items-center gap-2">
        {warn ? <StatusTag tone="warn">{warn}</StatusTag> : null}
        <span className="truncate text-body-sm text-fg-dim">{how}</span>
      </span>
      {end ?? <span />}
    </div>
  );
}

export function GroupHead({
  icon,
  title,
  sub,
}: {
  icon: "folder" | "slides";
  title: ReactNode;
  sub: string;
}) {
  return (
    <div className="flex min-h-10 items-center gap-2.5 border-line bg-surf-section px-3.5 text-body-sm text-fg-dim [&:not(:first-child)]:border-t">
      <Icon name={icon} />
      <b className="font-semibold text-fg">{title}</b>
      <span>{sub}</span>
    </div>
  );
}

export function SlideBlock({ slide, nested }: { slide: ReactNode; nested: ReactNode }) {
  return (
    <div className="border-line [&+&]:border-t [div+&]:border-t">
      {slide}
      <div className="grid gap-1.5 pr-3 pb-3 pl-16">{nested}</div>
    </div>
  );
}

export function FolderShape({
  tree,
  open,
  foldable,
  onToggle,
  openFormats,
}: {
  tree: UploadBatch["folder_tree"];
  open: boolean;
  foldable: boolean;
  onToggle: () => void;
  openFormats: () => void;
}) {
  if (!open) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-body-sm text-fg-dim">
        <Icon name="folder" />
        <span>Folder shape: case folders, results next to slides</span>
        <TextLink onClick={onToggle}>Show</TextLink>
      </div>
    );
  }
  return (
    <Zone
      title="What folder shape works"
      end={foldable ? <TextLink onClick={onToggle}>Hide</TextLink> : undefined}
      className="content-start"
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-start gap-x-6 gap-y-3.5">
        <div className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-4 gap-y-0.5 overflow-hidden rounded-[10px] border border-surf-edge bg-surf-panel px-3.5 py-3 font-mono text-caption leading-[1.6] text-fg">
          {tree.map((entry) => (
            <span key={entry.name} className="contents">
              <span className="whitespace-nowrap" style={{ paddingLeft: entry.depth * 18 }}>
                {entry.name}
              </span>
              <small className="truncate font-sans text-caption text-fg-faint">{entry.note}</small>
            </span>
          ))}
        </div>
        <ul className="m-0 grid content-start gap-2 pl-4.5 text-body-sm leading-[1.45] text-fg-dim">
          <li>A folder is a case, and its name becomes the case number.</li>
          <li>
            A result sits next to its slide with the same name, or in a folder named like the slide.
          </li>
          <li>Anything else lands in Not matched yet, and you pick its slide.</li>
        </ul>
      </div>
      <p className="m-0 mt-0.5 flex items-start gap-2 text-body-sm leading-[1.45] text-fg-dim">
        <Icon name="help" className="mt-0.5" />
        <span>
          For the file formats, see <TextLink onClick={openFormats}>What files work?</TextLink>
        </span>
      </p>
    </Zone>
  );
}

function SourceSwitch({ scene, go, openFormats }: Pick<StepProps, "scene" | "go" | "openFormats">) {
  const remote = scene === "link" || scene === "remote";
  return (
    <div className="flex min-w-0 items-center gap-4">
      <SegmentedControl
        aria-label="Where the files come from"
        value={remote ? "link" : "computer"}
        onValueChange={(value) =>
          go(value === "link" ? "link" : scene === "empty" ? "empty" : "files")
        }
        options={[
          { value: "computer", label: "From this computer" },
          { value: "link", label: "From a link or storage" },
        ]}
      />
      <span className="flex-1" />
      <button
        type="button"
        onClick={openFormats}
        className="inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-body-sm font-medium text-fg-dim hover:text-fg"
      >
        <Icon name="help" />
        What files work?
      </button>
    </div>
  );
}

export function FilesStep(props: StepProps) {
  const { batch, model, state, set, scene, projectCode, go, openFormats } = props;
  if (scene === "link" || scene === "remote") {
    return (
      <>
        <SourceSwitch scene={scene} go={go} openFormats={openFormats} />
        <FromStore {...props} />
      </>
    );
  }
  if (scene === "empty") {
    return (
      <>
        <SourceSwitch scene={scene} go={go} openFormats={openFormats} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-stretch gap-(--space-zone)">
          <button
            type="button"
            data-testid="drop-area"
            onClick={() => go("files")}
            className="grid min-h-95 cursor-pointer content-center justify-items-center gap-2.5 rounded-[10px] border-[1.5px] border-dashed border-line-strong bg-surf-panel px-5 py-6 text-center text-body-sm leading-[1.45] text-fg-dim hover:border-accent"
          >
            <Icon name="upload" size="md" />
            <b className="text-body font-semibold text-fg">
              Drop slides, results or a whole folder
            </b>
            <span>
              Parfocal sorts them by slide. Slides up to 20 GB each, AI results are optional.
            </span>
            <Button nativeButton={false} render={<span />} className="mt-2">
              <Icon name="folder" />
              Choose files or a folder
            </Button>
          </button>
          <FolderShape
            tree={batch.folder_tree}
            open
            foldable={false}
            onToggle={() => undefined}
            openFormats={openFormats}
          />
        </div>
      </>
    );
  }
  const block = (slideIndex: number) => {
    const slide = batch.slides[slideIndex];
    if (slide === undefined) return null;
    const duplicate = scene === "dup" && slideIndex === batch.duplicate.slide;
    const rows = model.resultsOf(slideIndex);
    const short = shortName(slide.name);
    return (
      <SlideBlock
        key={slide.name}
        slide={
          <>
            <FileRow
              lead={<Thumb />}
              name={slide.name}
              detail={`${slide.format} · ${slide.size_gb.toFixed(1)} GB · 40x`}
              end={
                duplicate ? (
                  <span className="inline-flex items-center gap-2.5">
                    <StatusTag tone="warn">already in {projectCode}</StatusTag>
                    <SegmentedControl
                      aria-label="Duplicate slide"
                      value={state.duplicate}
                      onValueChange={(value) =>
                        set({ duplicate: value as UploadState["duplicate"] })
                      }
                      options={[
                        { value: "skip", label: "Skip" },
                        { value: "replace", label: "Replace" },
                      ]}
                    />
                  </span>
                ) : (
                  <RemoveButton
                    name={slide.name}
                    onClick={() =>
                      set({ removedSlides: { ...state.removedSlides, [slideIndex]: true } })
                    }
                  />
                )
              }
            />
            {duplicate ? (
              <p className="m-0 pb-2 pl-13 text-body-sm leading-[1.45] text-fg-dim">
                {slide.name} is already in this project, uploaded{" "}
                {new Date(batch.duplicate.uploaded_on).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                })}
                . Skip it, or replace the existing slide and keep its reviews.
              </p>
            ) : null}
          </>
        }
        nested={
          <>
            {rows.map((row) => {
              if (row.kind === "added") {
                return (
                  <ResultRow
                    key={`added-${row.index}`}
                    name={slide.extra_result.name}
                    detail={slide.extra_result.detail}
                    how="Added by you"
                    end={
                      <RemoveButton
                        name={slide.extra_result.name}
                        onClick={() => set({ added: { ...state.added, [row.index]: false } })}
                      />
                    }
                  />
                );
              }
              const result = batch.results[row.index];
              if (result === undefined) return null;
              const pairing = model.resultTo(row.index);
              return (
                <ResultRow
                  key={result.name}
                  name={result.name}
                  detail={result.detail}
                  how={pairing.how}
                  warn={pairing.warn}
                  end={
                    <RemoveButton
                      name={result.name}
                      onClick={() =>
                        set({ removedResults: { ...state.removedResults, [row.index]: true } })
                      }
                    />
                  }
                />
              );
            })}
            {model.addedIn(slideIndex) && rows.length > 0 ? null : (
              <div className="flex min-h-8.5 flex-wrap items-center gap-x-3 rounded-ctl border border-dashed border-line py-0.5 pr-1 pl-3">
                {rows.length === 0 ? (
                  <>
                    <span className="text-body-sm text-fg-dim">
                      No AI results yet. Fine, you can run a model later.
                    </span>
                    <span className="flex-1" />
                  </>
                ) : null}
                {model.addedIn(slideIndex) ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    title={`Picks ${slide.extra_result.name} from this computer`}
                    onClick={() => set({ added: { ...state.added, [slideIndex]: true } })}
                  >
                    <Icon name="plus" />
                    Add a result file for {short}
                  </Button>
                )}
              </div>
            )}
          </>
        }
      />
    );
  };
  const caseLabel = batch.slides.find((slide) => slide.case_label)?.case_label ?? "";
  const list =
    model.slides.length === 0 ? (
      <div className="p-3 text-body-sm text-fg-dim">
        No slides left in this upload. Drop slides below, or go back to the project.
      </div>
    ) : state.cases === "names" ? (
      <>
        {model.inCase.length > 0 ? (
          <>
            <GroupHead
              icon="folder"
              title={`Case ${caseLabel}`}
              sub={`${plural(model.inCase.length, "slide")} · case number in the folder and file names`}
            />
            {model.inCase.map(block)}
          </>
        ) : null}
        {model.loose.length > 0 ? (
          <>
            <GroupHead
              icon="slides"
              title="Loose slides"
              sub={`${plural(model.loose.length, "slide")}, no case number`}
            />
            {model.loose.map(block)}
          </>
        ) : null}
      </>
    ) : (
      <>
        <GroupHead icon="slides" title="Loose slides" sub={plural(model.slides.length, "slide")} />
        {model.slides.map(block)}
      </>
    );
  return (
    <>
      <SourceSwitch scene={scene} go={go} openFormats={openFormats} />
      <Zone
        title="Slides and their results"
        end={
          <Hint>
            {plural(model.slides.length, "slide")} · {gb(model.sizeGb)} · {model.matched} of{" "}
            {plural(model.resultCount, "result")} matched
          </Hint>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-body-sm text-fg-dim">
          <span>
            {ruleText[state.pair]}.{" "}
            {state.cases === "names" ? "Cases from file names" : "All slides kept loose"}.
          </span>
          <TextLink onClick={() => set({ ruleOpen: !state.ruleOpen })}>
            {state.ruleOpen ? "Done" : "Change"}
          </TextLink>
        </div>
        {state.ruleOpen ? (
          <div className="grid gap-2.5 rounded-[10px] border border-surf-edge bg-surf-panel px-3.5 py-3 text-body-sm text-fg-dim">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <span className="w-30">Pair results by</span>
              <SegmentedControl
                aria-label="Pair results by"
                value={state.pair}
                onValueChange={(value) => set({ pair: value as PairRule, placed: {} })}
                options={ruleOptions}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <span className="w-30">Cases</span>
              <SegmentedControl
                aria-label="Cases"
                value={state.cases}
                onValueChange={(value) => set({ cases: value as UploadState["cases"] })}
                options={[
                  { value: "names", label: "From file names" },
                  { value: "loose", label: "Keep all loose" },
                ]}
              />
            </div>
          </div>
        ) : null}
        <FileList>{list}</FileList>
      </Zone>
      {model.unmatched.length > 0 ? (
        <Zone
          title="Not matched yet"
          sub="Pick the slide each file goes with. A file with no slide stays out of this upload."
          end={<Hint>{plural(model.unmatched.length, "file")}</Hint>}
          data-testid="not-matched"
        >
          <FileList>
            {model.unmatched.map((index) => {
              const result = batch.results[index];
              if (result === undefined) return null;
              return (
                <FileRow
                  key={result.name}
                  lead={<FileIcon />}
                  name={result.name}
                  detail={`${result.detail} · ${model.resultTo(index).how}`}
                  end={
                    <SlidePicker
                      batch={batch}
                      slides={model.slides}
                      onPick={(slide) => set({ placed: { ...state.placed, [index]: slide } })}
                    />
                  }
                />
              );
            })}
          </FileList>
        </Zone>
      ) : null}
      <div className="grid gap-3">
        <div className="flex justify-center rounded-[10px] border-[1.5px] border-dashed border-line-strong bg-surf-panel px-3.5 py-2.5 text-body-sm text-fg-dim">
          <span className="inline-flex items-center gap-2">
            <Icon name="upload" />
            Drop more slides, results or folders here
          </span>
        </div>
        <FolderShape
          tree={batch.folder_tree}
          open={state.shapeOpen}
          foldable
          onToggle={() => set({ shapeOpen: !state.shapeOpen })}
          openFormats={openFormats}
        />
      </div>
    </>
  );
}

export function SlidePicker({
  batch,
  slides,
  onPick,
  size = "sm",
}: {
  batch: UploadBatch;
  slides: number[];
  onPick: (slide: number) => void;
  size?: "sm" | "default";
}) {
  return (
    <Select
      items={slides.map((index) => ({
        value: String(index),
        label: batch.slides[index]?.name ?? "",
      }))}
      onValueChange={(value) => onPick(Number(value))}
    >
      <SelectTrigger size={size} aria-label="Choose a slide" className="w-50">
        <SelectValue placeholder="Choose a slide" />
      </SelectTrigger>
      <SelectContent>
        {slides.map((index) => (
          <SelectItem key={index} value={String(index)}>
            {batch.slides[index]?.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FromStore({ state, set, scene, projectId, projectCode, go }: StepProps) {
  const link = scene === "link";
  const checked = state.checked[link ? "link" : "remote"];
  const address = link
    ? "https://data.cuni.cz/camelyon16/testing/images/"
    : "s3://fnvltava-scans/sentinel/2026-10/";
  const listing = useListSourceFiles(projectId, address, { query: { enabled: checked } }).data
    ?.data;
  const files = listing?.files ?? [];
  const chosen = files.filter((file) => !file.in_project);
  const chosenGb = chosen.reduce((sum, file) => sum + file.size_gb, 0);
  const matched = chosen.filter((file) => file.result).length;
  return (
    <>
      <Zone
        title="Where are the files?"
        end={
          <Hint>
            {link ? "HTTPS, S3, Azure, GCS, DICOMweb or SFTP" : "Sources your admin connected"}
          </Hint>
        }
      >
        <div className="grid grid-cols-[220px_minmax(0,1fr)_auto] items-center gap-2">
          <Select
            value={link ? "link" : "s3"}
            onValueChange={(value) => go(value === "link" ? "link" : "remote")}
          >
            <SelectTrigger aria-label="Source" className="w-full">
              <SelectValue>
                {(value: string) => (
                  <span className="inline-flex items-center gap-2">
                    <Icon name={value === "link" ? "link" : "database"} />
                    {value === "link" ? "A link" : "Scanner archive · S3"}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="link">A link</SelectItem>
              <SelectItem value="s3">Scanner archive · S3</SelectItem>
            </SelectContent>
          </Select>
          <Input aria-label="Address" readOnly value={address} className="font-mono" />
          <Button
            variant={checked ? "secondary" : "primary"}
            onClick={() => set({ checked: { ...state.checked, [link ? "link" : "remote"]: true } })}
          >
            {checked ? "Check again" : "Check"}
          </Button>
        </div>
        <Hint>
          The Parfocal server fetches the files, not this computer, so a 20 GB slide never crosses
          your connection and closing the tab stops nothing.
        </Hint>
      </Zone>
      {checked && files.length > 0 ? (
        <Zone
          title="Found there"
          end={
            <Hint>
              {chosen.length} of {plural(files.length, "slide")} · {gb(chosenGb)} · {matched}{" "}
              results matched
            </Hint>
          }
        >
          <div className="text-body-sm text-fg-dim">
            {ruleText.auto}. No case numbers in these names, so the slides stay loose.
          </div>
          <FileList>
            <GroupHead
              icon="slides"
              title="Loose slides"
              sub={`${plural(files.length, "slide")}, no case number`}
            />
            {files.map((file) => (
              <SlideBlock
                key={file.name}
                slide={
                  <FileRow
                    lead={
                      <span className="inline-flex items-center gap-3">
                        <Checkbox
                          defaultChecked={!file.in_project}
                          aria-label={`Include ${file.name}`}
                        />
                        <Thumb />
                      </span>
                    }
                    name={file.name}
                    detail={
                      file.in_project ? `${file.detail} · already in ${projectCode}` : file.detail
                    }
                  />
                }
                nested={
                  file.in_project ? (
                    <div className="flex min-h-8.5 items-center rounded-ctl border border-dashed border-line px-3 text-body-sm text-fg-dim">
                      Left out. This slide is already in {projectCode}.
                    </div>
                  ) : file.result ? (
                    <ResultRow
                      lead={
                        <span className="inline-flex items-center gap-3">
                          <Checkbox defaultChecked aria-label={`Include ${file.result.name}`} />
                          <Icon name="file" className="text-fg-faint" />
                        </span>
                      }
                      name={file.result.name}
                      detail={file.result.detail}
                      how="Same folder, same name"
                    />
                  ) : (
                    <div className="flex min-h-8.5 items-center rounded-ctl border border-dashed border-line px-3 text-body-sm text-fg-dim">
                      No AI results found next to it. Fine, you can run a model later.
                    </div>
                  )
                }
              />
            ))}
          </FileList>
        </Zone>
      ) : (
        <Zone
          title="Found there"
          sub="Check the address to list what is there. Nothing is fetched yet."
        />
      )}
      <Zone title="How the slides come in">
        <RadioGroup
          aria-label="How the slides come in"
          value={state.readMode}
          onValueChange={(value) => set({ readMode: value as UploadState["readMode"] })}
          className="gap-1"
        >
          {[
            {
              value: "place",
              title: "Read in place",
              text: "Tiles stream from the source when someone looks. Nothing is copied and the slide shows a remote badge.",
            },
            {
              value: "copy",
              title: "Copy into Parfocal",
              text: "The server copies the files once. Faster to open and safe if the source goes away. Uses storage.",
            },
          ].map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-2.5 py-1.5">
              <RadioGroupItem value={option.value} className="mt-0.5" />
              <span className="grid gap-0.5">
                <b className="text-body-sm font-semibold text-fg">{option.title}</b>
                <small className="text-body-sm text-fg-dim">{option.text}</small>
              </span>
            </label>
          ))}
        </RadioGroup>
      </Zone>
    </>
  );
}
