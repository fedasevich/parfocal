import { Button } from "@parfocal/ui/components/button";
import { DrawerPanel } from "@parfocal/ui/components/drawer-panel";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import {
  type AnalysisChoice,
  analysisChoices,
  casePatient,
  caseProblem,
  defaultTaxonomyFor,
  type NewCaseValues,
  type NewProjectValues,
  type PrivacyChoice,
  privacyChoices,
  projectProblem,
  type TaxonomyOption,
} from "@parfocal/ui/lib/new-forms";
import { useState } from "react";

function RadioRow({ value, title, text }: { value: string; title: string; text?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <RadioGroupItem value={value} className="mt-0.5" />
      <span className="grid gap-0.5">
        <b className="text-body-sm font-semibold text-fg">{title}</b>
        {text ? <small className="text-body-sm text-fg-dim">{text}</small> : null}
      </span>
    </label>
  );
}

function Failure({ message }: { message: string | undefined }) {
  return message ? (
    <Hint role="alert" className="text-bad">
      {message}
    </Hint>
  ) : null;
}

type NewProjectFormProps = {
  code: string;
  taxonomies: TaxonomyOption[];
  pending?: boolean;
  failure?: string;
  onCreate: (values: NewProjectValues) => void;
  onClose: () => void;
};

function NewProjectForm({
  code,
  taxonomies,
  pending = false,
  failure,
  onCreate,
  onClose,
}: NewProjectFormProps) {
  const [name, setName] = useState("");
  const [privacy, setPrivacy] = useState<PrivacyChoice>("de-identified");
  const [template, setTemplate] = useState<AnalysisChoice>("sentinel-node");
  const [pickedTaxonomy, setPickedTaxonomy] = useState<string | undefined>(undefined);
  const [tried, setTried] = useState(false);
  const taxonomyId = pickedTaxonomy ?? defaultTaxonomyFor(template);
  const taxonomy = taxonomies.find((option) => option.id === taxonomyId) ?? taxonomies[0];
  const values: NewProjectValues = { name: name.trim(), privacy, template, taxonomy: taxonomyId };
  const problem = tried ? projectProblem(values) : null;
  const submit = () => {
    setTried(true);
    if (projectProblem(values) === null) onCreate(values);
  };
  return (
    <DrawerPanel
      label="New project"
      title="New project"
      hint={`${code} when created`}
      width={560}
      testId="project-drawer"
      onClose={onClose}
      footer={
        <>
          <Hint>Settings can change later</Hint>
          <span className="flex-1" />
          <Failure message={failure} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending} onClick={submit}>
            Create and upload
          </Button>
        </>
      }
    >
      <Zone title="Name">
        <FormField label={<span className="sr-only">Name</span>} error={problem ?? undefined}>
          <TextFieldInput
            autoFocus
            value={name}
            placeholder="Sentinel nodes, model B validation"
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </FormField>
      </Zone>
      <Zone title="Privacy">
        <RadioGroup
          aria-label="Privacy"
          value={privacy}
          onValueChange={(value) => setPrivacy(value as PrivacyChoice)}
          className="gap-2.5"
        >
          {privacyChoices.map((choice) => (
            <RadioRow key={choice.id} value={choice.id} title={choice.title} text={choice.text} />
          ))}
        </RadioGroup>
      </Zone>
      <Zone title="Analysis template" sub="Decides what the review panel adds.">
        <RadioGroup
          aria-label="Analysis template"
          value={template}
          onValueChange={(value) => setTemplate(value as AnalysisChoice)}
          className="gap-2.5"
        >
          {analysisChoices.map((choice) => (
            <RadioRow key={choice.id} value={choice.id} title={choice.title} text={choice.text} />
          ))}
        </RadioGroup>
      </Zone>
      <Zone title="Classes" sub="Imports map their own class names to these.">
        <RadioGroup
          aria-label="Class list"
          value={taxonomy?.id ?? ""}
          onValueChange={(value) => setPickedTaxonomy(String(value))}
          className="gap-2.5"
        >
          {taxonomies.map((option) => (
            <RadioRow
              key={option.id}
              value={option.id}
              title={option.name}
              text={`${option.classes.length} classes`}
            />
          ))}
        </RadioGroup>
        <div
          data-testid="class-list"
          className="flex flex-wrap gap-x-4.5 gap-y-2 text-body-sm text-fg"
        >
          {(taxonomy?.classes ?? []).map((item) => (
            <span key={item.key} className="inline-flex items-center gap-2">
              <i className="size-3 rounded-[3px]" style={{ background: item.colour }} />
              {item.name}
              <Keycap keys={String(item.key)} size="sm" />
            </span>
          ))}
        </div>
      </Zone>
    </DrawerPanel>
  );
}

type NewCaseFormProps = {
  project: { code: string; name: string; privacy: PrivacyChoice };
  pending?: boolean;
  failure?: string;
  onCreate: (values: NewCaseValues) => void;
  onClose: () => void;
};

function NewCaseForm({ project, pending = false, failure, onCreate, onClose }: NewCaseFormProps) {
  const clinical = project.privacy === "clinical";
  const [label, setLabel] = useState("");
  const [specimen, setSpecimen] = useState("");
  const [patientName, setPatientName] = useState("");
  const [birthNumber, setBirthNumber] = useState("");
  const [tried, setTried] = useState(false);
  const patient = { name: patientName, birthNumber };
  const problem = caseProblem(label, patient, clinical);
  const submit = () => {
    setTried(true);
    if (problem === null) {
      onCreate({
        label: label.trim(),
        specimen: specimen.trim(),
        patient: casePatient(patient, clinical),
      });
    }
  };
  const labelProblem = tried && label.trim() === "" ? problem : null;
  const patientProblem = tried && label.trim() !== "" ? problem : null;
  return (
    <DrawerPanel
      label="New case"
      title="New case"
      hint={`in ${project.code} · ${project.name}`}
      width={520}
      testId="project-drawer"
      onClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          <Failure message={failure} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending} onClick={submit}>
            Create case
          </Button>
        </>
      }
    >
      <Hint className="mx-0.5">
        A case is optional. It groups the slides of one specimen so they are reviewed together.
        Slides can also stay loose in the project.
      </Hint>
      <Zone title="Case">
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Case ID"
            {...(labelProblem ? { error: labelProblem } : { help: "from the file names" })}
          >
            <TextFieldInput
              autoFocus
              value={label}
              maxLength={100}
              placeholder="S26-04830"
              className="font-mono"
              onChange={(event) => setLabel(event.target.value)}
            />
          </FormField>
          <FormField label="Specimen">
            <TextFieldInput
              value={specimen}
              maxLength={200}
              placeholder="Sentinel lymph node, left"
              onChange={(event) => setSpecimen(event.target.value)}
            />
          </FormField>
        </div>
      </Zone>
      <Zone title="Patient" end={<Hint>optional</Hint>} data-testid="case-patient">
        {clinical ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Name">
                <TextFieldInput
                  value={patientName}
                  maxLength={200}
                  placeholder="Not entered"
                  onChange={(event) => setPatientName(event.target.value)}
                />
              </FormField>
              <FormField label="Birth number">
                <TextFieldInput
                  value={birthNumber}
                  maxLength={40}
                  placeholder="Not entered"
                  onChange={(event) => setBirthNumber(event.target.value)}
                />
              </FormField>
            </div>
            {patientProblem ? <Failure message={patientProblem} /> : null}
            <Hint>
              This is a clinical project. Names can be hidden for everyone in Settings, and opening
              them is logged.
            </Hint>
          </>
        ) : (
          <>
            <div className="flex min-h-8 items-center gap-2 rounded-ctl border border-dashed border-line-strong bg-chrome-2 px-2.5 text-body-sm text-fg-dim">
              <Icon name="shield" />
              <span>Off in a de-identified project</span>
            </div>
            <Hint>The project owner can switch to clinical in project settings.</Hint>
          </>
        )}
      </Zone>
    </DrawerPanel>
  );
}

export { NewCaseForm, type NewCaseFormProps, NewProjectForm, type NewProjectFormProps };
