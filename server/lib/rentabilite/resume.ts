/**
 * Rentabilité — les phrases (pur). Ordre imposé : le chiffre, ce qui est
 * inclus, ce qui manque, UNE action concrète. Aucun chiffre ici n'est calculé
 * autrement que par calcul.ts : on ne fait que les écrire.
 */
import type { Resultat, Manquant, Inclus, Groupe } from './calcul';

type Langue = 'fr' | 'en';
type SansResume = Omit<Resultat, 'resume_fr' | 'resume_en'>;

/** Même rendu que les gabarits de Lumi (raccourcis.ts fmtDollars) : espaces ordinaires. */
export function argent(cents: number, l: Langue): string {
  const v = (Math.round(cents) / 100).toLocaleString(l === 'fr' ? 'fr-CA' : 'en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (l === 'fr' ? `${v} $` : (v.startsWith('-') ? `-$${v.slice(1)}` : `$${v}`)).replace(/[  ]/g, ' ');
}
const heures = (h: number, l: Langue) => `${(Math.round(h * 10) / 10).toLocaleString(l === 'fr' ? 'fr-CA' : 'en-CA', { maximumFractionDigits: 1 })} h`;
const pct = (p: number, l: Langue) => (l === 'fr' ? `${p.toLocaleString('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %` : `${p.toFixed(1)}%`);
const jobs = (n: number, l: Langue) => (l === 'fr' ? `${n} job${n > 1 ? 's' : ''}` : `${n} job${n === 1 ? '' : 's'}`);

const MOIS = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
function jour(iso: string, l: Langue, annee: boolean): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (l === 'fr') return `${d === 1 ? '1er' : d} ${MOIS.fr[m - 1]}${annee ? ` ${y}` : ''}`;
  return `${MOIS.en[m - 1]} ${d}${annee ? `, ${y}` : ''}`;
}
export function periodeTexte(du: string | null, au: string | null, l: Langue): string {
  if (!du || !au) return '';
  if (du === au) return l === 'fr' ? `Le ${jour(du, l, true)}` : `On ${jour(du, l, true)}`;
  const memeAnnee = du.slice(0, 4) === au.slice(0, 4);
  return l === 'fr'
    ? `Du ${jour(du, l, !memeAnnee)} au ${jour(au, l, true)}`
    : `From ${jour(du, l, !memeAnnee)} to ${jour(au, l, true)}`;
}

function noms(liste: string[] | undefined, l: Langue): string {
  const n = liste ?? [];
  if (n.length <= 2) return n.join(l === 'fr' ? ' et ' : ' and ');
  const reste = n.length - 2;
  return l === 'fr' ? `${n[0]}, ${n[1]} et ${reste} autre${reste > 1 ? 's' : ''}` : `${n[0]}, ${n[1]} and ${reste} other${reste > 1 ? 's' : ''}`;
}

/* ── L'action concrète ── */
export function texteAction(m: Manquant, l: Langue): string {
  const n = m.nb_jobs;
  const fr = l === 'fr';
  switch (m.code) {
    case 'revenu_inconnu':
      return fr ? `Facture ${n > 1 ? 'ces jobs' : 'ce job'} ou mets-${n > 1 ? 'leur' : 'lui'} un prix (${jobs(n, l)} sans revenu connu).`
        : `Invoice ${n > 1 ? 'these jobs' : 'this job'} or give ${n > 1 ? 'them' : 'it'} a price (${jobs(n, l)} with no known revenue).`;
    case 'main_oeuvre_absente':
      return fr ? `Pointe les heures sur les jobs, ou assigne les visites à un technicien (${jobs(n, l)} sans main-d’œuvre).`
        : `Clock hours on jobs, or assign visits to a technician (${jobs(n, l)} with no labour).`;
    case 'taux_horaire':
      return fr ? `Saisis le taux horaire de ${noms(m.noms, l)} dans Équipe (${heures(m.heures ?? 0, l)} sans taux).`
        : `Enter the hourly rate for ${noms(m.noms, l)} in Team (${heures(m.heures ?? 0, l)} without a rate).`;
    case 'commission_non_calculee':
      return fr ? `Vérifie les commissions de ${noms(m.noms, l)} dans Commissions (${jobs(n, l)} facturé${n > 1 ? 's' : ''} sans commission).`
        : `Check ${noms(m.noms, l)}’s commissions in Commissions (${jobs(n, l)} invoiced with no commission).`;
    case 'cout_materiel':
      return fr ? `Ajoute le coût unitaire des matériaux qui n’en ont pas (${noms(m.noms, l)}).`
        : `Add the unit cost of the materials that have none (${noms(m.noms, l)}).`;
  }
}

/* ── Inclus / manquant ── */
function inclusTexte(i: Inclus, l: Langue): string {
  const fr = l === 'fr';
  switch (i.code) {
    case 'factures': return fr ? `factures (${jobs(i.nb_jobs, l)})` : `invoices (${jobs(i.nb_jobs, l)})`;
    case 'prix_job_estime': return fr ? `prix du job, faute de facture (${jobs(i.nb_jobs, l)}, estimation)` : `job price, no invoice yet (${jobs(i.nb_jobs, l)}, estimate)`;
    case 'soumission_estimee': return fr ? `soumission acceptée, faute de facture (${jobs(i.nb_jobs, l)}, estimation)` : `approved quote, no invoice yet (${jobs(i.nb_jobs, l)}, estimate)`;
    case 'heures_pointees': return fr ? `${heures(i.heures ?? 0, l)} pointées (trajets pointés compris)` : `${heures(i.heures ?? 0, l)} clocked (clocked travel included)`;
    case 'heures_planifiees': return fr ? `${heures(i.heures ?? 0, l)} planifiées, faute de pointage (estimation)` : `${heures(i.heures ?? 0, l)} scheduled, nothing clocked (estimate)`;
    case 'commissions': return fr ? `commissions ${argent(i.montant_cents ?? 0, l)}` : `commissions ${argent(i.montant_cents ?? 0, l)}`;
    case 'champs_depenses': return fr ? `dépenses ${argent(i.montant_cents ?? 0, l)}` : `expenses ${argent(i.montant_cents ?? 0, l)}`;
    case 'depenses_job': return fr ? `dépenses saisies au job ${argent(i.montant_cents ?? 0, l)}` : `job expenses ${argent(i.montant_cents ?? 0, l)}`;
    case 'materiaux': return fr ? `matériaux ${argent(i.montant_cents ?? 0, l)}` : `materials ${argent(i.montant_cents ?? 0, l)}`;
  }
}
function manquantTexte(m: Manquant, l: Langue): string {
  const fr = l === 'fr';
  switch (m.code) {
    case 'revenu_inconnu': return fr ? `aucun revenu connu sur ${jobs(m.nb_jobs, l)}` : `no known revenue on ${jobs(m.nb_jobs, l)}`;
    case 'main_oeuvre_absente': return fr ? `aucune main-d’œuvre sur ${jobs(m.nb_jobs, l)}` : `no labour on ${jobs(m.nb_jobs, l)}`;
    case 'taux_horaire': return fr ? `taux horaire de ${noms(m.noms, l)} (${heures(m.heures ?? 0, l)})` : `hourly rate for ${noms(m.noms, l)} (${heures(m.heures ?? 0, l)})`;
    case 'commission_non_calculee': return fr ? `commission non calculée sur ${jobs(m.nb_jobs, l)}` : `commission not calculated on ${jobs(m.nb_jobs, l)}`;
    case 'cout_materiel': return fr ? `coût de ${m.noms?.length ?? 0} matériau${(m.noms?.length ?? 0) > 1 ? 'x' : ''}` : `cost of ${m.noms?.length ?? 0} material${(m.noms?.length ?? 0) === 1 ? '' : 's'}`;
  }
}

/* ── Le chiffre ── */
function portee(r: SansResume, l: Langue, avecNombre: boolean): string {
  const fr = l === 'fr';
  const f = r.filtres_noms;
  const morceaux: string[] = [];
  if (f.job) {
    morceaux.push(`Job ${f.job}`);
    const p = periodeTexte(r.periode.du, r.periode.au, l);
    if (p) morceaux.push(p.charAt(0).toLowerCase() + p.slice(1));
    return morceaux.join(', ');
  }
  const p = periodeTexte(r.periode.du, r.periode.au, l);
  if (p) morceaux.push(p);
  if (f.client) morceaux.push(fr ? `client ${f.client}` : `client ${f.client}`);
  if (f.technicien) morceaux.push(fr ? `technicien ${f.technicien}` : `technician ${f.technicien}`);
  if (f.rep) morceaux.push(fr ? `vendeur ${f.rep}` : `sales rep ${f.rep}`);
  if (f.service) morceaux.push(`service ${f.service}`);
  if (avecNombre) morceaux.push(jobs(r.nb_jobs, l));
  const t = morceaux.join(', ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function chiffre(r: SansResume, l: Langue): string {
  const fr = l === 'fr';
  const t = r.totaux;
  const sep = fr ? ' : ' : ': ';
  if (r.nb_jobs === 0) {
    const p = portee(r, l, false);
    return p ? `${p}${sep}${fr ? 'aucun job trouvé.' : 'no job found.'}` : (fr ? 'Aucun job trouvé.' : 'No job found.');
  }
  const tete = portee(r, l, !r.filtres_noms.job) + sep;
  const revenuConnu = r.inclus.some((i) => i.code === 'factures' || i.code === 'prix_job_estime' || i.code === 'soumission_estimee');
  if (!revenuConnu) {
    return tete + (fr ? 'aucun revenu connu, la rentabilité ne peut pas être calculée.' : 'no known revenue, so profitability cannot be calculated.');
  }
  if (r.completude === 'insuffisante') {
    return tete + (fr
      ? `revenus ${argent(t.revenus_cents, l)}, mais aucun coût n’est saisi : la rentabilité ne peut pas être calculée.`
      : `revenue ${argent(t.revenus_cents, l)}, but no cost is recorded, so profitability cannot be calculated.`);
  }
  const max = r.marge_est_un_maximum;
  const est = !max && r.contient_estimations;
  const profit = fr
    ? `${max ? 'profit d’au plus' : est ? 'profit estimé' : 'profit'} ${argent(t.profit_cents, l)}`
    : `${max ? 'profit of at most' : est ? 'estimated profit' : 'profit'} ${argent(t.profit_cents, l)}`;
  const marge = t.marge_pct == null
    ? (fr ? 'pas de marge en % sans revenu' : 'no % margin without revenue')
    : fr ? `${max ? 'marge d’au plus' : est ? 'marge estimée' : 'marge'} ${pct(t.marge_pct, l)}`
      : `${max ? 'margin of at most' : est ? 'estimated margin' : 'margin'} ${pct(t.marge_pct, l)}`;
  return tete + (fr
    ? `revenus ${argent(t.revenus_cents, l)}, coûts ${max ? 'connus ' : ''}${argent(t.couts_cents, l)}, ${profit} (${marge}).`
    : `revenue ${argent(t.revenus_cents, l)}, ${max ? 'known ' : ''}costs ${argent(t.couts_cents, l)}, ${profit} (${marge}).`);
}

function extremes(r: SansResume, tous: Groupe[], l: Langue): string {
  if (r.filtres_noms.job || r.completude === 'insuffisante') return '';
  const avecRevenu = tous.filter((g) => g.revenus_cents > 0 && g.completude !== 'insuffisante');
  if (avecRevenu.length < 2) return '';
  const tries = avecRevenu.slice().sort((a, b) => b.profit_cents - a.profit_cents);
  const fr = l === 'fr';
  const p = (g: Groupe) => `${g.marge_est_un_maximum ? (fr ? 'profit d’au plus' : 'profit of at most') : 'profit'} ${argent(g.profit_cents, l)}`;
  const haut = tries[0];
  const bas = tries[tries.length - 1];
  return fr
    ? ` Plus rentable : ${haut.nom} (${p(haut)}) ; moins rentable : ${bas.nom} (${p(bas)}).`
    : ` Most profitable: ${haut.nom} (${p(haut)}); least profitable: ${bas.nom} (${p(bas)}).`;
}

/**
 * La réponse complète. `detail` (lignes à puces, ex. un classement) s'insère
 * juste après le chiffre : l'ordre chiffre → inclus → manquant → action tient.
 */
export function resumer(r: SansResume, l: Langue, tousLesGroupes: Groupe[] = r.groupes, detail: string[] = []): string {
  const fr = l === 'fr';
  const tete = chiffre(r, l) + (detail.length ? '' : extremes(r, tousLesGroupes, l));
  if (r.nb_jobs === 0) return tete;
  const phrases = [detail.length ? `${tete}\n${detail.join('\n')}\n` : tete];
  phrases.push(r.inclus.length
    ? `${fr ? 'Inclus' : 'Included'}${fr ? ' : ' : ': '}${r.inclus.map((i) => inclusTexte(i, l)).join(', ')}.`
    : (fr ? 'Inclus : aucune donnée.' : 'Included: no data.'));
  phrases.push(r.manquant.length
    ? `${fr ? 'Manquant' : 'Missing'}${fr ? ' : ' : ': '}${r.manquant.map((m) => manquantTexte(m, l)).join(', ')}.`
    : (fr ? 'Rien ne manque.' : 'Nothing is missing.'));
  if (r.action) phrases.push(`${fr ? 'À faire : ' : 'Next step: '}${fr ? r.action.fr : r.action.en}`);
  return phrases.join(' ').replace(/\n /g, '\n');
}
