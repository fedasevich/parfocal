import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { DrawerPanel } from "@parfocal/ui/components/drawer-panel";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { RadioGroup, RadioRow } from "@parfocal/ui/components/radio-group";
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
  const { t } = useLingui();

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
      label={t`New project`}
      title={t`New project`}
      hint={`${code} when created`}
      width={560}
      testId="project-drawer"
      onClose={onClose}
      footer={
        <>
          <Hint>
            <Trans>Settings can change later</Trans>
          </Hint>
          <span className="flex-1" />
          <Failure message={failure} />
          <Button onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button variant="primary" disabled={pending} onClick={submit}>
            <Trans>Create and upload</Trans>
          </Button>
        </>
      }
    >
      <Zone title={t`Name`}>
        <FormField
          label={
            <span className="sr-only">
              <Trans>Name</Trans>
            </span>
          }
          error={problem ?? undefined}
        >
          <TextFieldInput
            autoFocus
            value={name}
            placeholder={t`Sentinel nodes, model B validation`}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </FormField>
      </Zone>
      <Zone title={t`Privacy`}>
        <RadioGroup
          aria-label={t`Privacy`}
          value={privacy}
          onValueChange={(value) => setPrivacy(value as PrivacyChoice)}
          className="gap-2.5"
        >
          {privacyChoices.map((choice) => (
            <RadioRow key={choice.id} value={choice.id} title={choice.title} text={choice.text} />
          ))}
        </RadioGroup>
      </Zone>
      <Zone title={t`Analysis template`} sub="Decides what the review panel adds.">
        <RadioGroup
          aria-label={t`Analysis template`}
          value={template}
          onValueChange={(value) => setTemplate(value as AnalysisChoice)}
          className="gap-2.5"
        >
          {analysisChoices.map((choice) => (
            <RadioRow key={choice.id} value={choice.id} title={choice.title} text={choice.text} />
          ))}
        </RadioGroup>
      </Zone>
      <Zone title={t`Classes`} sub="Imports map their own class names to these.">
        <RadioGroup
          aria-label={t`Class list`}
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
  const { t } = useLingui();

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
      label={t`New case`}
      title={t`New case`}
      hint={`in ${project.code} · ${project.name}`}
      width={520}
      testId="project-drawer"
      onClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          <Failure message={failure} />
          <Button onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button variant="primary" disabled={pending} onClick={submit}>
            <Trans>Create case</Trans>
          </Button>
        </>
      }
    >
      <Hint className="mx-0.5">
        <Trans>
          A case is optional. It groups the slides of one specimen so they are reviewed together.
          Slides can also stay loose in the project.
        </Trans>
      </Hint>
      <Zone title={t`Case`}>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label={t`Case ID`}
            {...(labelProblem ? { error: labelProblem } : { help: "from the file names" })}
          >
            <TextFieldInput
              autoFocus
              value={label}
              maxLength={100}
              placeholder={t`S26-04830`}
              className="font-mono"
              onChange={(event) => setLabel(event.target.value)}
            />
          </FormField>
          <FormField label={t`Specimen`}>
            <TextFieldInput
              value={specimen}
              maxLength={200}
              placeholder={t`Sentinel lymph node, left`}
              onChange={(event) => setSpecimen(event.target.value)}
            />
          </FormField>
        </div>
      </Zone>
      <Zone
        title={t`Patient`}
        end={
          <Hint>
            <Trans>optional</Trans>
          </Hint>
        }
        data-testid="case-patient"
      >
        {clinical ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t`Name`}>
                <TextFieldInput
                  value={patientName}
                  maxLength={200}
                  placeholder={t`Not entered`}
                  onChange={(event) => setPatientName(event.target.value)}
                />
              </FormField>
              <FormField label={t`Birth number`}>
                <TextFieldInput
                  value={birthNumber}
                  maxLength={40}
                  placeholder={t`Not entered`}
                  onChange={(event) => setBirthNumber(event.target.value)}
                />
              </FormField>
            </div>
            {patientProblem ? <Failure message={patientProblem} /> : null}
            <Hint>
              <Trans>
                This is a clinical project. Names can be hidden for everyone in Settings, and
                opening them is logged.
              </Trans>
            </Hint>
          </>
        ) : (
          <>
            <div className="flex min-h-8 items-center gap-2 rounded-ctl border border-dashed border-line-strong bg-chrome-2 px-2.5 text-body-sm text-fg-dim">
              <Icon name="shield" />
              <span>
                <Trans>Off in a de-identified project</Trans>
              </span>
            </div>
            <Hint>
              <Trans>The project owner can switch to clinical in project settings.</Trans>
            </Hint>
          </>
        )}
      </Zone>
    </DrawerPanel>
  );
}

export { NewCaseForm, type NewCaseFormProps, NewProjectForm, type NewProjectFormProps };
