import { useGetMySettingLayers } from "@parfocal/api-client";
import { now } from "../clock.ts";
import { okData } from "../screens/placeholder.tsx";
import type { CaseLoad } from "./case-load.ts";
import { type PatientBanner, patientBanner } from "./patient-banner.ts";

export function PatientBannerStrip({ banner }: { banner: PatientBanner }) {
  return (
    <section
      aria-label="Patient"
      className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-line border-b bg-chrome-2 px-4 py-1.5 text-body-sm"
      data-testid="patient-banner"
    >
      <span className="truncate font-semibold" data-testid="patient-banner-name">
        {banner.name}
      </span>
      {banner.fields.map((field) => (
        <span key={field.label} className="whitespace-nowrap">
          <span className="text-fg-dim">{field.label} </span>
          {field.value}
        </span>
      ))}
    </section>
  );
}

export function CasePatientBanner({ load }: { load: CaseLoad }) {
  const layers = okData(useGetMySettingLayers({ query: { enabled: load.clinical } }).data);
  if (layers === undefined) return null;
  const banner = patientBanner({
    clinical: load.clinical,
    patient: load.patient,
    lab: layers.lab,
    personal: layers.personal,
    today: now(),
  });
  return banner === null ? null : <PatientBannerStrip banner={banner} />;
}
