/**
 * Agent E — Lumi (« Construire avec Lumi », VRAI modèle) utilise-t-il les mêmes variables que
 * le moteur, et seulement celles qui ont une valeur pour le déclencheur ? Passe COURTE : trois
 * demandes, un appel chacune.
 *
 *   QA_AUTO_SUFFIXE=e npx tsx --env-file=.env.local scripts/qa/finale/e/lumi-variables-essai.mts
 *
 * Sortie : D:/lume-final/sorties/e/lumi-variables-essai.json
 */
import { writeFileSync } from 'node:fs';
import { assurerBureauTest } from '../../../../tests/automations-suite/harnais/bureau-test';
import { genererParcours } from '../../../../server/lib/lumi/generer-parcours';
import { VARIABLES_CONNUES } from '../../../../src/lib/emailBodyText';
import { segmentsSms } from '../../../../src/lib/smsSegments';

if (!/localhost|127\.0\.0\.1/.test(process.env.VITE_SUPABASE_URL ?? '')) throw new Error('REFUS : pile LOCALE seulement.');
if ((process.env.QA_AUTO_SUFFIXE ?? '') !== 'e') throw new Error('REFUS : QA_AUTO_SUFFIXE=e attendu.');
const b = await assurerBureauTest();

const DEMANDES = [
  'Quand un nouveau prospect arrive, envoie-lui tout de suite un texto de bienvenue avec son prénom.',
  'Quand un nouveau prospect arrive, envoie-lui un texto avec le montant de sa facture et le lien pour la payer.',
  'Quand une facture est en retard, envoie un texto au client avec le solde qui reste à payer, le nombre de jours de retard et le lien de paiement. Si son prénom est vide, écris « Bonjour là ».',
];
/** Variables qui n'ont une valeur QUE sur une facture, un devis ou un rendez-vous. */
const DE_FACTURE = ['invoice_number', 'invoice_total', 'invoice_due_date', 'invoice_link'];

const sortie: Array<Record<string, unknown>> = [];
for (const demande of DEMANDES) {
  const r = await genererParcours({ admin: b.admin, orgId: b.orgA, userId: b.users.proprioA, demande, langue: 'fr' });
  const etapes = (r.parcours?.steps ?? []) as Array<{ type?: string; action?: { type?: string; config?: Record<string, unknown> } }>;
  const textes = etapes.flatMap((e) => (e.type === 'action' && e.action?.config ? [String(e.action.config.body ?? ''), String(e.action.config.subject ?? '')] : [])).filter(Boolean);
  const citees = [...new Set(textes.flatMap((t) => [...t.matchAll(/\[([A-Za-z]\w*)\]|\{\{\s*([a-z]+\.[a-z0-9_]+)\s*\}\}|\{([A-Za-z]\w*)\}/g)].map((m) => m[1] ?? m[2] ?? m[3])))];
  const declencheur = r.parcours?.trigger_event ?? null;
  sortie.push({
    demande, declencheur, cout_cents: r.coutCents ?? null, erreur: r.erreur ?? null,
    resume: r.parcours?.resume ?? null,
    textes,
    variables_citees: citees,
    hors_liste_du_moteur: citees.filter((v) => !VARIABLES_CONNUES.includes(v)),
    variables_de_facture_sur_un_declencheur_sans_facture: declencheur && !declencheur.startsWith('invoice') ? citees.filter((v) => DE_FACTURE.includes(v)) : [],
    textos: etapes.filter((e) => e.action?.type === 'send_sms').map((e) => ({ longueur: String(e.action!.config!.body ?? '').length, ...segmentsSms(String(e.action!.config!.body ?? '')) })),
  });
}
writeFileSync('D:/lume-final/sorties/e/lumi-variables-essai.json', JSON.stringify(sortie, null, 2));
console.log(JSON.stringify(sortie, null, 2));
