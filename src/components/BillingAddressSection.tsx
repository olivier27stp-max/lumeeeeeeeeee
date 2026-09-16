import React from 'react';
import { toast } from 'sonner';
import { Receipt, Edit2, Trash2, Check, X } from 'lucide-react';
import { getClientById, updateClient } from '../lib/clientsApi';
import type { ClientRecord } from '../lib/clientsApi';
import {
  getBillingProperty,
  removeBillingProperty,
  upsertBillingProperty,
  type PropertyRecord,
} from '../lib/propertiesApi';
import { confirmer } from './ui/ConfirmDialog';
import AddressAutocomplete, { type StructuredAddress } from './AddressAutocomplete';

/**
 * Billing address of a client — a real entity (properties.kind = 'billing',
 * one per client) distinct from the service properties above it.
 * - Toggle ON (default) → invoices use the service (property) address.
 * - Toggle OFF → the billing property is what appears on invoices. Creating
 *   it flips the toggle off (DB trigger); the toggle can be turned back on
 *   without losing the address.
 * `clients.billing_address` is a read-only mirror maintained by trigger, so
 * the parent client record is refetched after every change.
 */

function addressLine(p: PropertyRecord): string {
  if (p.address) return p.address;
  return [p.street_number, p.street_name].filter(Boolean).join(' ');
}

function subAddressLine(p: PropertyRecord): string {
  // Only shown when the main line is a bare street (no formatted address).
  if (p.address) return '';
  return [p.city, p.province, p.postal_code].filter(Boolean).join(', ');
}

export function BillingAddressSection({
  client,
  fr,
  onUpdated,
}: {
  client: ClientRecord;
  fr: boolean;
  onUpdated: (c: ClientRecord) => void;
}) {
  const [sameAsService, setSameAsService] = React.useState(client.billing_same_as_service ?? true);
  const [billing, setBilling] = React.useState<PropertyRecord | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [structured, setStructured] = React.useState<StructuredAddress | null>(null);
  const [saving, setSaving] = React.useState(false);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      setBilling(await getBillingProperty(client.id));
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Impossible de charger l’adresse de facturation.' : 'Failed to load billing address.'));
    } finally {
      setLoading(false);
    }
  }, [client.id, fr]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  // Re-sync when the client is refetched/updated elsewhere.
  React.useEffect(() => {
    setSameAsService(client.billing_same_as_service ?? true);
  }, [client.id, client.billing_same_as_service]);

  const refreshClient = async () => {
    const fresh = await getClientById(client.id);
    if (fresh) onUpdated(fresh);
  };

  const openEditor = () => {
    setSearch(billing ? addressLine(billing) : '');
    setStructured(null);
    setEditing(true);
  };

  const toggle = async () => {
    if (saving) return;
    const next = !sameAsService;
    setSameAsService(next);
    setSaving(true);
    try {
      onUpdated(await updateClient(client.id, { billing_same_as_service: next }));
      // No billing address yet and the user wants a distinct one: open the editor.
      if (!next && !billing) openEditor();
    } catch (e: any) {
      setSameAsService(!next);
      toast.error(e?.message || (fr ? 'Échec de l’enregistrement.' : 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setEditing(false);
    setSearch('');
    setStructured(null);
  };

  const save = async () => {
    const typed = search.trim();
    if (!typed && !structured) {
      toast.error(fr ? 'Entrez une adresse de facturation.' : 'Enter a billing address.');
      return;
    }
    setSaving(true);
    try {
      await upsertBillingProperty(client.id, {
        // Picked suggestion → structured fields; free text → address line only.
        address: structured?.formatted_address ?? typed,
        street_number: structured?.street_number ?? null,
        street_name: structured?.street_name ?? null,
        city: structured?.city ?? null,
        province: structured?.province ?? null,
        postal_code: structured?.postal_code ?? null,
        country: structured?.country ?? null,
        latitude: structured?.latitude ?? null,
        longitude: structured?.longitude ?? null,
        place_id: structured?.place_id ?? null,
      });
      toast.success(fr ? 'Adresse de facturation enregistrée.' : 'Billing address saved.');
      cancel();
      await reload();
      await refreshClient();
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Échec de l’enregistrement.' : 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!billing) return;
    const ok = await confirmer({
      message: fr
        ? 'Retirer l’adresse de facturation ? Les factures utiliseront l’adresse de service.'
        : 'Remove the billing address? Invoices will use the service address.',
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await removeBillingProperty(client.id);
      toast.success(fr ? 'Adresse de facturation retirée.' : 'Billing address removed.');
      await reload();
      await refreshClient();
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Échec de la suppression.' : 'Delete failed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3">
      {/* Une seule ligne au repos : la case cochée = facturer à l'adresse de service. */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={sameAsService}
          disabled={saving}
          onChange={() => void toggle()}
          className="h-4 w-4 rounded"
          aria-label={fr ? 'Adresse de facturation identique à l’adresse de service' : 'Billing address same as service address'}
        />
        <span className="text-[13px] text-text-primary">
          {fr ? 'Adresse de facturation identique à l’adresse de service' : 'Billing address same as service address'}
        </span>
      </label>

      {!sameAsService && (
        <div className="mt-2 ml-6">
          {loading ? (
            <p className="text-[13px] text-text-tertiary">…</p>
          ) : editing ? (
            <div className="rounded-lg border border-outline bg-surface p-3 space-y-2.5">
              <AddressAutocomplete
                value={search}
                onChange={(v) => { setSearch(v); setStructured(null); }}
                onSelect={(a) => { setStructured(a); setSearch(a.formatted_address); }}
                placeholder={fr ? 'Adresse de facturation' : 'Billing address'}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancel}
                  disabled={saving}
                  className="inline-flex items-center gap-1 h-7 px-2.5 bg-surface border border-outline rounded-md text-[12px] text-text-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50"
                >
                  <X size={12} /> {fr ? 'Annuler' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="inline-flex items-center gap-1 h-7 px-2.5 bg-primary text-white rounded-md text-[12px] hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Check size={12} /> {fr ? 'Enregistrer' : 'Save'}
                </button>
              </div>
            </div>
          ) : billing ? (
            <div className="flex items-start gap-3 rounded-lg border border-outline bg-surface-secondary p-3">
              <span className="mt-0.5 text-text-secondary">
                <Receipt size={15} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-text-primary">{addressLine(billing)}</p>
                {subAddressLine(billing) && (
                  <p className="text-[12px] text-text-tertiary mt-0.5">{subAddressLine(billing)}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={openEditor}
                  disabled={saving}
                  className="inline-flex items-center justify-center h-6 w-6 bg-surface border border-outline rounded text-text-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50"
                  title={fr ? 'Modifier' : 'Edit'}
                  aria-label={fr ? 'Modifier l’adresse de facturation' : 'Edit billing address'}
                >
                  <Edit2 size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={saving}
                  className="inline-flex items-center justify-center h-6 w-6 bg-surface border border-outline rounded text-text-secondary hover:bg-danger-light hover:text-danger transition-colors disabled:opacity-50"
                  title={fr ? 'Retirer' : 'Remove'}
                  aria-label={fr ? 'Retirer l’adresse de facturation' : 'Remove billing address'}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={openEditor}
              className="inline-flex items-center gap-1 h-7 px-2.5 bg-surface border border-outline rounded-md text-[12px] text-text-primary hover:bg-surface-secondary transition-colors"
            >
              {fr ? 'Ajouter une adresse de facturation' : 'Add billing address'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
