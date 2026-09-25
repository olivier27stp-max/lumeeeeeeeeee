// Fiche de santé des bureaux + copie « exactement la même configuration » que
// le bureau de base (règle de Rafba, 2026-09-25).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluerSante, type FaitsBureau } from '../server/lib/office-health';
import { clonerLigne, filtrerTaxesACopier, NO_INHERIT } from '../server/lib/office-inheritance';

const modeles = (n: number) => ({
  role_templates: n, invoice_templates: n, quote_templates: n, job_templates: n, checklist_templates: n, custom_fields: n,
});

const coquin: FaitsBureau = {
  org_id: 'coquin', nom: 'Coquin lavage', groupe_taxes_defaut: true, nb_groupes_taxes: 1,
  taxes_sans_numero: ['TPS', 'TVQ'], nb_taxes_actives: 2, sms: '+15145550100', stripe: 'incomplet',
  logo: true, suit_marque: false, automatisations_actives: 30, prefixe: 'CL',
  membres: { owner: 2, admin: 2, sales_rep: 4 }, modeles: modeles(3),
};

const vision: FaitsBureau = {
  ...coquin, org_id: 'vision', nom: 'Vision Lavage', groupe_taxes_defaut: false, nb_groupes_taxes: 0,
  taxes_sans_numero: [], nb_taxes_actives: 0, sms: null, stripe: 'aucun', logo: false, suit_marque: false,
  prefixe: 'VL', membres: { owner: 2 }, modeles: { ...modeles(0), role_templates: 5 },
};

const ctx = { est_base: false, marque_commune: true, prefixes_des_autres: ['CL'] };
const point = (s: ReturnType<typeof evaluerSante>, cle: string) => s.points.find((p) => p.cle === cle);

describe('evaluerSante — comparé au bureau de base', () => {
  const s = evaluerSante(vision, coquin, ctx);

  it('taxes absentes : on propose de les reprendre du bureau de base', () => {
    expect(point(s, 'taxes')).toMatchObject({ etat: 'manquant', action: { type: 'reprendre', section: 'taxes' } });
  });

  it('taxes absentes mais des groupes existent déjà : jamais de copie par-dessus, on envoie à la page', () => {
    const s2 = evaluerSante({ ...vision, nb_groupes_taxes: 1 }, coquin, ctx);
    expect(point(s2, 'taxes')?.action).toEqual({ type: 'page', chemin: '/settings/taxes' });
  });

  it('SMS, paiements : jamais « reprendre », toujours la page (coût, entité légale)', () => {
    expect(point(s, 'sms')).toMatchObject({ etat: 'manquant', infos: { base_en_a: true }, action: { type: 'page' } });
    expect(point(s, 'paiements')).toMatchObject({ etat: 'manquant', action: { type: 'page' } });
    for (const p of s.points) if (p.cle !== 'taxes' && p.cle !== 'modeles') expect(p.action?.type).not.toBe('reprendre');
  });

  it('marque : suivre la marque commune quand elle existe', () => {
    expect(point(s, 'marque')?.action).toEqual({ type: 'suivre_marque' });
  });

  it('équipe réduite aux propriétaires : on renvoie à la grille d’accès', () => {
    expect(point(s, 'equipe')).toMatchObject({ etat: 'attention', action: { type: 'acces' } });
  });

  it('modèles : liste ce que le bureau de base a et que ce bureau n’a pas', () => {
    const m = point(s, 'modeles');
    expect(m?.etat).toBe('attention');
    expect(m?.infos.manquants).toEqual(['invoice_templates', 'quote_templates', 'job_templates', 'checklist_templates', 'custom_fields']);
  });

  it('préfixe identique à un autre bureau : signalé', () => {
    const s2 = evaluerSante({ ...vision, prefixe: 'cl' }, coquin, ctx);
    expect(point(s2, 'prefixe')).toMatchObject({ etat: 'attention', infos: { double: true } });
  });

  it('les points à régler passent en premier', () => {
    const etats = s.points.map((p) => p.etat);
    expect(etats.indexOf('ok')).toBeGreaterThan(etats.lastIndexOf('manquant'));
    expect(s.a_regler).toBe(s.points.filter((p) => p.etat !== 'ok').length);
  });

  it('le bureau de base ne se compare pas à lui-même (pas de point « modèles »)', () => {
    const b = evaluerSante(coquin, coquin, { ...ctx, est_base: true, prefixes_des_autres: ['VL'] });
    expect(point(b, 'modeles')).toBeUndefined();
    expect(point(b, 'paiements')?.etat).toBe('attention');
    expect(point(b, 'numeros_taxes')).toMatchObject({ etat: 'attention', infos: { taxes: ['TPS', 'TVQ'] } });
  });
});

describe('clonerLigne — copie conforme d’un modèle', () => {
  it('nouvel id, nouveau bureau, nouveau créateur ; tout le reste identique', () => {
    const r = { id: 'x', org_id: 'coquin', created_at: 't', updated_at: 't', created_by: 'olivier', name: 'Facture', content: { a: 1 }, legacy_column_id: 'l' };
    expect(clonerLigne(r, 'vision', 'will', ['legacy_column_id'])).toEqual({ org_id: 'vision', created_by: 'will', name: 'Facture', content: { a: 1 } });
  });

  it('ne crée pas de created_by sur une table qui n’en a pas', () => {
    expect(clonerLigne({ id: 'x', org_id: 'a', name: 'n' }, 'b', 'will')).toEqual({ org_id: 'b', name: 'n' });
  });

  it('la section « modèles » est désactivée par défaut (appelants existants inchangés)', () => {
    expect(NO_INHERIT.modeles).toBe(false);
  });
});

describe('Nouveau bureau : « exactement la même configuration » par défaut', () => {
  const src = readFileSync('src/pages/OfficeNew.tsx', 'utf8');
  it('toutes les sections, y compris « modèles », sont cochées d’office', () => {
    const defaut = src.match(/const DEFAULT_INHERIT: OfficeInherit = \{([\s\S]*?)\};/)?.[1] ?? '';
    for (const k of ['branding', 'taxes', 'email_templates', 'tags_sources', 'modeles']) expect(defaut).toMatch(new RegExp(`${k}: true`));
  });
  it('la route accepte « modeles »', () => {
    expect(readFileSync('server/routes/orgs.ts', 'utf8')).toMatch(/modeles: z\.boolean\(\)\.default\(false\)/);
  });
});

// QA 2026-09-25 (compte Grok Audit) : « 4 taxe(s) active(s) » puis 6 après
// chaque cycle supprimer la région → reprendre. Cause : supprimer une région
// laissait ses taxes actives (orphelines, invisibles dans Réglages → Taxes),
// la fiche les comptait et la copie les recopiait.
describe('taxes orphelines (région supprimée)', () => {
  const configs = [
    { id: 'tps', name: 'TPS', is_active: true },
    { id: 'tvq', name: 'TVQ', is_active: true },
    { id: 'tps-orph', name: 'TPS', is_active: true },
    { id: 'tvq-orph', name: 'TVQ', is_active: true },
    { id: 'vieille', name: 'X', is_active: false },
  ];

  it('la copie ne prend que les taxes reliées à une région', () => {
    const items = [{ tax_config_id: 'tps' }, { tax_config_id: 'tvq' }];
    expect(filtrerTaxesACopier(configs, items).map((c) => c.id)).toEqual(['tps', 'tvq']);
  });

  it('source sans aucune région : ses taxes actives restent la vérité', () => {
    expect(filtrerTaxesACopier(configs, null).map((c) => c.id)).toEqual(['tps', 'tvq', 'tps-orph', 'tvq-orph']);
  });

  it('la fiche compte les taxes de la région par défaut (tax_group_items), pas toutes les tax_configs', () => {
    const src = readFileSync('server/routes/orgs.ts', 'utf8');
    const route = src.slice(src.indexOf("router.get('/orgs/offices/sante'"), src.indexOf("router.post('/orgs/offices/:id/reprendre-base'"));
    expect(route).toContain("from('tax_group_items')");
    expect(route).not.toMatch(/from\('tax_configs'\)/);
  });

  it('supprimer une région désactive ses taxes devenues orphelines (jamais supprimées)', () => {
    const src = readFileSync('server/routes/taxes.ts', 'utf8');
    const route = src.slice(src.indexOf("router.delete('/taxes/group/:id'"), src.indexOf("router.patch('/taxes/group/:id/default'"));
    expect(route).toMatch(/from\('tax_configs'\)\.update\(\{ is_active: false \}\)/);
    expect(route).not.toMatch(/from\('tax_configs'\)\.delete\(/);
  });
});
