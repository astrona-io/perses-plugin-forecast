import { ReactElement } from "react";
import { MenuItem, Switch, TextField } from "@mui/material";
import {
  FormatControls,
  OptionsEditorColumn,
  OptionsEditorControl,
  OptionsEditorGrid,
  OptionsEditorGroup,
} from "@perses-dev/components";
import { LegendOptionsEditor } from "@perses-dev/plugin-system";
import { parseDurationMs } from "./duration";
import {
  DEFAULT_ANOMALY_THRESHOLD,
  DEFAULT_BAND_LABEL,
  DEFAULT_BAND_OPACITY,
  DEFAULT_FORMAT,
  DEFAULT_HORIZON_LABEL,
  DEFAULT_QUICKSTART_HORIZON,
  DEFAULT_ROLES,
  DEFAULT_THRESHOLD_LABEL,
  ForecastChartEditorProps,
  ForecastChartOptions,
  ROLES,
  Role,
  ThresholdDirection,
} from "./forecast-chart-types";

const ROLE_HELP: Record<Role, string> = {
  actual: "The measured series",
  forecast: "Expected value; series with the horizon label are drawn ahead",
  upper: "Upper edge of the band",
  lower: "Lower edge of the band",
  anomaly: "Score or 0/1 flag; above the anomaly threshold is an anomaly",
};

function numberOrUndefined(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function ForecastChartSettingsEditor(
  props: ForecastChartEditorProps,
): ReactElement {
  const { onChange, value } = props;
  const set = (patch: Partial<ForecastChartOptions>): void =>
    onChange({ ...value, ...patch });
  const horizonInvalid =
    value.horizon !== undefined && parseDurationMs(value.horizon) === undefined;

  return (
    <OptionsEditorGrid>
      <OptionsEditorColumn>
        <OptionsEditorGroup title="Roles">
          {ROLES.map((role) => (
            <OptionsEditorControl
              key={role}
              label={`${role[0]!.toUpperCase()}${role.slice(1)} query`}
              description={ROLE_HELP[role]}
              control={
                <TextField
                  size="small"
                  type="number"
                  inputProps={{ min: 1, "aria-label": `${role} query` }}
                  value={(value.roles?.[role] ?? DEFAULT_ROLES[role]) + 1}
                  onChange={(e) => {
                    const n = numberOrUndefined(e.target.value);
                    if (n === undefined || n < 1) return;
                    set({
                      roles: { ...value.roles, [role]: Math.floor(n) - 1 },
                    });
                  }}
                />
              }
            />
          ))}
          <OptionsEditorControl
            label="Horizon label"
            description="Label holding how far ahead a forecast sample is (seconds or 6h)"
            control={
              <TextField
                size="small"
                placeholder={DEFAULT_HORIZON_LABEL}
                value={value.horizonLabel ?? ""}
                onChange={(e) =>
                  set({ horizonLabel: e.target.value || undefined })
                }
              />
            }
          />
        </OptionsEditorGroup>
        <OptionsEditorGroup title="Quick start">
          <OptionsEditorControl
            label="Estimate in browser"
            description="Holt-Winters estimate when no forecast query has data; labelled estimate"
            control={
              <Switch
                checked={value.quickStart ?? false}
                onChange={(e) => set({ quickStart: e.target.checked })}
              />
            }
          />
          <OptionsEditorControl
            label="Horizon"
            description="How far the estimate looks ahead"
            control={
              <TextField
                size="small"
                placeholder={DEFAULT_QUICKSTART_HORIZON}
                error={horizonInvalid}
                helperText={
                  horizonInvalid
                    ? "Use a duration such as 7d or 12h"
                    : undefined
                }
                value={value.horizon ?? ""}
                onChange={(e) => set({ horizon: e.target.value || undefined })}
              />
            }
          />
        </OptionsEditorGroup>
      </OptionsEditorColumn>
      <OptionsEditorColumn>
        <OptionsEditorGroup title="Threshold">
          <OptionsEditorControl
            label="Value"
            description="Line the forecast is checked against. None when empty"
            control={
              <TextField
                size="small"
                type="number"
                inputProps={{ "aria-label": "threshold value" }}
                value={value.threshold?.value ?? ""}
                onChange={(e) => {
                  const n = numberOrUndefined(e.target.value);
                  set({
                    threshold:
                      n === undefined
                        ? undefined
                        : { ...value.threshold, value: n },
                  });
                }}
              />
            }
          />
          <OptionsEditorControl
            label="Label"
            control={
              <TextField
                size="small"
                placeholder={DEFAULT_THRESHOLD_LABEL}
                disabled={!value.threshold}
                value={value.threshold?.label ?? ""}
                onChange={(e) =>
                  value.threshold &&
                  set({
                    threshold: {
                      ...value.threshold,
                      label: e.target.value || undefined,
                    },
                  })
                }
              />
            }
          />
          <OptionsEditorControl
            label="Direction"
            control={
              <TextField
                select
                size="small"
                disabled={!value.threshold}
                value={value.threshold?.direction ?? "above"}
                onChange={(e) =>
                  value.threshold &&
                  set({
                    threshold: {
                      ...value.threshold,
                      direction: e.target.value as ThresholdDirection,
                    },
                  })
                }
              >
                <MenuItem value="above">Crossing above</MenuItem>
                <MenuItem value="below">Crossing below</MenuItem>
              </TextField>
            }
          />
          <OptionsEditorControl
            label="Crossing callout"
            control={
              <Switch
                checked={value.crossingCallout ?? true}
                onChange={(e) => set({ crossingCallout: e.target.checked })}
              />
            }
          />
        </OptionsEditorGroup>
        <OptionsEditorGroup title="Band and anomalies">
          <OptionsEditorControl
            label="Band label"
            control={
              <TextField
                size="small"
                placeholder={DEFAULT_BAND_LABEL}
                value={value.band?.label ?? ""}
                onChange={(e) =>
                  set({
                    band: { ...value.band, label: e.target.value || undefined },
                  })
                }
              />
            }
          />
          <OptionsEditorControl
            label="Band opacity"
            control={
              <TextField
                size="small"
                type="number"
                inputProps={{ min: 0, max: 1, step: 0.05 }}
                value={value.band?.opacity ?? DEFAULT_BAND_OPACITY}
                onChange={(e) => {
                  const n = numberOrUndefined(e.target.value);
                  if (n === undefined || n < 0 || n > 1) return;
                  set({ band: { ...value.band, opacity: n } });
                }}
              />
            }
          />
          <OptionsEditorControl
            label="Anomaly threshold"
            description="An anomaly-query sample above this is an anomaly"
            control={
              <TextField
                size="small"
                type="number"
                inputProps={{ step: 0.05 }}
                value={value.anomalyThreshold ?? DEFAULT_ANOMALY_THRESHOLD}
                onChange={(e) =>
                  set({ anomalyThreshold: numberOrUndefined(e.target.value) })
                }
              />
            }
          />
          <OptionsEditorControl
            label="Anomaly link"
            description="${__time}, ${__time_from}, ${__time_to}, ${__series.labels.<name>} and variables"
            control={
              <TextField
                size="small"
                placeholder="/explore?from=${__time_from}&to=${__time_to}"
                value={value.anomalyLink ?? ""}
                onChange={(e) =>
                  set({ anomalyLink: e.target.value || undefined })
                }
              />
            }
          />
        </OptionsEditorGroup>
      </OptionsEditorColumn>
      <OptionsEditorColumn>
        <FormatControls
          value={value.format ?? DEFAULT_FORMAT}
          onChange={(format) => set({ format })}
        />
        <LegendOptionsEditor
          value={value.legend}
          onChange={(legend) => set({ legend })}
        />
      </OptionsEditorColumn>
    </OptionsEditorGrid>
  );
}
