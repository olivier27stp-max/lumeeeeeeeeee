/**
 * Réglages → Bureaux → Santé des bureaux (propriétaire, 2+ bureaux).
 *
 * Chaque bureau comparé au bureau de base : ce qui manque est signalé avec le
 * geste pour le régler. « Reprendre du bureau de base » ne complète que ce qui
 * est vide ; les numéros de taxes, le numéro SMS et le compte de paiement ne
 * se copient jamais (lien vers la page à remplir). Logique : server/lib/office-health.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, AlertTriangle, X, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useCompany } from '../../contexts/CompanyContext';
import { useTranslation } from '../../i18n';
import { captureClientException } from '../../lib/sentry';
import {
  getSanteBureaux,
  reprendreDuBureauDeBase,
  suivreMarqueEntreprise,
  type PointSante,
  type SanteBureau,
} from '../../lib/officesApi';

const NOMS_MODELES: Record<string, [string, string]> = {
  role_templates: ['rôles', 'roles'],
  invoice_templates: ['modèles de facture', 'invoice templates'],
  quote_templates: ['modèles de devis', 'quote templates'],
  job_templates: ['modèles de job', 'job templates'],
  checklist_templates: ['listes de vérification', 'checklists'],
  custom_fields: ['champs personnalisés', 'custom fields'],
};

function texte(p: PointSante, fr: boolean): { titre: string; etat: string; detail: string; bouton?: string } {
  const i = p.infos;
  const liste = (v: unknown) => (Array.isArray(v) ? v.join(', ') : '');
  switch (p.cle) {
    case 'taxes':
      return p.etat === 'ok'
        ? { titre: fr ? 'Taxes par défaut' : 'Default taxes', etat: fr ? 'en place' : 'set', detail: fr ? `${i.nb} taxe(s) active(s).` : `${i.nb} active tax(es).` }
        : { titre: fr ? 'Taxes par défaut' : 'Default taxes', etat: fr ? 'absentes' : 'missing',
          detail: fr ? 'Les factures de ce bureau partent sans taxes.' : 'This office’s invoices go out without taxes.',
          bouton: p.action?.type === 'reprendre' ? (fr ? 'Reprendre du bureau de base' : 'Copy from base office') : (fr ? 'Régler les taxes' : 'Set up taxes') };
    case 'numeros_taxes':
      return p.etat === 'ok'
        ? { titre: fr ? 'Numéros de taxes' : 'Tax numbers', etat: fr ? 'sur les factures' : 'on invoices', detail: fr ? 'Chaque taxe a son numéro d’inscription.' : 'Every tax has its registration number.' }
        : { titre: fr ? 'Numéros de taxes' : 'Tax numbers', etat: fr ? 'absents' : 'missing',
          detail: fr ? `Sans numéro : ${liste(i.taxes)}. Requis sur vos factures si vous êtes inscrit.` : `No number: ${liste(i.taxes)}. Required on invoices if you are registered.`,
          bouton: fr ? 'Ajouter les numéros' : 'Add numbers' };
    case 'sms':
      return p.etat === 'ok'
        ? { titre: fr ? 'Numéro SMS' : 'SMS number', etat: String(i.numero), detail: fr ? 'Textos et rappels aux clients en marche.' : 'Client texts and reminders working.' }
        : { titre: fr ? 'Numéro SMS' : 'SMS number', etat: fr ? 'aucun' : 'none',
          detail: i.base_en_a
            ? (fr ? `${i.base} en a un. Chaque numéro a un coût mensuel.` : `${i.base} has one. Each number has a monthly cost.`)
            : (fr ? 'Les clients de ce bureau ne reçoivent aucun texto.' : 'This office’s clients get no texts.'),
          bouton: fr ? 'Obtenir un numéro' : 'Get a number' };
    case 'paiements':
      if (p.etat === 'ok') return { titre: fr ? 'Paiements en ligne' : 'Online payments', etat: fr ? 'actifs' : 'active', detail: fr ? 'Les clients peuvent payer en ligne.' : 'Clients can pay online.' };
      return i.stripe === 'incomplet'
        ? { titre: fr ? 'Paiements en ligne' : 'Online payments', etat: fr ? 'à terminer' : 'to finish', detail: fr ? 'Compte Stripe créé, encaissements pas encore activés.' : 'Stripe account created, charges not enabled yet.', bouton: fr ? 'Terminer l’inscription' : 'Finish onboarding' }
        : { titre: fr ? 'Paiements en ligne' : 'Online payments', etat: fr ? 'aucun compte' : 'no account', detail: fr ? 'Les clients de ce bureau ne peuvent pas payer en ligne.' : 'This office’s clients cannot pay online.', bouton: fr ? 'Configurer' : 'Set up' };
    case 'marque':
      return p.etat === 'ok'
        ? { titre: fr ? 'Marque' : 'Brand', etat: i.suit ? (fr ? 'suit la marque commune' : 'follows company brand') : (fr ? 'la sienne' : 'its own'), detail: fr ? 'Logo sur les devis, factures et courriels.' : 'Logo on quotes, invoices and emails.' }
        : { titre: fr ? 'Marque' : 'Brand', etat: fr ? 'aucun logo' : 'no logo', detail: fr ? 'Les documents partent sans logo.' : 'Documents go out without a logo.',
          bouton: i.marque_commune ? (fr ? 'Suivre la marque commune' : 'Follow company brand') : (fr ? 'Ajouter un logo' : 'Add a logo') };
    case 'automatisations':
      return p.etat === 'ok'
        ? { titre: fr ? 'Automatisations' : 'Automations', etat: fr ? `${i.nb} actives` : `${i.nb} active`, detail: fr ? 'Rappels, relances et suivis en marche.' : 'Reminders and follow-ups running.' }
        : { titre: fr ? 'Automatisations' : 'Automations', etat: fr ? 'aucune active' : 'none active', detail: fr ? 'Aucun rappel ni relance ne part.' : 'No reminder or follow-up goes out.', bouton: fr ? 'Ouvrir les automatisations' : 'Open automations' };
    case 'prefixe':
      if (p.etat === 'ok') return { titre: fr ? 'Préfixe des numéros' : 'Number prefix', etat: String(i.prefixe), detail: fr ? `Factures et devis ${i.prefixe}-1042, sans doublon.` : `Invoices and quotes ${i.prefixe}-1042, no duplicates.` };
      return { titre: fr ? 'Préfixe des numéros' : 'Number prefix', etat: i.double ? (fr ? `${i.prefixe} en double` : `${i.prefixe} duplicated`) : (fr ? 'aucun' : 'none'),
        detail: fr ? 'Deux bureaux peuvent émettre la même facture no 1042.' : 'Two offices can issue the same invoice #1042.', bouton: fr ? 'Choisir un préfixe' : 'Pick a prefix' };
    case 'equipe':
      return p.etat === 'ok'
        ? { titre: fr ? 'Équipe' : 'Team', etat: fr ? `${i.total} membres` : `${i.total} members`, detail: fr ? 'L’équipe a accès à ce bureau.' : 'The team has access to this office.' }
        : { titre: fr ? 'Équipe' : 'Team', etat: fr ? 'propriétaires seulement' : 'owners only', detail: fr ? 'Aucun admin, représentant ni technicien n’y a accès.' : 'No admin, rep or technician has access.', bouton: fr ? 'Donner des accès' : 'Grant access' };
    case 'modeles':
      return p.etat === 'ok'
        ? { titre: fr ? 'Modèles et champs' : 'Templates and fields', etat: fr ? 'comme le bureau de base' : 'same as base office', detail: fr ? 'Rien ne manque par rapport au bureau de base.' : 'Nothing missing compared to the base office.' }
        : { titre: fr ? 'Modèles et champs' : 'Templates and fields', etat: fr ? 'incomplets' : 'incomplete',
          detail: fr
            ? `Absents ici, présents dans ${i.base} : ${(Array.isArray(i.manquants) ? i.manquants : []).map((t) => NOMS_MODELES[t]?.[0] ?? t).join(', ')}.`
            : `Missing here, present in ${i.base}: ${(Array.isArray(i.manquants) ? i.manquants : []).map((t) => NOMS_MODELES[t]?.[1] ?? t).join(', ')}.`,
          bouton: fr ? 'Reprendre du bureau de base' : 'Copy from base office' };
  }
}

const PASTILLE = {
  ok: { Icone: Check, classe: 'bg-emerald-500/15 text-emerald-700', etat: 'text-emerald-700' },
  attention: { Icone: AlertTriangle, classe: 'bg-amber-500/15 text-amber-800', etat: 'text-amber-800' },
  manquant: { Icone: X, classe: 'bg-red-500/15 text-red-700', etat: 'text-red-700' },
} as const;

export default function SanteBureauxCard({ onChanged }: { onChanged: () => void }) {
  const navigate = useNavigate();
  const { current, switchCompany } = useCompany();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [bureaux, setBureaux] = useState<SanteBureau[] | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      setBureaux((await getSanteBureaux()).bureaux);
    } catch (e) {
      console.error('[SanteBureauxCard] chargement', e);
      captureClientException(e);
    }
  }, []);
  useEffect(() => { void charger(); }, [charger]);

  if (!bureaux || bureaux.length < 2) return null;
  const nomBase = bureaux.find((b) => b.est_base)?.nom || (fr ? 'le bureau de base' : 'the base office');

  const agir = async (b: SanteBureau, p: PointSante) => {
    const a = p.action;
    if (!a) return;
    if (a.type === 'acces') {
      document.getElementById('acces-bureaux')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (a.type === 'page') {
      // La page à remplir est celle du bureau concerné : on y bascule d'abord.
      if (b.org_id === current?.orgId) navigate(a.chemin);
      else { switchCompany(b.org_id); window.location.assign(a.chemin); }
      return;
    }
    const cle = `${b.org_id}:${p.cle}`;
    setEnCours(cle);
    try {
      if (a.type === 'suivre_marque') {
        await suivreMarqueEntreprise(b.org_id, true);
      } else {
        const { rapport } = await reprendreDuBureauDeBase(b.org_id, a.section);
        const copies = a.section === 'taxes' ? rapport.tax_groups : Object.values(rapport.modeles).reduce((s, n) => s + n, 0);
        toast.success(fr ? `${copies} élément(s) repris de ${nomBase}.` : `${copies} item(s) copied from ${nomBase}.`);
      }
      await charger();
      onChanged();
    } catch (e: any) {
      console.error('[SanteBureauxCard] action', e);
      captureClientException(e);
      toast.error(e?.message || (fr ? 'Action impossible.' : 'Could not complete.'));
    } finally { setEnCours(null); }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold text-text-primary">{fr ? 'Santé des bureaux' : 'Office health'}</h3>
          <p className="text-[12px] text-text-tertiary mt-0.5">
            {fr
              ? `Chaque bureau comparé au bureau de base, ${nomBase}. Ce qui manque est signalé avec le geste pour le régler.`
              : `Each office compared to the base office, ${nomBase}. What is missing is flagged with the fix.`}
          </p>
        </div>
        <button type="button" onClick={() => void charger()} aria-label={fr ? 'Revérifier' : 'Check again'}
          className="glass-button text-[12px] shrink-0 inline-flex items-center gap-1.5">
          <RefreshCw size={12} />
          {fr ? 'Revérifier' : 'Check again'}
        </button>
      </div>

      {bureaux.map((b) => {
        const total = b.points.length;
        const bons = total - b.a_regler;
        return (
          <div key={b.org_id} className="rounded-2xl border border-outline-subtle bg-surface-card overflow-hidden">
            <div className="p-4 flex items-center justify-between gap-3 border-b border-outline-subtle">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[14px] font-semibold text-text-primary truncate">{b.nom || (fr ? 'Bureau sans nom' : 'Unnamed office')}</p>
                  {b.est_base && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-sky-500/10 text-sky-700">
                      {fr ? 'Bureau de base' : 'Base office'}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-text-secondary mt-0.5">
                  {b.a_regler === 0 ? (fr ? 'Tout est en place.' : 'All set.') : fr ? `${b.a_regler} point(s) à régler` : `${b.a_regler} item(s) to fix`}
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                <span className="text-[15px] font-semibold tabular-nums text-text-primary">{bons} / {total}</span>
                <div aria-hidden="true" className="w-24 h-1.5 rounded-full bg-surface-secondary overflow-hidden">
                  <div className={cn('h-full', b.a_regler === 0 ? 'bg-emerald-600' : 'bg-amber-600')} style={{ width: `${total ? (bons / total) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
            <ul className="divide-y divide-outline-subtle">
              {b.points.map((p) => {
                const t = texte(p, fr);
                const { Icone, classe, etat } = PASTILLE[p.etat];
                const cle = `${b.org_id}:${p.cle}`;
                return (
                  <li key={p.cle} className="px-4 py-3 flex items-start sm:items-center gap-3 flex-col sm:flex-row">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <span aria-hidden="true" className={cn('shrink-0 w-6 h-6 rounded-full flex items-center justify-center', classe)}>
                        <Icone size={13} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-text-primary">
                          {t.titre} <span className={cn('font-normal', etat)}>· {t.etat}</span>
                        </p>
                        <p className="text-[12px] text-text-tertiary">{t.detail}</p>
                      </div>
                    </div>
                    {p.action && t.bouton && (
                      <button type="button" disabled={enCours !== null} onClick={() => void agir(b, p)}
                        className={cn('text-[12px] shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50 w-full sm:w-auto justify-center',
                          p.etat === 'manquant' ? 'glass-button-primary' : 'glass-button')}>
                        {enCours === cle && <Loader2 size={12} className="animate-spin" />}
                        {t.bouton}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <p className="text-[12px] text-text-tertiary">
        {fr
          ? `« Reprendre du bureau de base » complète seulement ce qui est vide, puis tout reste modifiable. Les numéros de taxes, le numéro SMS et le compte de paiement ne sont jamais copiés : ils dépendent de l’entité légale ou coûtent de l’argent.`
          : `“Copy from base office” only fills what is empty; everything stays editable. Tax numbers, the SMS number and the payment account are never copied: they depend on the legal entity or cost money.`}
      </p>
    </section>
  );
}
