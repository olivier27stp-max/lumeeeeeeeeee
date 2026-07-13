import React from 'react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { updateClient } from '../lib/clientsApi';
import type { ClientRecord } from '../lib/clientsApi';
import AddressAutocomplete from './AddressAutocomplete';

/**
 * "Billing address same as service address" toggle for a client.
 * - ON (default) → invoices use the client's service (property) address.
 * - OFF → a distinct billing address can be entered; it is what appears on
 *   invoices (see buildRenderData).
 * Persists immediately via updateClient.
 */
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
  const [addr, setAddr] = React.useState(client.billing_address || '');
  const [saving, setSaving] = React.useState(false);
  const addrRef = React.useRef(addr);
  addrRef.current = addr;
  const lastSavedRef = React.useRef(client.billing_address || '');

  // Re-sync when the client is refetched/updated elsewhere.
  React.useEffect(() => {
    setSameAsService(client.billing_same_as_service ?? true);
    setAddr(client.billing_address || '');
    lastSavedRef.current = client.billing_address || '';
  }, [client.id, client.billing_same_as_service, client.billing_address]);

  const persist = async (patch: { billing_same_as_service?: boolean; billing_address?: string | null }) => {
    setSaving(true);
    try {
      const updated = await updateClient(client.id, patch);
      onUpdated(updated);
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Échec de l’enregistrement.' : 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = () => {
    if (saving) return;
    const next = !sameAsService;
    setSameAsService(next);
    persist({ billing_same_as_service: next });
  };

  const saveAddr = () => {
    const trimmed = addrRef.current.trim();
    if (trimmed === lastSavedRef.current) return; // unchanged
    lastSavedRef.current = trimmed;
    persist({ billing_address: trimmed || null });
  };

  return (
    <div className="mt-3 rounded-lg border border-outline bg-surface-secondary p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text-primary">
            {fr ? 'Adresse de facturation identique à l’adresse' : 'Billing address same as service address'}
          </p>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {fr ? 'Décochez pour facturer à une adresse différente.' : 'Turn off to bill to a different address.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={sameAsService}
          aria-label={fr ? 'Adresse de facturation identique à l’adresse de service' : 'Billing address same as service address'}
          disabled={saving}
          onClick={toggle}
          className={cn(
            'relative w-9 h-5 rounded-full transition-colors flex-shrink-0',
            sameAsService ? 'bg-primary' : 'bg-surface-tertiary',
          )}
        >
          <span
            className={cn(
              'absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
              sameAsService ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      {!sameAsService && (
        <div className="mt-3">
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
            {fr ? 'Adresse de facturation' : 'Billing address'}
          </label>
          {/* Blur save is delayed: clicking a Google suggestion blurs the input
              first, then place_changed fires with the formatted address. */}
          <div className="mt-1" onBlur={() => window.setTimeout(saveAddr, 250)}>
            <AddressAutocomplete
              value={addr}
              onChange={setAddr}
              onSelect={(a) => {
                setAddr(a.formatted_address);
                addrRef.current = a.formatted_address;
                saveAddr();
              }}
              placeholder={fr ? '123 rue Principale, Ville, QC, H0H 0H0' : '123 Main St, City, QC, H0H 0H0'}
            />
          </div>
          <p className="text-[11px] text-text-tertiary mt-1">
            {fr ? 'Cette adresse apparaîtra sur les factures.' : 'This address will appear on invoices.'}
          </p>
        </div>
      )}
    </div>
  );
}
