import { useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { useTranslation } from '../i18n';
import AddressAutocomplete, { type StructuredAddress } from './AddressAutocomplete';
import { createClient, type ClientRecord } from '../lib/clientsApi';

/**
 * Shared "new client" modal — same fields as the Clients page form, plus the
 * address (with autocomplete). Used by flows that need to create a client
 * inline (e.g. satellite measure → quote) instead of re-implementing a form.
 */
export default function NewClientModal({ initialAddress, onClose, onCreated }: {
  initialAddress?: string;
  onClose: () => void;
  onCreated: (client: ClientRecord) => void;
}) {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [displayAsCompany, setDisplayAsCompany] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addressSearch, setAddressSearch] = useState(initialAddress || '');
  const [structured, setStructured] = useState<StructuredAddress | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error(fr ? 'Prénom et nom sont requis.' : 'First and last name are required.');
      return;
    }
    setSaving(true);
    try {
      const created = await createClient({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        company: company.trim() || undefined,
        display_as_company: displayAsCompany && !!company.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        address: structured?.formatted_address || addressSearch.trim() || undefined,
        street_number: structured?.street_number || undefined,
        street_name: structured?.street_name || undefined,
        city: structured?.city || undefined,
        province: structured?.province || undefined,
        postal_code: structured?.postal_code || undefined,
        country: structured?.country || undefined,
        latitude: structured?.latitude ?? undefined,
        longitude: structured?.longitude ?? undefined,
        place_id: structured?.place_id || undefined,
        status: 'active',
      });
      onCreated(created);
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Échec de la création du client.' : 'Failed to create client.'));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-outline/30 bg-surface-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-text-primary">{fr ? 'Nouveau client' : 'New client'}</h2>
          <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary transition-colors"><X size={16} /></button>
        </div>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.firstName}</label>
              <input autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} className="glass-input w-full mt-1.5" placeholder="John" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.lastName}</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="glass-input w-full mt-1.5" placeholder="Doe" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.company}</label>
            <input value={company} onChange={(e) => setCompany(e.target.value)} className="glass-input w-full mt-1.5" placeholder="Acme Inc." />
            <label className={`mt-2 flex items-center gap-2 text-[13px] text-text-secondary select-none ${company.trim() ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
              <input
                type="checkbox"
                checked={displayAsCompany && !!company.trim()}
                disabled={!company.trim()}
                onChange={(e) => setDisplayAsCompany(e.target.checked)}
                className="rounded-[3px] border-[var(--color-outline)] w-4 h-4 accent-[var(--color-text-primary)]"
              />
              {t.common.useCompanyAsName}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.email}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="glass-input w-full mt-1.5" placeholder="john@example.com" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.phone}</label>
              <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="glass-input w-full mt-1.5" placeholder="(555) 123-4567" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{fr ? 'Adresse' : 'Address'}</label>
            <div className="mt-1.5">
              <AddressAutocomplete
                value={addressSearch}
                onChange={(v) => { setAddressSearch(v); setStructured(null); }}
                onSelect={(addr) => { setStructured(addr); setAddressSearch(addr.formatted_address); }}
              />
            </div>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="glass-button px-4 py-2 rounded-lg text-[13px]">{t.common.cancel}</button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !firstName.trim() || !lastName.trim()}
            className="glass-button-primary px-4 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-40"
          >
            {saving ? '…' : (fr ? 'Créer le client' : 'Create client')}
          </button>
        </div>
      </div>
    </div>
  );
}
