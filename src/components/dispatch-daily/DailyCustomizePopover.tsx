import React, { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import type { TeamRecord } from '../../lib/teamsApi';
import { FALLBACK_TEAM_COLOR, isHexColor } from '../../lib/colorUtils';
import {
  DailyResourceField, DispatchDailyPrefs, vehicleNumberForTeam,
} from '../../lib/dispatchDailyPrefs';

/**
 * Personnalisation de la colonne de gauche de la vue Jour : champ principal,
 * champ secondaire et numéros de véhicule par équipe. Piloté par les données
 * (préférences par organisation), rien n'est codé en dur pour « équipe » ou
 * « camion ».
 */
interface DailyCustomizePopoverProps {
  prefs: DispatchDailyPrefs;
  teams: TeamRecord[];
  onChange: (prefs: DispatchDailyPrefs) => void;
}

const PRIMARY_FIELDS: Exclude<DailyResourceField, 'none'>[] = ['vehicle', 'teamName', 'description'];
const SECONDARY_FIELDS: DailyResourceField[] = ['teamName', 'vehicle', 'description', 'none'];

export default function DailyCustomizePopover({ prefs, teams, onChange }: DailyCustomizePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const fieldLabel = (f: DailyResourceField): string => {
    if (f === 'vehicle') return t.schedule.fieldVehicle;
    if (f === 'teamName') return t.schedule.fieldTeamName;
    if (f === 'description') return t.schedule.fieldDescription;
    return t.schedule.fieldNone;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={t.schedule.customizeFields}
        className={cn(
          'rounded-md p-1 transition-colors',
          open ? 'bg-primary/10 text-primary' : 'text-text-tertiary hover:bg-surface-secondary hover:text-text-secondary',
        )}
      >
        <Settings2 size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-border bg-surface p-3 shadow-xl">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {t.schedule.customizeFieldsTitle}
            </p>

            <label className="mb-1 block text-[11px] font-medium text-text-secondary">{t.schedule.primaryField}</label>
            <select
              value={prefs.primary}
              onChange={(e) => onChange({ ...prefs, primary: e.target.value as DispatchDailyPrefs['primary'] })}
              className="mb-2.5 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] text-text-primary"
            >
              {PRIMARY_FIELDS.map((f) => (
                <option key={f} value={f}>{fieldLabel(f)}</option>
              ))}
            </select>

            <label className="mb-1 block text-[11px] font-medium text-text-secondary">{t.schedule.secondaryField}</label>
            <select
              value={prefs.secondary}
              onChange={(e) => onChange({ ...prefs, secondary: e.target.value as DailyResourceField })}
              className="mb-3 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] text-text-primary"
            >
              {SECONDARY_FIELDS.map((f) => (
                <option key={f} value={f}>{fieldLabel(f)}</option>
              ))}
            </select>

            <p className="mb-1.5 text-[11px] font-medium text-text-secondary">{t.schedule.vehicleNumbers}</p>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {teams.map((tm, i) => {
                const c = isHexColor(tm.color_hex) ? tm.color_hex : FALLBACK_TEAM_COLOR;
                return (
                  <div key={tm.id} className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c }} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">{tm.name}</span>
                    <input
                      value={prefs.vehicleNumbers[tm.id] || ''}
                      placeholder={vehicleNumberForTeam(prefs, tm.id, i)}
                      onChange={(e) => onChange({
                        ...prefs,
                        vehicleNumbers: { ...prefs.vehicleNumbers, [tm.id]: e.target.value },
                      })}
                      className="w-16 rounded-md border border-border bg-surface px-1.5 py-1 text-right text-[12px] tabular-nums text-text-primary placeholder:text-text-tertiary/60"
                    />
                  </div>
                );
              })}
              {teams.length === 0 && (
                <p className="py-2 text-center text-[11px] text-text-tertiary">{t.schedule.noActiveTeams}</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
