/**
 * « Modifier l'adresse » d'un bureau depuis Réglages → Bureaux, sans y basculer.
 * Même champs que Nouveau bureau : recherche d'adresse (remplit les champs et
 * les coordonnées météo), puis rue, suite, ville, province, code postal, pays.
 * La ville reste obligatoire (météo de l'accueil, secteur du bureau).
 */
import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import AddressAutocomplete, { type StructuredAddress } from '../AddressAutocomplete';
import { useTranslation } from '../../i18n';
import { captureClientException } from '../../lib/sentry';
import { updateOfficeAddress, type OfficeSummary } from '../../lib/officesApi';

const fieldLabel = 'text-xs font-medium text-text-tertiary';

export default function AdresseBureauDialog({
  office,
  onFermer,
  onEnregistre,
}: {
  office: OfficeSummary;
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const uid = useId();

  const [recherche, setRecherche] = useState('');
  const [street1, setStreet1] = useState(office.street1 || '');
  const [street2, setStreet2] = useState(office.street2 || '');
  const [city, setCity] = useState(office.city || '');
  const [province, setProvince] = useState(office.province || '');
  const [postalCode, setPostalCode] = useState(office.postal_code || '');
  const [country, setCountry] = useState(office.country || '');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    office.weather_lat != null && office.weather_lng != null
      ? { lat: Number(office.weather_lat), lng: Number(office.weather_lng) }
      : null,
  );
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const onAdresse = (a: StructuredAddress) => {
    setRecherche(a.formatted_address);
    setStreet1([a.street_number, a.street_name].filter(Boolean).join(' '));
    if (a.city) setCity(a.city);
    if (a.province) setProvince(a.province);
    setPostalCode(a.postal_code);
    if (a.country) setCountry(a.country);
    if (a.latitude != null && a.longitude != null) setCoords({ lat: a.latitude, lng: a.longitude });
  };

  const enregistrer = async () => {
    setErreur(null);
    if (!city.trim()) {
      setErreur(fr ? 'La ville des opérations est requise.' : 'Operations city is required.');
      return;
    }
    setEnCours(true);
    try {
      await updateOfficeAddress(office.id, {
        street1: street1.trim(),
        street2: street2.trim(),
        city: city.trim(),
        province: province.trim(),
        postal_code: postalCode.trim(),
        country: country.trim(),
        weather_lat: coords?.lat ?? null,
        weather_lng: coords?.lng ?? null,
      });
      toast.success(fr ? 'Adresse du bureau enregistrée.' : 'Office address saved.');
      onEnregistre();
    } catch (e: any) {
      console.error('[AdresseBureauDialog]', e);
      captureClientException(e);
      setErreur(e?.message || (fr ? 'Enregistrement impossible.' : 'Could not save.'));
      setEnCours(false);
    }
  };

  const nom = office.name || (fr ? 'ce bureau' : 'this office');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" role="presentation" tabIndex={-1} onClick={() => !enCours && onFermer()} />
      <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-titre`}
        className="relative w-full max-w-lg bg-surface border border-outline rounded-2xl shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 id={`${uid}-titre`} className="text-[16px] font-semibold text-text-primary">
          {fr ? `Adresse de ${nom}` : `${nom} address`}
        </h2>
        <div className="space-y-2">
          <p className={fieldLabel}>{fr ? 'Rechercher une adresse' : 'Search an address'}</p>
          <AddressAutocomplete
            value={recherche}
            onChange={setRecherche}
            onSelect={onAdresse}
            className="glass-input w-full"
            placeholder={fr ? 'Rechercher une adresse…' : 'Search an address…'}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-street1`} className={fieldLabel}>{fr ? 'Rue' : 'Street'}</label>
            <input id={`${uid}-street1`} value={street1} onChange={(e) => setStreet1(e.target.value)} className="glass-input w-full" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-street2`} className={fieldLabel}>{fr ? 'Bureau / suite' : 'Unit / suite'}</label>
            <input id={`${uid}-street2`} value={street2} onChange={(e) => setStreet2(e.target.value)} className="glass-input w-full" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-city`} className={fieldLabel}>{fr ? 'Ville' : 'City'} <span className="text-danger">*</span></label>
            <input id={`${uid}-city`} value={city}
              // Ville retapée à la main : les anciennes coordonnées ne valent plus.
              onChange={(e) => { setCity(e.target.value); setCoords(null); }}
              className="glass-input w-full" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-province`} className={fieldLabel}>{fr ? 'Province / État' : 'Province / State'}</label>
            <input id={`${uid}-province`} value={province} onChange={(e) => setProvince(e.target.value)} className="glass-input w-full" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-postal`} className={fieldLabel}>{fr ? 'Code postal' : 'Postal code'}</label>
            <input id={`${uid}-postal`} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="glass-input w-full" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-country`} className={fieldLabel}>{fr ? 'Pays' : 'Country'}</label>
            <input id={`${uid}-country`} value={country} onChange={(e) => setCountry(e.target.value)} className="glass-input w-full" placeholder="CA" />
          </div>
        </div>
        {erreur && <p className="text-[13px] text-danger">{erreur}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onFermer} disabled={enCours} className="glass-button px-3 py-2 text-[13px]">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button type="button" onClick={() => void enregistrer()} disabled={enCours}
            className="glass-button-primary px-3 py-2 text-[13px] inline-flex items-center gap-2 disabled:opacity-50">
            {enCours && <Loader2 size={14} className="animate-spin" />}
            {fr ? 'Enregistrer' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
