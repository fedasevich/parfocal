import {
  type LabModelConnection,
  type LabModelTest,
  type Problem,
  useConnectLabModel,
  useGetLabModelConnection,
  useListProjects,
  useListTaxonomyTemplates,
  useTestLabModel,
} from "@parfocal/api-client";
import { InlineError } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import {
  ClassMapTable,
  CodeBlock,
  CodeKey,
  KeyValueList,
  SampleTilePreview,
} from "@parfocal/ui/components/connect-model";
import { FlowBar, FlowPage } from "@parfocal/ui/components/flow-page";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { ModelChips } from "@parfocal/ui/components/model-picker";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { SmallModal, SmallModalZone } from "@parfocal/ui/components/small-modal";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useFlowOwner, useKeptFlow } from "../../session/kept-flow.ts";
import { useRouterLink } from "../../shell/router-link.tsx";
import type { ConnectModelScene } from "../onboarding/scenes.ts";
import { projectColour } from "../palette.ts";
import { okData } from "../placeholder.tsx";
import { adminHref } from "./admin-shell.tsx";
import { InfoLine, type Notify, TextLink } from "./common.tsx";

type SignIn = LabModelConnection["sign_in"];
type WhoCanRun = LabModelConnection["who_can_run"];

type Form = {
  address: string;
  signIn: SignIn;
  secret: string;
  tileSize: number;
  magnification: number;
  name: string;
  version: string;
  taxonomy: string;
  classMap: Record<string, string | null> | null;
  whoCanRun: WhoCanRun;
  projectIds: string[];
};

const leaveOut = "out";

const signInLabels: Record<SignIn, string> = { none: "None", token: "Token", header: "Header" };

const tileSizes = [256, 512, 1024];
const magnifications = [10, 20, 40];

function startForm(data: LabModelConnection): Form {
  return {
    address: data.address,
    signIn: data.sign_in,
    secret: "",
    tileSize: data.tile_size,
    magnification: data.magnification,
    name: data.test.model?.name ?? "",
    version: data.test.model?.version ?? "",
    taxonomy: data.taxonomy,
    classMap: null,
    whoCanRun: data.who_can_run,
    projectIds: data.project_ids,
  };
}

const blankConnection: LabModelConnection = {
  address: "",
  host: "",
  sign_in: "token",
  last_four: "",
  tile_size: 512,
  magnification: 40,
  tiles_at_once: 4,
  health_check_minutes: 5,
  taxonomy: "sentinel-node",
  who_can_run: "admins",
  project_ids: [],
  test: {
    outcome: "untested",
    sample_slide: "the Parfocal sample tile",
    returns: [],
    answered_ms: null,
    server_software: null,
    tiles: [],
    missing_geometry: 0,
    model: null,
    classes: [],
  },
};

const typedSecrets = new Map<string, string>();

const headerPattern = /^\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*:\s*(.+)$/;

function signInOf(form: Form) {
  const secret = form.secret.trim();
  if (form.signIn === "none") return { sign_in: form.signIn, secret: null, header_name: null };
  if (form.signIn === "token") return { sign_in: form.signIn, secret: secret || null };
  const named = headerPattern.exec(secret);
  return {
    sign_in: form.signIn,
    header_name: named?.[1] ?? null,
    secret: (named?.[2] ?? secret) || null,
  };
}

const runnerLabels: Record<WhoCanRun, string> = {
  admins: "People with admin rights",
  researchers: "Researchers",
};

function problemText(data: unknown, fallback: string) {
  const problem = data as Problem | undefined;
  return problem?.detail ?? problem?.title ?? fallback;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <span className="text-body-sm font-semibold text-fg">{label}</span>
      {children}
    </div>
  );
}

function SecretField({
  signIn,
  lastFour,
  value,
  onChange,
}: {
  signIn: SignIn;
  lastFour: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const label = signIn === "header" ? "Header" : "Token";
  const placeholder =
    signIn === "header" ? `X-Api-Key: ••••••••${lastFour}` : `••••••••••••••••${lastFour}`;
  const toggle = shown ? "Hide what you typed" : "Show what you typed";
  return (
    <FormField label={label}>
      <div className="relative">
        <TextFieldInput
          type={shown ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="pr-9 font-mono"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={toggle}
          title={toggle}
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
          className="absolute top-0.5 right-0.5"
        >
          <Icon name="eye" />
        </Button>
      </div>
    </FormField>
  );
}

function ContractModal({ address, onClose }: { address: string; onClose: () => void }) {
  return (
    <SmallModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width={560}
      title="The model contract"
      subtitle="What Parfocal sends to your server and what it expects back"
      showCancel={false}
      primaryLabel="Close"
      onPrimary={onClose}
      hint="MONAI Label and Triton servers follow it with a small adapter."
    >
      <SmallModalZone title="Parfocal sends">
        <CodeBlock>
          {`POST ${address}\n`}
          <CodeKey>Authorization</CodeKey>
          {": Bearer $TOKEN\n{ "}
          <CodeKey>"tile"</CodeKey>
          {': "data:image/png;base64,…", '}
          <CodeKey>"size"</CodeKey>
          {": 512,\n  "}
          <CodeKey>"magnification"</CodeKey>
          {": 40, "}
          <CodeKey>"origin"</CodeKey>
          {": [18432, 9216] }"}
        </CodeBlock>
        <Hint>One tile at a time, up to 4 at once. The origin is in level 0 pixels.</Hint>
      </SmallModalZone>
      <SmallModalZone title="Your server answers">
        <CodeBlock>
          {"{ "}
          <CodeKey>"model"</CodeKey>
          {': "lab-hovernet", '}
          <CodeKey>"version"</CodeKey>
          {': "2.1",\n  '}
          <CodeKey>"objects"</CodeKey>
          {': [{ "kind": "cell", "class": "neoplastic", "score": 0.91,\n    '}
          <CodeKey>"geometry"</CodeKey>
          {': { "type": "Polygon", "coordinates": [[[18440, 9230], …]] } }] }'}
        </CodeBlock>
        <Hint>
          Every object needs a class and a polygon in level 0 pixels. A score is optional.
        </Hint>
      </SmallModalZone>
    </SmallModal>
  );
}

type Props = {
  scene: ConnectModelScene;
  onScene: (scene: ConnectModelScene) => void;
  contract: boolean;
  onContract: (open: boolean) => void;
  onDone: () => void;
  notify: Notify;
};

export function ConnectModelScreen(props: Props) {
  const owner = useFlowOwner();
  return <ConnectModelBody key={owner ?? "anonymous"} owner={owner} {...props} />;
}

function ConnectModelBody({
  owner,
  scene,
  onScene,
  contract,
  onContract,
  onDone,
  notify,
}: Props & { owner: string | undefined }) {
  const query = useGetLabModelConnection();
  const [tested, setTested] = useState<LabModelTest | null>(null);
  const secretKey = owner ?? "anonymous";
  const [secret, setSecretState] = useState(() => typedSecrets.get(secretKey) ?? "");
  const setSecret = (next: string) => {
    typedSecrets.set(secretKey, next);
    setSecretState(next);
  };
  const testCall = useTestLabModel();
  const loaded = query.data?.status === 200 ? query.data.data : undefined;
  const base = loaded ?? (query.isError || query.data !== undefined ? blankConnection : undefined);
  const data = base && tested ? { ...base, test: tested } : base;
  const page = scene === "addmap" ? 1 : 0;
  const flow = useKeptFlow<Form | null>({
    owner,
    id: "connect-model",
    count: 2,
    draft: null,
    at: page,
    persist: (saved) => (saved ? { ...saved, secret: "" } : saved),
  });
  const form = flow.draft;
  const setForm = flow.setDraft;
  const [tile, setTile] = useState(0);
  const renderLink = useRouterLink();
  const resumeAt = useRef(flow.kept?.current === 1 && scene === "addmodel" && !contract);
  useEffect(() => {
    if (!resumeAt.current) return;
    resumeAt.current = false;
    onScene("addmap");
  }, [onScene]);
  const host = form ? hostOf(form.address) : (data?.host ?? "");
  const passed = data?.test.outcome === "follows-contract";
  const crumbs = [
    { label: "Admin", href: adminHref("overview") },
    { label: "AI models", href: adminHref("models") },
    { label: "Connect a model" },
  ];
  if (data === undefined) {
    return (
      <FlowPage
        className="h-full"
        renderLink={renderLink}
        crumbs={crumbs}
        title="Connect your own model"
        subtitle={query.isError ? "The server's details could not be loaded." : "Loading…"}
        steps={[{ label: "Connect and test" }, { label: "Classes and access" }]}
        current={page}
        bar={<FlowBar next={null} />}
      />
    );
  }
  const done = () => {
    typedSecrets.delete(secretKey);
    flow.forget();
    onDone();
  };
  const current = { ...(form ?? startForm(data)), secret };
  const update = (change: Partial<Form>) => {
    if (change.secret !== undefined) setSecret(change.secret);
    setForm({ ...current, ...change });
  };
  const steps = [
    { label: "Connect and test" },
    {
      label: "Classes and access",
      ...(flow.reached < 1
        ? {
            why: passed
              ? "Not reached yet. Use Next: classes and access."
              : "Test the connection first.",
          }
        : {}),
    },
  ];
  return (
    <>
      <FlowPage
        data-testid="connect-model"
        data-scene={scene}
        className="h-full"
        renderLink={renderLink}
        crumbs={crumbs}
        title="Connect your own model"
        subtitle={
          page === 1
            ? `Your lab's server · ${host}`
            : "A server your lab runs, next to Parfocal's models"
        }
        steps={steps}
        current={page}
        reached={flow.reached}
        onStepSelect={(index) => {
          if (index === 0) onScene("addtested");
          if (index === 1 && flow.reached >= 1) onScene("addmap");
        }}
        bar={
          page === 1 ? (
            <MapBar
              data={data}
              form={current}
              onBack={() => onScene("addtested")}
              onDone={done}
              notify={notify}
            />
          ) : (
            <FlowBar
              back={<Button onClick={done}>Cancel</Button>}
              hint={
                passed
                  ? "Connected. Next, match its classes and choose who can run it."
                  : data.test.outcome === "not-contract"
                    ? "The test answer does not follow the contract yet. Fix it and test again."
                    : "Test the connection to go on."
              }
              next={
                <Button
                  variant="primary"
                  disabled={!passed}
                  title={passed ? undefined : "Test the connection first"}
                  onClick={() => onScene("addmap")}
                >
                  Next: classes and access
                </Button>
              }
            />
          )
        }
      >
        {page === 1 ? (
          <MapStep data={data} form={current} update={update} />
        ) : (
          <ConnectStep
            data={data}
            form={current}
            update={update}
            tile={tile}
            setTile={setTile}
            testing={testCall.isPending}
            onTest={() => {
              testCall.mutate(
                {
                  data: {
                    address: current.address.trim(),
                    ...signInOf(current),
                    tile_size: current.tileSize as 256 | 512 | 1024,
                    magnification: current.magnification as 10 | 20 | 40,
                    taxonomy: current.taxonomy as "sentinel-node" | "pannuke",
                  },
                },
                {
                  onSuccess: (answer) => {
                    if (answer.status !== 200) {
                      notify(problemText(answer.data, "The server could not be tested."));
                      return;
                    }
                    setTested(answer.data);
                    const named = answer.data.model;
                    if (named && current.name.trim() === "" && current.version.trim() === "") {
                      update({ name: named.name, version: named.version });
                    }
                    setTile(0);
                    onScene(answer.data.outcome === "follows-contract" ? "addtested" : "addfail");
                  },
                  onError: () => notify("The server could not be tested. Try again."),
                },
              );
            }}
            onContract={() => onContract(true)}
          />
        )}
      </FlowPage>
      {contract ? (
        <ContractModal address={current.address} onClose={() => onContract(false)} />
      ) : null}
    </>
  );
}

function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

function ConnectStep({
  data,
  form,
  update,
  tile,
  setTile,
  testing,
  onTest,
  onContract,
}: {
  data: LabModelConnection;
  form: Form;
  update: (change: Partial<Form>) => void;
  tile: number;
  setTile: (index: number) => void;
  testing: boolean;
  onTest: () => void;
  onContract: () => void;
}) {
  const test = data.test;
  const passed = test.outcome === "follows-contract";
  const failed = test.outcome === "not-contract";
  const sample = test.tiles[passed ? tile : 0];
  const colourOf = useClassColours(data, form);
  return (
    <>
      <Zone title="Where it runs">
        <FormField label="Address">
          <TextFieldInput
            value={form.address}
            onChange={(event) => update({ address: event.currentTarget.value })}
            className="font-mono"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Labelled label="Sign-in">
            <div>
              <SegmentedControl
                aria-label="Sign-in"
                value={form.signIn}
                onValueChange={(value) => update({ signIn: value as SignIn })}
                options={Object.entries(signInLabels).map(([value, label]) => ({ value, label }))}
              />
            </div>
          </Labelled>
          {form.signIn === "none" ? null : (
            <SecretField
              signIn={form.signIn}
              lastFour={data.last_four}
              value={form.secret}
              onChange={(secret) => update({ secret })}
            />
          )}
        </div>
        <InfoLine>
          Parfocal sends a tile and expects Parfocal JSON back.
          <TextLink onClick={onContract}>Read the contract</TextLink>
        </InfoLine>
      </Zone>
      <Zone title="What it returns">
        {passed || failed ? <Hint>Read from the test answer.</Hint> : null}
        {test.returns.length > 0 ? (
          <ModelChips makes={test.returns} />
        ) : (
          <Hint>The test fills this in.</Hint>
        )}
      </Zone>
      <Zone title="Tiles it gets">
        <Hint>
          {passed
            ? `Read from the server's answer. Parfocal sends ${data.tiles_at_once} tiles at a time and slows down when the server does.`
            : "Defaults that suit most cell models. The test reads the server's own values when it has them."}
        </Hint>
        <div className="grid grid-cols-2 gap-x-4">
          <Labelled label="Tile size">
            <div>
              <SegmentedControl
                aria-label="Tile size"
                value={String(form.tileSize)}
                onValueChange={(value) => update({ tileSize: Number(value) })}
                options={tileSizes.map((size) => ({ value: String(size), label: `${size} px` }))}
              />
            </div>
          </Labelled>
          <Labelled label="Magnification">
            <div>
              <SegmentedControl
                aria-label="Magnification"
                value={String(form.magnification)}
                onValueChange={(value) => update({ magnification: Number(value) })}
                options={magnifications.map((size) => ({ value: String(size), label: `${size}×` }))}
              />
            </div>
          </Labelled>
        </div>
      </Zone>
      <Zone title="Test connection">
        <Hint>Sends one sample tile from {test.sample_slide} and shows what comes back.</Hint>
        <div className="grid gap-2">
          <SampleTilePreview
            state={passed ? "ok" : failed ? "fail" : "empty"}
            image="/mock-assets/hpf-40x.jpg"
            label={sample?.label ?? `Sample tile from ${test.sample_slide}`}
            emptyText="The outlines your server sends back show here, on the sample tile"
            regions={sample?.outline.regions ?? []}
            cells={(sample?.outline.cells ?? []).map((cell) => ({
              ...cell,
              colour: colourOf(cell.class),
            }))}
            time={
              sample
                ? `${sample.answered_ms} ms`
                : failed
                  ? `${test.answered_ms ?? 0} ms`
                  : undefined
            }
          />
          {passed && sample ? (
            <>
              <div className="flex items-center gap-2.5">
                <StatusTag tone="ok">Follows the contract</StatusTag>
                <span className="text-body-sm text-fg-dim">{sample.label}</span>
              </div>
              <KeyValueList
                tight
                rows={[
                  { icon: "clock", label: "Answered in", value: `${sample.answered_ms} ms` },
                  {
                    icon: "target",
                    label: "Found",
                    value: `${plural(sample.regions, "region")}, ${plural(sample.cells, "cell")}`,
                  },
                  { icon: "list", label: "Classes", value: String(sample.classes) },
                  { icon: "database", label: "Server", value: test.server_software ?? "Unknown" },
                ]}
              />
            </>
          ) : null}
          {failed ? (
            <>
              <div>
                <StatusTag tone="bad">Not Parfocal JSON yet</StatusTag>
              </div>
              <InlineError>
                <b>
                  {test.missing_geometry} cells came back without a <code>geometry</code>.
                </b>{" "}
                Each object needs a polygon in level 0 pixels. The contract has an example for MONAI
                Label.
              </InlineError>
            </>
          ) : null}
          <div className="flex items-center gap-3">
            <Button
              variant={passed || failed ? "default" : "primary"}
              disabled={testing || form.address.trim() === ""}
              onClick={onTest}
            >
              {passed || failed ? "Test again" : "Test connection"}
            </Button>
            {passed && test.tiles.length > 1 ? (
              <TextLink onClick={() => setTile(tile === 0 ? 1 : 0)}>
                {tile === 0 ? "Try another tile" : "Back to the first tile"}
              </TextLink>
            ) : null}
          </div>
        </div>
      </Zone>
    </>
  );
}

function useTaxonomyOptions(form: Form) {
  const taxonomies = okData(useListTaxonomyTemplates().data) ?? [];
  const taxonomy = taxonomies.find((item) => item.template === form.taxonomy);
  const options = (taxonomy?.classes ?? []).map((item) => ({
    value: item.name,
    label: item.name,
    colour: item.colour,
  }));
  return { taxonomies, options };
}

function suggestedMap(data: LabModelConnection, names: string[]): Record<string, string | null> {
  const lower = new Map(names.map((name) => [name.toLowerCase(), name]));
  return Object.fromEntries(
    data.test.classes.map((item) => [
      item.name,
      lower.get(item.name.toLowerCase()) ??
        (item.suggested !== null && names.includes(item.suggested) ? item.suggested : null),
    ]),
  );
}

function useClassMap(data: LabModelConnection, form: Form) {
  const { taxonomies, options } = useTaxonomyOptions(form);
  const map =
    form.classMap ??
    suggestedMap(
      data,
      options.map((option) => option.value),
    );
  return { taxonomies, options, map };
}

function useClassColours(data: LabModelConnection, form: Form) {
  const { options, map } = useClassMap(data, form);
  return (sent: string) =>
    options.find((option) => option.value === map[sent])?.colour ?? "var(--c-other)";
}

const taxonomyNames: Record<string, string> = {
  "sentinel-node": "Sentinel node",
  pannuke: "PanNuke",
};

const taxonomyLabel = (template: string) => `${taxonomyNames[template] ?? template} classes`;

function matchedText(map: Record<string, string | null>) {
  const values = Object.values(map);
  return `${values.filter((value) => value !== null && value !== leaveOut).length} of ${values.length} matched`;
}

function MapStep({
  data,
  form,
  update,
}: {
  data: LabModelConnection;
  form: Form;
  update: (change: Partial<Form>) => void;
}) {
  const { taxonomies, options, map } = useClassMap(data, form);
  const projects = okData(useListProjects().data) ?? [];
  const chosenProjects = projects.filter((project) => form.projectIds.includes(project.id));
  const counts = new Map(data.test.classes.map((item) => [item.name, item.cells]));
  return (
    <>
      <Zone title="Name">
        <Hint>Read from the server. Result sets it makes carry this name and version.</Hint>
        <div className="grid grid-cols-2 gap-x-4">
          <FormField label="Name">
            <TextFieldInput
              value={form.name}
              onChange={(event) => update({ name: event.currentTarget.value })}
            />
          </FormField>
          <FormField label="Version">
            <TextFieldInput
              value={form.version}
              onChange={(event) => update({ version: event.currentTarget.value })}
              className="font-mono"
            />
          </FormField>
        </div>
      </Zone>
      <Zone
        title="Match its classes"
        end={
          <Select
            value={form.taxonomy}
            onValueChange={(value) => update({ taxonomy: String(value), classMap: null })}
          >
            <SelectTrigger size="sm" aria-label="Class list">
              <SelectValue>{taxonomyLabel(form.taxonomy)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {taxonomies.map((item) => (
                <SelectItem key={item.template} value={item.template}>
                  {taxonomyLabel(item.template)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        <Hint>
          {matchedText(map)} by name. Parfocal remembers this for the server, so its next runs need
          nothing.
        </Hint>
        <ClassMapTable
          rows={data.test.classes.map((item) => ({
            sent: item.name,
            value: map[item.name] ?? null,
            count: plural(counts.get(item.name) ?? 0, "cell"),
          }))}
          options={[...options, { value: leaveOut, label: "Leave out of results" }]}
          onValueChange={(sent, value) => update({ classMap: { ...map, [sent]: value } })}
        />
      </Zone>
      <Zone title="Who can run it">
        <Hint>Reviewers see its results. They never start a run.</Hint>
        <Labelled label="People">
          <div>
            <SegmentedControl
              aria-label="People who can run it"
              value={form.whoCanRun}
              onValueChange={(value) => update({ whoCanRun: value as WhoCanRun })}
              options={[
                { value: "admins", label: "Admin rights only" },
                { value: "researchers", label: "Every researcher" },
              ]}
            />
          </div>
        </Labelled>
        <Labelled label="In projects">
          <div className="grid">
            {projects.map((project, index) => (
              <label
                key={project.id}
                className="flex min-h-10 cursor-pointer items-center gap-2.5 border-t border-line text-body-sm first:border-t-0"
              >
                <Checkbox
                  checked={form.projectIds.includes(project.id)}
                  onCheckedChange={(on) =>
                    update({
                      projectIds: on
                        ? [...form.projectIds, project.id]
                        : form.projectIds.filter((id) => id !== project.id),
                    })
                  }
                />
                <Icon name="folder" style={{ color: projectColour(index) }} />
                <b className="flex-1 font-semibold text-fg">{project.name}</b>
                <span className="font-mono text-caption text-fg-dim">{project.code}</span>
              </label>
            ))}
          </div>
        </Labelled>
      </Zone>
      <Zone title="Summary">
        <Hint>
          Parfocal checks the server every {data.health_check_minutes} minutes. If it stops
          answering, runs wait and you get an email.
        </Hint>
        <KeyValueList
          tight
          rows={[
            { icon: "database", label: "Server", value: hostOf(form.address) },
            { icon: "key", label: "Sign-in", value: signInLabels[form.signIn] },
            {
              icon: "target",
              label: "Returns",
              value: data.test.returns
                .map((item, index) => (index === 0 ? item : item.toLowerCase()))
                .join(" and "),
            },
            {
              icon: "layers",
              label: "Tiles",
              value: `${form.tileSize} px at ${form.magnification}×, ${data.tiles_at_once} at a time`,
            },
            { icon: "list", label: "Classes", value: matchedText(map) },
            {
              icon: "users",
              label: "Runs it",
              value: form.whoCanRun === "admins" ? "Admin rights only" : "Every researcher",
            },
            {
              icon: "folder",
              label: "Projects",
              value:
                chosenProjects.length > 0
                  ? chosenProjects.map((project) => project.code).join(", ")
                  : "None yet",
            },
          ]}
        />
      </Zone>
    </>
  );
}

function MapBar({
  data,
  form,
  onBack,
  onDone,
  notify,
}: {
  data: LabModelConnection;
  form: Form;
  onBack: () => void;
  onDone: () => void;
  notify: Notify;
}) {
  const { map } = useClassMap(data, form);
  const connect = useConnectLabModel();
  const open = Object.entries(map)
    .filter(([, value]) => value === null)
    .map(([sent]) => sent);
  const missing = form.name.trim() === "" || form.version.trim() === "";
  return (
    <FlowBar
      back={<Button onClick={onBack}>Back</Button>}
      hint={
        missing ? (
          "Give the model a name and a version."
        ) : open.length > 0 ? (
          <>
            Choose a class for{" "}
            {open.map((sent, index) => (
              <span key={sent}>
                {index > 0 ? ", " : ""}
                <code>{sent}</code>
              </span>
            ))}
            , or leave {open.length === 1 ? "it" : "them"} out of results.
          </>
        ) : (
          "Every class has a match."
        )
      }
      next={
        <Button
          variant="primary"
          disabled={missing || connect.isPending}
          onClick={() =>
            connect.mutate(
              {
                data: {
                  name: form.name.trim(),
                  version: form.version.trim(),
                  address: form.address.trim(),
                  ...signInOf(form),
                  tile_size: form.tileSize as 256 | 512 | 1024,
                  magnification: form.magnification as 10 | 20 | 40,
                  taxonomy: form.taxonomy as "sentinel-node" | "pannuke",
                  class_map: Object.entries(map).map(([sent, becomes]) => ({
                    sent,
                    becomes: becomes === leaveOut ? null : becomes,
                  })),
                  who_can_run: form.whoCanRun,
                  project_ids: form.projectIds,
                },
              },
              {
                onSuccess: (answer) => {
                  if (answer.status !== 201) {
                    notify(problemText(answer.data, "The model could not be added. Try again."));
                    return;
                  }
                  const model = answer.data;
                  onDone();
                  notify(
                    `${model.name} ${model.version} added. ${runnerLabels[model.who_can_run]} can run it.`,
                  );
                },
                onError: () => notify("The model could not be added. Try again."),
              },
            )
          }
        >
          Add model
        </Button>
      }
    />
  );
}
