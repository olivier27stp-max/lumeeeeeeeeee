/**
 * Agent P — le compteur « Touche X clients » (server/lib/automations-ciblage.ts, `apercuCiblage`)
 * sur 5 000 clients fictifs, lu AVEC LA SESSION D'UN PROPRIÉTAIRE (RLS) — comme le fera la route —
 * puis au rôle de service, pour comparer.
 *
 * Les cinq scénarios sont ceux de l'agent E (scripts/qa/finale/e/mesure-compteur-ciblage.mts) ;
 * ses nombres de référence (calculés en SQL et par son prototype) : 5 000 · 1 500 · 2 000 · 500 · 643.
 *
 *   # une fois : charger mon bureau B (p) avec le jeu de l'agent E
 *   MSYS_NO_PATHCONV=1 docker exec -i -u postgres lumefinal-db psql -U supabase_admin -d postgres \
 *     -v org=<bureau B (p)> -v proprio=<propriétaire B (p)> -f - < scripts/qa/finale/e/charge-5000-clients.sql
 *   QA_AUTO_SUFFIXE=p npx tsx --env-file=.env.local scripts/qa/finale/p/mesure-compteur-rls.mts
 */
import { assurerBureauTest, sessionDe, COMPTES } from '../../../../tests/automations-suite/harnais/bureau-test';
import { apercuCiblage } from '../../../../server/lib/automations-ciblage';
import type { Ciblage } from '../../../../src/lib/automationCiblage';

if (!/localhost|127\.0\.0\.1/.test(process.env.VITE_SUPABASE_URL ?? '')) throw new Error('REFUS : pile LOCALE seulement.');
if ((process.env.QA_AUTO_SUFFIXE ?? '') !== 'p') throw new Error('REFUS : QA_AUTO_SUFFIXE=p attendu.');

const b = await assurerBureauTest();
const org = b.orgB;
const { client: session } = await sessionDe(b.admin, COMPTES.proprioB.email);
const { data: champs } = await b.admin.from('custom_fields').select('id, key').eq('org_id', org).eq('object_type', 'client').is('archived_at', null);
const idDe = (cle: string) => String((champs ?? []).find((c) => c.key === cle)?.id ?? '');
const REFERE = idDe('refere_par');
const NOREVIEW = idDe('noreview');

const SCENARIOS: Array<{ nom: string; attendu: number; ciblage: Ciblage | null }> = [
  { nom: 'Tous les clients', attendu: 5000, ciblage: null },
  { nom: 'Étiquette VIP', attendu: 1500, ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }] } } },
  { nom: 'VIP OU Commercial, SAUF « Ne pas relancer »', attendu: 2000, ciblage: { inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'etiquette', valeur: 'Commercial' }] }, exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }] } },
  { nom: 'VIP ET « Référé par » = Facebook', attendu: 500, ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'champ', field_id: REFERE, op: 'is', value: 'Facebook' }] } } },
  { nom: 'Entreprise, pas un prospect, SAUF « noreview »', attendu: 643, ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'fiche', cle: 'genre', op: 'is', value: 'entreprise' }, { type: 'fiche', cle: 'status', op: 'is_not', value: 'lead' }] }, exclure: [{ type: 'champ', field_id: NOREVIEW, op: 'is', value: true }] } },
];

const mediane = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
const mesurer = async (db: typeof session, ciblage: Ciblage | null) => {
  const temps: number[] = [];
  let r = await apercuCiblage(db, org, { ciblage, canaux: ['sms', 'email'], demandeAvis: true });
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    r = await apercuCiblage(db, org, { ciblage, canaux: ['sms', 'email'], demandeAvis: true });
    temps.push(performance.now() - t0);
  }
  return { r, ms: Math.round(mediane(temps)), max: Math.round(Math.max(...temps)) };
};

const lignes: Array<Record<string, unknown>> = [];
let ecarts = 0;
for (const s of SCENARIOS) {
  const rls = await mesurer(session, s.ciblage);
  const service = await mesurer(b.admin as never, s.ciblage);
  if (rls.r.total !== s.attendu || service.r.total !== s.attendu) ecarts++;
  lignes.push({
    scénario: s.nom, attendu: s.attendu, 'RLS total': rls.r.total, 'service total': service.r.total,
    STOP: rls.r.dont.stop_texto, désab: rls.r.dont.desabonnes_courriel, 'sans avis': rls.r.dont.sans_avis,
    'RLS ms (médiane)': rls.ms, 'RLS ms (max)': rls.max, 'service ms (médiane)': service.ms,
  });
}
console.table(lignes);
console.log(ecarts === 0 ? 'Les cinq totaux sont ceux de la référence de l’agent E, sous RLS comme au rôle de service.' : `ÉCART sur ${ecarts} scénario(s).`);
process.exit(ecarts === 0 ? 0 : 1);
