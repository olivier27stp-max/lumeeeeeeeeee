// Fiche de santé des bureaux (Réglages → Bureaux).
//
// Chaque bureau est comparé au bureau de BASE de l'entreprise (règle de
// Rafba, 2026-09-25 : « toujours se fier au bureau de base ») et on signale ce
// qui manque, avec le geste pour le régler. `evaluerSante` est pure : les
// faits sont lus par la route (server/routes/orgs.ts), les libellés sont
// composés par le client (fr/en).
//
// Ce qui ne se copie JAMAIS d'un bureau à l'autre (numéros de taxes, numéro
// SMS, compte de paiement) est signalé avec un lien vers la page à remplir,
// jamais avec « Reprendre du bureau de base » : ça dépend de l'entité légale
// ou ça coûte de l'argent, c'est au propriétaire de décider.

export type EtatSante = 'ok' | 'attention' | 'manquant';

export type ActionSante =
  | { type: 'reprendre'; section: 'taxes' | 'modeles' }
  | { type: 'page'; chemin: string }
  | { type: 'suivre_marque' }
  | { type: 'acces' };

export type CleSante = 'taxes' | 'numeros_taxes' | 'sms' | 'paiements' | 'marque' | 'automatisations' | 'prefixe' | 'equipe' | 'modeles';

export interface PointSante {
  cle: CleSante;
  etat: EtatSante;
  /** Valeurs affichées dans le détail (le client compose la phrase). */
  infos: Record<string, string | number | boolean | string[]>;
  action?: ActionSante;
}

export const TABLES_MODELES_SANTE = [
  'role_templates', 'invoice_templates', 'quote_templates', 'job_templates', 'checklist_templates', 'custom_fields',
] as const;
export type TableModele = typeof TABLES_MODELES_SANTE[number];

export interface FaitsBureau {
  org_id: string;
  nom: string;
  groupe_taxes_defaut: boolean;
  nb_groupes_taxes: number;
  /** Noms des taxes actives sans numéro d'inscription (dédoublonnés). */
  taxes_sans_numero: string[];
  nb_taxes_actives: number;
  sms: string | null;
  stripe: 'aucun' | 'incomplet' | 'actif';
  logo: boolean;
  suit_marque: boolean;
  automatisations_actives: number;
  prefixe: string | null;
  membres: Record<string, number>;
  modeles: Record<TableModele, number>;
}

export interface SanteBureau {
  org_id: string;
  nom: string;
  est_base: boolean;
  points: PointSante[];
  a_regler: number;
}

const ORDRE: Record<EtatSante, number> = { manquant: 0, attention: 1, ok: 2 };

export function evaluerSante(
  f: FaitsBureau,
  base: FaitsBureau | null,
  contexte: { est_base: boolean; marque_commune: boolean; prefixes_des_autres: string[] },
): SanteBureau {
  const points: PointSante[] = [];
  const b = contexte.est_base ? null : base;

  // Taxes par défaut
  if (f.groupe_taxes_defaut) {
    points.push({ cle: 'taxes', etat: 'ok', infos: { nb: f.nb_taxes_actives } });
  } else {
    const peutReprendre = !!b?.groupe_taxes_defaut && f.nb_groupes_taxes === 0;
    points.push({
      cle: 'taxes', etat: 'manquant', infos: { base: b?.nom ?? '' },
      action: peutReprendre ? { type: 'reprendre', section: 'taxes' } : { type: 'page', chemin: '/settings/taxes' },
    });
  }

  // Numéros d'inscription : seulement pertinents s'il y a des taxes.
  if (f.nb_taxes_actives > 0) {
    points.push(f.taxes_sans_numero.length === 0
      ? { cle: 'numeros_taxes', etat: 'ok', infos: {} }
      : { cle: 'numeros_taxes', etat: 'attention', infos: { taxes: f.taxes_sans_numero }, action: { type: 'page', chemin: '/settings/taxes' } });
  }

  points.push(f.sms
    ? { cle: 'sms', etat: 'ok', infos: { numero: f.sms } }
    : { cle: 'sms', etat: 'manquant', infos: { base_en_a: !!b?.sms, base: b?.nom ?? '' }, action: { type: 'page', chemin: '/settings/messaging' } });

  points.push(f.stripe === 'actif'
    ? { cle: 'paiements', etat: 'ok', infos: {} }
    : { cle: 'paiements', etat: f.stripe === 'incomplet' ? 'attention' : 'manquant', infos: { stripe: f.stripe }, action: { type: 'page', chemin: '/settings/payments' } });

  if (f.suit_marque) points.push({ cle: 'marque', etat: 'ok', infos: { suit: true } });
  else if (f.logo) points.push({ cle: 'marque', etat: 'ok', infos: { suit: false } });
  else points.push({
    cle: 'marque', etat: 'attention', infos: { marque_commune: contexte.marque_commune },
    action: contexte.marque_commune ? { type: 'suivre_marque' } : { type: 'page', chemin: '/settings/company' },
  });

  points.push(f.automatisations_actives > 0
    ? { cle: 'automatisations', etat: 'ok', infos: { nb: f.automatisations_actives } }
    : { cle: 'automatisations', etat: 'manquant', infos: { nb: 0 }, action: { type: 'page', chemin: '/automations' } });

  const prefixe = (f.prefixe || '').toUpperCase();
  if (!prefixe) {
    points.push({ cle: 'prefixe', etat: 'attention', infos: { prefixe: '' }, action: { type: 'page', chemin: '/settings/company' } });
  } else if (contexte.prefixes_des_autres.map((p) => p.toUpperCase()).includes(prefixe)) {
    points.push({ cle: 'prefixe', etat: 'attention', infos: { prefixe, double: true }, action: { type: 'page', chemin: '/settings/company' } });
  } else {
    points.push({ cle: 'prefixe', etat: 'ok', infos: { prefixe } });
  }

  const total = Object.values(f.membres).reduce((s, n) => s + n, 0);
  const proprietaires = f.membres.owner || 0;
  points.push(total > proprietaires
    ? { cle: 'equipe', etat: 'ok', infos: { total, ...f.membres } }
    : { cle: 'equipe', etat: 'attention', infos: { total, owner: proprietaires }, action: { type: 'acces' } });

  // Modèles : ce que le bureau de base a et que ce bureau n'a pas du tout.
  if (b) {
    const manquants = TABLES_MODELES_SANTE.filter((t) => (b.modeles[t] || 0) > 0 && (f.modeles[t] || 0) === 0);
    points.push(manquants.length === 0
      ? { cle: 'modeles', etat: 'ok', infos: { base: b.nom } }
      : { cle: 'modeles', etat: 'attention', infos: { manquants: [...manquants], base: b.nom }, action: { type: 'reprendre', section: 'modeles' } });
  }

  points.sort((x, y) => ORDRE[x.etat] - ORDRE[y.etat]);
  return {
    org_id: f.org_id,
    nom: f.nom,
    est_base: contexte.est_base,
    points,
    a_regler: points.filter((p) => p.etat !== 'ok').length,
  };
}
