import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  type LabModelConnection,
  type LabModelTest,
  type Problem,
  type Project,
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
import { Loader } from "@parfocal/ui/components/loader";
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
import { lazyText } from "@parfocal/ui/lib/lazy-text";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useFlowOwner, useKeptFlow } from "../../session/kept-flow.ts";
import { useRouterLink } from "../../shell/router-link.tsx";
import type { ConnectModelScene } from "../onboarding/scenes.ts";
import { projectColour } from "../palette.ts";
import { okData } from "../placeholder.tsx";
import { adminHref } from "./admin-shell.tsx";
import { InfoLine, type Notify, TextLink } from "./common.tsx";
import { TileSharingModal } from "./tile-sharing-modal.tsx";

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
  confirmedProjectIds: string[];
};

const leaveOut = "out";

const signInLabels: Record<SignIn, string> = lazyText(() => ({
  none: t`None`,
  token: t`Token`,
  header: t`Header`,
}));

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
    confirmedProjectIds: [],
  };
}

const blankConnection: LabModelConnection = lazyText(() => ({
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
    sample_slide: t`the Parfocal sample tile`,
    returns: [],
    answered_ms: null,
    server_software: null,
    tiles: [],
    missing_geometry: 0,
    model: null,
    classes: [],
  },
}));

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

const runnerLabels: Record<WhoCanRun, string> = lazyText(() => ({
  admins: t`People with admin rights`,
  researchers: t`Researchers`,
}));

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
  const { t } = useLingui();

  const [shown, setShown] = useState(false);
  const label = signIn === "header" ? t`Header` : t`Token`;
  const placeholder =
    signIn === "header" ? `X-Api-Key: ••••••••${lastFour}` : `••••••••••••••••${lastFour}`;
  const toggle = shown ? t`Hide what you typed` : t`Show what you typed`;
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
  const { t } = useLingui();

  return (
    <SmallModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width={560}
      title={t`The model contract`}
      subtitle={t`What Parfocal sends to your server and what it expects back`}
      showCancel={false}
      primaryLabel={t`Close`}
      onPrimary={onClose}
      hint={t`MONAI Label and Triton servers follow it with a small adapter.`}
    >
      <SmallModalZone title={t`Parfocal sends`}>
        <CodeBlock>
          {t`POST ${address}\n`}
          <CodeKey>
            <Trans>Authorization</Trans>
          </CodeKey>
          {t`: Bearer $TOKEN
{ `}
          <CodeKey>
            <Trans>"tile"</Trans>
          </CodeKey>
          {t`: "data:image/png;base64,…", `}
          <CodeKey>
            <Trans>"size"</Trans>
          </CodeKey>
          {": 512,\n  "}
          <CodeKey>
            <Trans>"magnification"</Trans>
          </CodeKey>
          {": 40, "}
          <CodeKey>
            <Trans>"origin"</Trans>
          </CodeKey>
          {": [18432, 9216] }"}
        </CodeBlock>
        <Hint>
          <Trans>One tile at a time, up to 4 at once. The origin is in level 0 pixels.</Trans>
        </Hint>
      </SmallModalZone>
      <SmallModalZone title={t`Your server answers`}>
        <CodeBlock>
          {"{ "}
          <CodeKey>
            <Trans>"model"</Trans>
          </CodeKey>
          {t`: "lab-hovernet", `}
          <CodeKey>
            <Trans>"version"</Trans>
          </CodeKey>
          {': "2.1",\n  '}
          <CodeKey>
            <Trans>"objects"</Trans>
          </CodeKey>
          {t`: [{ "kind": "cell", "class": "neoplastic", "score": 0.91,
    `}
          <CodeKey>
            <Trans>"geometry"</Trans>
          </CodeKey>
          {t`: { "type": "Polygon", "coordinates": [[[18440, 9230], …]] } }] }`}
        </CodeBlock>
        <Hint>
          <Trans>
            Every object needs a class and a polygon in level 0 pixels. A score is optional.
          </Trans>
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
  const { t } = useLingui();

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
    { label: t`Admin`, href: adminHref("overview") },
    { label: "AI models", href: adminHref("models") },
    { label: t`Connect a model` },
  ];
  if (data === undefined) {
    return (
      <FlowPage
        className="h-full"
        renderLink={renderLink}
        crumbs={crumbs}
        title={t`Connect your own model`}
        subtitle={
          query.isError ? (
            t`The server's details could not be loaded.`
          ) : (
            <Loader label={t`Loading the server details`} size="inline" />
          )
        }
        steps={[{ label: t`Connect and test` }, { label: t`Classes and access` }]}
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
    const moved = change.address !== undefined && change.address !== current.address;
    const unconfirmed = moved
      ? {
          projectIds: current.projectIds.filter((id) => !current.confirmedProjectIds.includes(id)),
          confirmedProjectIds: [],
        }
      : {};
    setForm({ ...current, ...change, ...unconfirmed });
  };
  const steps = [
    { label: t`Connect and test` },
    {
      label: t`Classes and access`,
      ...(flow.reached < 1
        ? {
            why: passed
              ? t`Not reached yet. Use Next: classes and access.`
              : t`Test the connection first.`,
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
        title={t`Connect your own model`}
        subtitle={
          page === 1
            ? t`Your lab's server · ${host}`
            : t`A server your lab runs, next to Parfocal's models`
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
              back={
                <Button onClick={done}>
                  <Trans>Cancel</Trans>
                </Button>
              }
              hint={
                passed
                  ? t`Connected. Next, match its classes and choose who can run it.`
                  : data.test.outcome === "not-contract"
                    ? t`The test answer does not follow the contract yet. Fix it and test again.`
                    : t`Test the connection to go on.`
              }
              next={
                <Button
                  variant="primary"
                  disabled={!passed}
                  title={passed ? undefined : t`Test the connection first`}
                  onClick={() => onScene("addmap")}
                >
                  <Trans>Next: classes and access</Trans>
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
                      notify(problemText(answer.data, t`The server could not be tested.`));
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
                  onError: () => notify(t`The server could not be tested. Try again.`),
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
  const { t } = useLingui();

  const test = data.test;
  const passed = test.outcome === "follows-contract";
  const failed = test.outcome === "not-contract";
  const sample = test.tiles[passed ? tile : 0];
  const colourOf = useClassColours(data, form);
  return (
    <>
      <Zone title={t`Where it runs`}>
        <FormField label={t`Address`}>
          <TextFieldInput
            value={form.address}
            onChange={(event) => update({ address: event.currentTarget.value })}
            className="font-mono"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Labelled label={t`Sign-in`}>
            <div>
              <SegmentedControl
                aria-label={t`Sign-in`}
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
          <Trans>Parfocal sends a tile and expects Parfocal JSON back.</Trans>
          <TextLink onClick={onContract}>
            <Trans>Read the contract</Trans>
          </TextLink>
        </InfoLine>
      </Zone>
      <Zone title={t`What it returns`}>
        {passed || failed ? (
          <Hint>
            <Trans>Read from the test answer.</Trans>
          </Hint>
        ) : null}
        {test.returns.length > 0 ? (
          <ModelChips makes={test.returns} />
        ) : (
          <Hint>
            <Trans>The test fills this in.</Trans>
          </Hint>
        )}
      </Zone>
      <Zone title={t`Tiles it gets`}>
        <Hint>
          {passed
            ? t`Read from the server's answer. Parfocal sends ${data.tiles_at_once} tiles at a time and slows down when the server does.`
            : t`Defaults that suit most cell models. The test reads the server's own values when it has them.`}
        </Hint>
        <div className="grid grid-cols-2 gap-x-4">
          <Labelled label={t`Tile size`}>
            <div>
              <SegmentedControl
                aria-label={t`Tile size`}
                value={String(form.tileSize)}
                onValueChange={(value) => update({ tileSize: Number(value) })}
                options={tileSizes.map((size) => ({ value: String(size), label: `${size} px` }))}
              />
            </div>
          </Labelled>
          <Labelled label={t`Magnification`}>
            <div>
              <SegmentedControl
                aria-label={t`Magnification`}
                value={String(form.magnification)}
                onValueChange={(value) => update({ magnification: Number(value) })}
                options={magnifications.map((size) => ({ value: String(size), label: `${size}×` }))}
              />
            </div>
          </Labelled>
        </div>
      </Zone>
      <Zone title={t`Test connection`}>
        <Hint>
          <Trans>Sends one sample tile from {test.sample_slide} and shows what comes back.</Trans>
        </Hint>
        <div className="grid gap-2">
          <SampleTilePreview
            state={passed ? "ok" : failed ? "fail" : "empty"}
            label={sample?.label ?? t`Sample tile from ${test.sample_slide}`}
            emptyText={t`The outlines your server sends back show here, on the sample tile`}
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
                <StatusTag tone="ok">
                  <Trans>Follows the contract</Trans>
                </StatusTag>
                <span className="text-body-sm text-fg-dim">{sample.label}</span>
              </div>
              <KeyValueList
                tight
                rows={[
                  { icon: "clock", label: t`Answered in`, value: `${sample.answered_ms} ms` },
                  {
                    icon: "target",
                    label: t`Found`,
                    value: `${plural(sample.regions, "region")}, ${plural(sample.cells, "cell")}`,
                  },
                  { icon: "list", label: t`Classes`, value: String(sample.classes) },
                  { icon: "database", label: t`Server`, value: test.server_software ?? t`Unknown` },
                ]}
              />
            </>
          ) : null}
          {failed ? (
            <>
              <div>
                <StatusTag tone="bad">
                  <Trans>Not Parfocal JSON yet</Trans>
                </StatusTag>
              </div>
              <InlineError>
                <b>
                  <Trans>
                    {test.missing_geometry} cells came back without a <code>geometry</code>
                  </Trans>
                  .
                </b>{" "}
                <Trans>
                  Each object needs a polygon in level 0 pixels. The contract has an example for
                  MONAI Label.
                </Trans>
              </InlineError>
            </>
          ) : null}
          <div className="flex items-center gap-3">
            <Button
              variant={passed || failed ? "default" : "primary"}
              disabled={testing || form.address.trim() === ""}
              onClick={onTest}
            >
              {passed || failed ? t`Test again` : t`Test connection`}
            </Button>
            {passed && test.tiles.length > 1 ? (
              <TextLink onClick={() => setTile(tile === 0 ? 1 : 0)}>
                {tile === 0 ? t`Try another tile` : t`Back to the first tile`}
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

const taxonomyNames: Record<string, string> = lazyText(() => ({
  "sentinel-node": t`Sentinel node`,
  pannuke: "PanNuke",
}));

const taxonomyLabel = (template: string) => `${taxonomyNames[template] ?? template} classes`;

function matchedText(map: Record<string, string | null>) {
  const values = Object.values(map);
  return t`${values.filter((value) => value !== null && value !== leaveOut).length} of ${values.length} matched`;
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
  const { t } = useLingui();

  const { taxonomies, options, map } = useClassMap(data, form);
  const projects = okData(useListProjects().data) ?? [];
  const chosenProjects = projects.filter((project) => form.projectIds.includes(project.id));
  const [asking, setAsking] = useState<Project | null>(null);
  const choose = (project: Project, on: boolean) => {
    if (on && project.privacy_mode === "clinical" && project.my_role === "owner") {
      setAsking(project);
      return;
    }
    update({
      projectIds: on
        ? [...form.projectIds, project.id]
        : form.projectIds.filter((id) => id !== project.id),
      confirmedProjectIds: form.confirmedProjectIds.filter((id) => id !== project.id),
    });
  };
  const counts = new Map(data.test.classes.map((item) => [item.name, item.cells]));
  return (
    <>
      <Zone title={t`Name`}>
        <Hint>
          <Trans>Read from the server. Result sets it makes carry this name and version.</Trans>
        </Hint>
        <div className="grid grid-cols-2 gap-x-4">
          <FormField label={t`Name`}>
            <TextFieldInput
              value={form.name}
              onChange={(event) => update({ name: event.currentTarget.value })}
            />
          </FormField>
          <FormField label={t`Version`}>
            <TextFieldInput
              value={form.version}
              onChange={(event) => update({ version: event.currentTarget.value })}
              className="font-mono"
            />
          </FormField>
        </div>
      </Zone>
      <Zone
        title={t`Match its classes`}
        end={
          <Select
            value={form.taxonomy}
            onValueChange={(value) => update({ taxonomy: String(value), classMap: null })}
          >
            <SelectTrigger size="sm" aria-label={t`Class list`}>
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
          <Trans>
            {matchedText(map)} by name. Parfocal remembers this for the server, so its next runs
            need nothing.
          </Trans>
        </Hint>
        <ClassMapTable
          rows={data.test.classes.map((item) => ({
            sent: item.name,
            value: map[item.name] ?? null,
            count: plural(counts.get(item.name) ?? 0, "cell"),
          }))}
          options={[...options, { value: leaveOut, label: t`Leave out of results` }]}
          onValueChange={(sent, value) => update({ classMap: { ...map, [sent]: value } })}
        />
      </Zone>
      <Zone title={t`Who can run it`}>
        <Hint>
          <Trans>Reviewers see its results. They never start a run.</Trans>
        </Hint>
        <Labelled label={t`People`}>
          <div>
            <SegmentedControl
              aria-label={t`People who can run it`}
              value={form.whoCanRun}
              onValueChange={(value) => update({ whoCanRun: value as WhoCanRun })}
              options={[
                { value: "admins", label: t`Admin rights only` },
                { value: "researchers", label: t`Every researcher` },
              ]}
            />
          </div>
        </Labelled>
        <Labelled label={t`In projects`}>
          <div className="grid">
            {projects.map((project, index) => (
              <label
                key={project.id}
                className="flex min-h-10 cursor-pointer items-center gap-2.5 border-t border-line text-body-sm first:border-t-0"
              >
                <Checkbox
                  checked={form.projectIds.includes(project.id)}
                  onCheckedChange={(on) => choose(project, on)}
                />
                <Icon name="folder" style={{ color: projectColour(index) }} />
                <b className="flex-1 font-semibold text-fg">{project.name}</b>
                {project.privacy_mode === "clinical" && (
                  <span className="text-caption text-fg-dim">
                    {form.confirmedProjectIds.includes(project.id)
                      ? t`Tiles go to ${hostOf(form.address)}`
                      : t`Clinical, its owner confirms sending tiles`}
                  </span>
                )}
                <span className="font-mono text-caption text-fg-dim">{project.code}</span>
              </label>
            ))}
          </div>
        </Labelled>
        {asking && (
          <TileSharingModal
            projectName={asking.name}
            host={hostOf(form.address)}
            onClose={() => setAsking(null)}
            onConfirm={() => {
              update({
                projectIds: [...form.projectIds, asking.id],
                confirmedProjectIds: [...form.confirmedProjectIds, asking.id],
              });
              setAsking(null);
            }}
          />
        )}
      </Zone>
      <Zone title={t`Summary`}>
        <Hint>
          <Trans>
            Parfocal checks the server every {data.health_check_minutes} minutes. If it stops
            answering, runs wait and you get an email.
          </Trans>
        </Hint>
        <KeyValueList
          tight
          rows={[
            { icon: "database", label: t`Server`, value: hostOf(form.address) },
            { icon: "key", label: "Sign-in", value: signInLabels[form.signIn] },
            {
              icon: "target",
              label: t`Returns`,
              value: data.test.returns
                .map((item, index) => (index === 0 ? item : item.toLowerCase()))
                .join(" and "),
            },
            {
              icon: "layers",
              label: t`Tiles`,
              value: `${form.tileSize} px at ${form.magnification}×, ${data.tiles_at_once} at a time`,
            },
            { icon: "list", label: t`Classes`, value: matchedText(map) },
            {
              icon: "users",
              label: t`Runs it`,
              value: form.whoCanRun === "admins" ? t`Admin rights only` : t`Every researcher`,
            },
            {
              icon: "folder",
              label: t`Projects`,
              value:
                chosenProjects.length > 0
                  ? chosenProjects.map((project) => project.code).join(", ")
                  : t`None yet`,
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
  const { t } = useLingui();

  const { map } = useClassMap(data, form);
  const connect = useConnectLabModel();
  const open = Object.entries(map)
    .filter(([, value]) => value === null)
    .map(([sent]) => sent);
  const missing = form.name.trim() === "" || form.version.trim() === "";
  return (
    <FlowBar
      back={
        <Button onClick={onBack}>
          <Trans>Back</Trans>
        </Button>
      }
      hint={
        missing ? (
          t`Give the model a name and a version.`
        ) : open.length > 0 ? (
          <>
            {open.length === 1
              ? t`Choose a class for the sentence below, or leave it out of results.`
              : t`Choose a class for the sentences below, or leave them out of results.`}
            {open.map((sent) => (
              <span key={sent} className="block">
                <code>{sent}</code>
              </span>
            ))}
          </>
        ) : (
          t`Every class has a match.`
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
                  confirmed_project_ids: form.confirmedProjectIds,
                },
              },
              {
                onSuccess: (answer) => {
                  if (answer.status !== 201) {
                    notify(problemText(answer.data, t`The model could not be added. Try again.`));
                    return;
                  }
                  const model = answer.data;
                  onDone();
                  notify(
                    t`${model.name} ${model.version} added. ${runnerLabels[model.who_can_run]} can run it.`,
                  );
                },
                onError: () => notify(t`The model could not be added. Try again.`),
              },
            )
          }
        >
          <Trans>Add model</Trans>
        </Button>
      }
    />
  );
}
