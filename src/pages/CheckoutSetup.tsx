import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { setInitialPassword, setupTaxRegion, completeSetup } from '../lib/billingApi';
import { uploadFile, STORAGE_BUCKETS } from '../lib/storage';
import AddressAutocomplete, { type StructuredAddress } from '../components/AddressAutocomplete';

/**
 * CheckoutSetup — post-payment account claim for payment-link buyers.
 *
 * Shown by CheckoutSuccess when a paid account exists but has no password yet.
 * Collects the one-time essentials (login, company profile, tax region) and
 * writes them to the SAME tables the app reads from (company_settings +
 * tax_configs/groups), so quotes, jobs and invoices work immediately.
 */

type TaxRegion = { key: string; label: string; breakdown: string; total: string; us?: boolean };

const CA_REGIONS: TaxRegion[] = [
  { key: 'QC', label: 'Québec', breakdown: 'TPS 5 % + TVQ 9,975 %', total: '14,975 %' },
  { key: 'ON', label: 'Ontario', breakdown: 'TVH 13 %', total: '13 %' },
  { key: 'BC', label: 'Colombie-Britannique', breakdown: 'TPS 5 % + TVP 7 %', total: '12 %' },
  { key: 'AB', label: 'Alberta', breakdown: 'TPS 5 %', total: '5 %' },
  { key: 'MB', label: 'Manitoba', breakdown: 'TPS 5 % + TVD 7 %', total: '12 %' },
  { key: 'SK', label: 'Saskatchewan', breakdown: 'TPS 5 % + TVP 6 %', total: '11 %' },
  { key: 'NS', label: 'Nouvelle-Écosse', breakdown: 'TVH 14 %', total: '14 %' },
  { key: 'NB', label: 'Nouveau-Brunswick', breakdown: 'TVH 15 %', total: '15 %' },
  { key: 'NL', label: 'Terre-Neuve-et-Labrador', breakdown: 'TVH 15 %', total: '15 %' },
  { key: 'PE', label: 'Île-du-Prince-Édouard', breakdown: 'TVH 15 %', total: '15 %' },
  { key: 'CA-TERR', label: 'Territoires (Yukon, TNO, Nunavut)', breakdown: 'TPS 5 %', total: '5 %' },
];

// [key, label, rate] — statewide base sales tax; 0 = no state tax.
const US_RAW: Array<[string, string, number]> = [
  ['AL', 'Alabama', 4], ['AK', 'Alaska', 0], ['AZ', 'Arizona', 5.6], ['AR', 'Arkansas', 6.5],
  ['CA', 'Californie', 7.25], ['CO', 'Colorado', 2.9], ['CT', 'Connecticut', 6.35], ['DE', 'Delaware', 0],
  ['FL', 'Floride', 6], ['GA', 'Géorgie', 4], ['HI', 'Hawaï', 4], ['ID', 'Idaho', 6], ['IL', 'Illinois', 6.25],
  ['IN', 'Indiana', 7], ['IA', 'Iowa', 6], ['KS', 'Kansas', 6.5], ['KY', 'Kentucky', 6], ['LA', 'Louisiane', 4.45],
  ['ME', 'Maine', 5.5], ['MD', 'Maryland', 6], ['MA', 'Massachusetts', 6.25], ['MI', 'Michigan', 6],
  ['MN', 'Minnesota', 6.875], ['MS', 'Mississippi', 7], ['MO', 'Missouri', 4.225], ['MT', 'Montana', 0],
  ['NE', 'Nebraska', 5.5], ['NV', 'Nevada', 6.85], ['NH', 'New Hampshire', 0], ['NJ', 'New Jersey', 6.625],
  ['NM', 'Nouveau-Mexique', 4.875], ['NY', 'New York', 4], ['NC', 'Caroline du Nord', 4.75], ['ND', 'Dakota du Nord', 5],
  ['OH', 'Ohio', 5.75], ['OK', 'Oklahoma', 4.5], ['OR', 'Oregon', 0], ['PA', 'Pennsylvanie', 6], ['RI', 'Rhode Island', 7],
  ['SC', 'Caroline du Sud', 6], ['SD', 'Dakota du Sud', 4.2], ['TN', 'Tennessee', 7], ['TX', 'Texas', 6.25],
  ['UT', 'Utah', 6.1], ['VT', 'Vermont', 6], ['VA', 'Virginie', 5.3], ['WA', 'Washington', 6.5], ['WV', 'Virginie-Occidentale', 6],
  ['WI', 'Wisconsin', 5], ['WY', 'Wyoming', 4], ['DC', 'Washington D.C.', 6],
];
const fmtPct = (r: number) => (r === 0 ? '0 %' : `${String(r).replace('.', ',')} %`);
const US_REGIONS: TaxRegion[] = US_RAW.map(([abbr, label, rate]) => ({
  key: `US-${abbr}`, label,
  breakdown: rate > 0 ? `Taxe d'État ${fmtPct(rate)}` : "Aucune taxe d'État",
  total: fmtPct(rate), us: true,
}));

const ALL_REGIONS: Record<string, TaxRegion> = {};
[...CA_REGIONS, ...US_REGIONS].forEach((r) => { ALL_REGIONS[r.key] = r; });

function money(cents: number, currency: string) {
  return `${(cents / 100).toLocaleString('fr-CA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} $ ${currency}`;
}

export default function CheckoutSetup({
  sessionId, email, planName, amountCents, interval, currency,
}: {
  sessionId: string;
  email: string;
  planName?: string;
  amountCents?: number;
  interval?: 'monthly' | 'yearly';
  currency?: string;
}) {
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postal, setPostal] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [taxKey, setTaxKey] = useState('QC');
  const [activatePayments, setActivatePayments] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const region = ALL_REGIONS[taxKey];
  const cur = (currency || 'CAD').toUpperCase();
  const intervalLabel = interval === 'yearly' ? 'Renouvellement annuel' : 'Renouvellement mensuel';
  const amountLabel = amountCents != null ? money(amountCents, cur) : '';
  const perLabel = interval === 'yearly' ? `${cur} / an` : `${cur} / mois`;

  async function handleSubmit() {
    setError('');
    if (password.length < 10) { setError('Ton mot de passe doit faire au moins 10 caractères.'); return; }
    if (!companyName.trim()) { setError("Le nom de l'entreprise est requis."); return; }
    if (!phone.trim()) { setError('Le téléphone est requis.'); return; }
    setBusy(true);

    // ── Critical: password + sign-in. If either fails, stop and show why. ──
    let orgId = '';
    try {
      const r = await setInitialPassword(sessionId, password);
      orgId = r.orgId;
      const { error: siErr } = await supabase.auth.signInWithPassword({ email, password });
      if (siErr) throw new Error(siErr.message);
      try { localStorage.setItem('lume-active-org', orgId); } catch { /* ignore */ }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Impossible de créer ton accès. Réessaie.');
      setBusy(false);
      return;
    }

    // ── The account now works. Company profile / logo / taxes are best-effort —
    // never block entry into Lume on them (they're editable in Settings). ──
    try {
      let logoUrl = '';
      if (logoFile) {
        try {
          const ext = (logoFile.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
          const up = await uploadFile(STORAGE_BUCKETS.COMPANY_LOGOS, `${orgId}/logo-${Date.now()}.${ext}`, logoFile);
          logoUrl = up.url;
        } catch { /* logo optional */ }
      }
      const country = taxKey.startsWith('US-') ? 'US' : 'CA';
      const province = taxKey.startsWith('US-') ? taxKey.slice(3) : (taxKey === 'CA-TERR' ? '' : taxKey);
      await completeSetup({
        company_name: companyName.trim(), phone: phone.trim(), email: companyEmail.trim() || email,
        address: address.trim(), city: city.trim(), province, postal_code: postal.trim(), country,
        logo_url: logoUrl || undefined,
      });
      try { await setupTaxRegion(taxKey); } catch { /* taxes editable in Settings */ }
    } catch (e) {
      console.error('[CheckoutSetup] profile/tax save (non-blocking):', e);
    }

    // Lume Payments (Stripe Connect) is set up inside the app. Route them straight
    // to the Payments panel (the real page, not the settings menu) if they opted
    // in; otherwise into the dashboard.
    window.location.href = activatePayments ? '/settings/payments' : '/';
  }

  return (
    <div className="cs-root">
      <style>{CSS}</style>
      <div className="cs-wrap">
        <div className="cs-bar">
          <img className="cs-logo" src="/lume-logo-v2.png" alt="Lume" />
          <span className="cs-paid">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            Paiement confirmé
          </span>
        </div>

        <div className="cs-head">
          <h1>Configure ton compte.</h1>
          <p>Une dernière étape avant d'être prêt à travailler — et à te faire payer.</p>
        </div>

        {(planName || amountLabel) && (
          <div className="cs-order">
            <div className="cs-l">
              <span className="cs-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
              <div><div className="cs-plan">{planName ? `Forfait ${planName}` : 'Ton abonnement'}</div><div className="cs-sub">{intervalLabel} · annulable en tout temps</div></div>
            </div>
            {amountLabel && <div className="cs-amt">{amountLabel}<small>{perLabel}</small></div>}
          </div>
        )}

        {/* 1 — access */}
        <div className="cs-card">
          <div className="cs-ch"><span className="cs-n">01</span><h2>Ton accès</h2></div>
          <div className="cs-fields">
            <div><label>Courriel</label><div className="cs-field"><input type="email" value={email} readOnly /></div></div>
            <div>
              <label>Mot de passe <span className="cs-req">*</span></label>
              <div className="cs-field">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="10 caractères minimum" />
                <button type="button" className="cs-eye" onClick={() => setShowPw((v) => !v)}>{showPw ? 'Cacher' : 'Voir'}</button>
              </div>
              <div className="cs-hint">Minimum 10 caractères.</div>
            </div>
          </div>
        </div>

        {/* 2 — company */}
        <div className="cs-card">
          <div className="cs-ch"><span className="cs-n">02</span><h2>Ton entreprise</h2><span className="cs-tail">sur tes devis &amp; factures</span></div>
          <div className="cs-fields">
            <div><label>Nom de l'entreprise <span className="cs-req">*</span></label><div className="cs-field"><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Rénovations Jean Tremblay" /></div></div>
            <div className="cs-row2">
              <div><label>Téléphone <span className="cs-req">*</span></label><div className="cs-field"><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(514) 555-0199" /></div></div>
              <div><label>Courriel entreprise</label><div className="cs-field"><input value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} placeholder="info@..." /></div></div>
            </div>
            <div><label>Adresse</label>
              <div className="cs-field cs-addr">
                <AddressAutocomplete
                  value={address}
                  onChange={setAddress}
                  onSelect={(a: StructuredAddress) => {
                    const line = [a.street_number, a.street_name].filter(Boolean).join(' ');
                    setAddress(line || a.formatted_address);
                    if (a.city) setCity(a.city);
                    if (a.postal_code) setPostal(a.postal_code);
                  }}
                  placeholder="1234 rue Sainte-Catherine"
                  hideStatusHint
                />
              </div>
            </div>
            <div className="cs-row2">
              <div><label>Ville</label><div className="cs-field"><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Montréal" /></div></div>
              <div><label>Code postal</label><div className="cs-field"><input value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="H2X 1K4" /></div></div>
            </div>
            <div>
              <label>Logo <span className="cs-opt">— optionnel</span></label>
              <div className="cs-logo-up">
                <div className="cs-logo-box">
                  {logoFile
                    ? <img src={URL.createObjectURL(logoFile)} alt="" />
                    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>}
                </div>
                <label className="cs-ghost">
                  {logoFile ? 'Changer le logo' : 'Téléverser un logo'}
                  <input type="file" accept="image/*" hidden onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* 3 — payments + taxes */}
        <div className="cs-card">
          <div className="cs-ch"><span className="cs-n">03</span><h2>Encaisser tes clients</h2></div>
          <div className="cs-lp">
            <div className="cs-lp-top">
              <span className="cs-lp-badge"><img src="/favicon-mascot-v2.png" alt="" /></span>
              <div><b>Lume Payments</b><span>Dépôts directs dans ton compte</span></div>
            </div>
            <div className="cs-lp-body">
              <p>Envoie des factures payables en ligne — carte de crédit, Apple Pay — et reçois l'argent directement dans ton compte bancaire. Activation sécurisée en ~3 minutes.</p>
              <label className="cs-toggle">
                <input type="checkbox" checked={activatePayments} onChange={(e) => setActivatePayments(e.target.checked)} />
                <span>Configurer Lume Payments juste après (connexion bancaire)</span>
              </label>
              <div className="cs-powered">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                Traitement bancaire sécurisé · vérification d'identité chiffrée
              </div>
            </div>
          </div>

          <div className="cs-tax">
            <label>Taxes à facturer à tes clients</label>
            <div className="cs-field">
              <select value={taxKey} onChange={(e) => setTaxKey(e.target.value)}>
                <optgroup label="Canada">
                  {CA_REGIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </optgroup>
                <optgroup label="États-Unis (taxe d'État)">
                  {US_REGIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </optgroup>
                <option value="LATER">Je configure plus tard</option>
              </select>
            </div>
            {region && (
              <div className="cs-tax-out">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                <span>{region.breakdown}</span>
                <span className="cs-chip">{region.total}</span>
              </div>
            )}
            {region?.us && <div className="cs-tax-us">Aux États-Unis, des taxes locales (comté / ville) peuvent s'ajouter au taux d'État — ajustable dans Réglages.</div>}
          </div>
        </div>

        {error && <div className="cs-error">{error}</div>}

        <button className="cs-go" onClick={handleSubmit} disabled={busy}>
          {busy ? 'Configuration…' : 'Terminer et accéder à Lume'}
          {!busy && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
        </button>
        <div className="cs-receipt">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
          Un reçu a été envoyé à {email}
        </div>
      </div>
    </div>
  );
}

const CSS = `
.cs-root{--ink:#111114;--ink-2:#39393d;--muted:#78787f;--faint:#a4a4ac;--line:#e7e7ea;--line-2:#f1f1f3;--paper:#f6f6f7;--card:#fff;--ok:#16a34a;
  min-height:100vh;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.cs-root *{box-sizing:border-box}
.cs-wrap{max-width:560px;margin:0 auto;padding:30px 20px 72px}
.cs-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:34px}
.cs-logo{height:26px;width:auto;display:block}
.cs-paid{display:inline-flex;align-items:center;gap:6px;background:var(--card);color:var(--ink);border:1px solid var(--line);padding:5px 11px;border-radius:999px;font-size:12px;font-weight:650}
.cs-paid svg{width:13px;height:13px;color:var(--ok)}
.cs-head{margin-bottom:22px}
.cs-head h1{font-size:29px;font-weight:800;letter-spacing:-.035em;line-height:1.08;margin:0 0 8px}
.cs-head p{color:var(--muted);font-size:14.5px;margin:0;max-width:400px}
.cs-order{display:flex;align-items:center;justify-content:space-between;border:1px solid var(--ink);border-radius:14px;background:var(--ink);color:#fff;padding:15px 18px;margin-bottom:8px}
.cs-l{display:flex;align-items:center;gap:12px}
.cs-tick{width:30px;height:30px;border-radius:9px;background:rgba(255,255,255,.12);color:#fff;flex:none;display:flex;align-items:center;justify-content:center}
.cs-tick svg{width:15px;height:15px}
.cs-plan{font-weight:700;font-size:14px;letter-spacing:-.01em}
.cs-sub{font-size:12px;color:#a9a9b0;margin-top:1px}
.cs-amt{font-weight:800;font-size:16px;letter-spacing:-.02em;text-align:right;font-variant-numeric:tabular-nums}
.cs-amt small{display:block;font-weight:500;font-size:11px;color:#a9a9b0}
.cs-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-top:14px}
.cs-ch{display:flex;align-items:baseline;gap:9px;margin-bottom:18px}
.cs-ch .cs-n{font-size:12px;font-weight:800;color:var(--faint);font-variant-numeric:tabular-nums}
.cs-ch h2{font-size:16px;font-weight:750;margin:0;letter-spacing:-.02em}
.cs-ch .cs-tail{margin-left:auto;font-size:12px;color:var(--muted)}
.cs-fields{display:flex;flex-direction:column;gap:15px}
.cs-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:470px){.cs-row2{grid-template-columns:1fr}}
.cs-root label{font-size:11px;font-weight:700;color:var(--ink-2);margin-bottom:7px;display:flex;gap:5px;align-items:center;text-transform:uppercase;letter-spacing:.05em}
.cs-opt{font-weight:600;color:var(--faint);text-transform:none;letter-spacing:0}
.cs-req{color:var(--ink)}
.cs-field{position:relative}
.cs-root input:not([type=checkbox]),.cs-root select{width:100%;padding:12px 13px;border:1px solid var(--line);border-radius:11px;font-size:14.5px;background:#fdfdfd;color:var(--ink);font-family:inherit;-webkit-appearance:none;appearance:none}
.cs-root select{background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="%2378787f" stroke-width="2" stroke-linecap="round"><path d="M6 8l4 4 4-4"/></svg>');background-repeat:no-repeat;background-position:right 10px center}
.cs-root input:not([type=checkbox]):focus,.cs-root select:focus{outline:none;border-color:var(--ink);box-shadow:0 0 0 3px rgba(17,17,20,.08);background:#fff}
.cs-root input[readonly]{background:#f3f3f4;color:var(--muted)}
.cs-addr input{padding-left:34px !important}
.cs-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:none;color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;padding:7px 9px;font-family:inherit;text-transform:uppercase;letter-spacing:.04em}
.cs-hint{font-size:11.5px;color:var(--muted);margin-top:6px}
.cs-logo-up{display:flex;align-items:center;gap:13px}
.cs-logo-box{width:50px;height:50px;border-radius:12px;border:1.5px dashed var(--line);flex:none;display:flex;align-items:center;justify-content:center;color:var(--faint);background:#fafafa;overflow:hidden}
.cs-logo-box svg{width:19px;height:19px}
.cs-logo-box img{width:100%;height:100%;object-fit:contain}
.cs-ghost{padding:10px 15px;border:1px solid var(--line);border-radius:10px;background:#fff;font-size:13px;font-weight:650;cursor:pointer;color:var(--ink);text-transform:none;letter-spacing:0}
.cs-ghost:hover{border-color:var(--muted)}
.cs-lp{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card)}
.cs-lp-top{display:flex;align-items:center;gap:12px;padding:16px 18px;background:#fafafa;border-bottom:1px solid var(--line)}
.cs-lp-badge{flex:none;width:40px;height:40px;border-radius:11px;background:#fff;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;overflow:hidden}
.cs-lp-badge img{width:38px;height:38px;object-fit:contain}
.cs-lp-top b{font-size:14.5px;letter-spacing:-.01em;display:block}
.cs-lp-top span{font-size:12px;color:var(--muted);font-weight:600}
.cs-lp-body{padding:16px 18px}
.cs-lp-body p{font-size:13px;color:var(--ink-2);margin:0 0 14px;line-height:1.55}
.cs-toggle{display:flex;align-items:center;gap:10px;font-size:13.5px;font-weight:600;color:var(--ink);text-transform:none;letter-spacing:0;cursor:pointer}
.cs-toggle input{width:18px;height:18px;accent-color:#111114;cursor:pointer;flex:none;margin:0}
.cs-powered{display:flex;align-items:center;gap:6px;margin-top:14px;padding-top:13px;border-top:1px solid var(--line-2);font-size:11.5px;color:var(--faint)}
.cs-powered svg{width:13px;height:13px}
.cs-tax{margin-top:18px;padding-top:18px;border-top:1px solid var(--line-2)}
.cs-tax-out{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12.5px;color:var(--ink-2)}
.cs-tax-out svg{width:15px;height:15px;color:var(--muted);flex:none}
.cs-tax-out .cs-chip{margin-left:auto;background:#f3f3f4;border:1px solid var(--line);border-radius:999px;padding:3px 11px;font-size:11px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.cs-tax-us{margin-top:9px;font-size:11.5px;color:var(--muted);line-height:1.5}
.cs-error{margin-top:16px;background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;border-radius:11px;padding:12px 14px;font-size:13px}
.cs-go{margin-top:20px;width:100%;padding:16px;border:none;border-radius:13px;cursor:pointer;background:var(--ink);color:#fff;font-size:15.5px;font-weight:750;font-family:inherit;letter-spacing:-.01em;display:flex;align-items:center;justify-content:center;gap:9px}
.cs-go:hover{background:#000}
.cs-go:disabled{opacity:.6;cursor:default}
.cs-go svg{width:17px;height:17px}
.cs-receipt{margin-top:16px;display:flex;align-items:center;gap:7px;justify-content:center;font-size:12px;color:var(--muted)}
.cs-receipt svg{width:14px;height:14px}
`;
