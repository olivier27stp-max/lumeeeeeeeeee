/**
 * QA — qualité des « comment faire » du support Lumi, sur 50 questions de
 * clients québécois écrites comme ils écrivent (fautes, joual, sans accents).
 *
 *   node --env-file=.env.local --import tsx scripts/qa/evaluer-support-qualite.mts [--modele claude-haiku-4-5-20251001] [--seulement mot] [--juge non]
 *
 * Pour chaque question, un tour de repondreSupportIA (surface 'app', dossier
 * du compte QA, AUCUN outil de migration : rien n'est écrit en base), puis :
 *   1. une note DÉTERMINISTE : transfert conforme, route attendue citée
 *      (Lumi met la route entre parenthèses, ex. « (/settings/team) »),
 *      libellé exact attendu présent — routes et libellés tirés de CARTE_APP ;
 *   2. un JUGE (Haiku 4.5, sauf --juge non) qui compare la réponse aux extraits
 *      de chercherAide(question, 3) — la même vérité que celle que Lumi consulte —
 *      et rend exact / partiel / faux.
 * Coûts mesurés (jamais estimés), réponses et juge comptés à part. Un JSON
 * complet est écrit dans scripts/qa/rapports/ pour comparer deux modèles.
 * --modele X pose LUMI_SUPPORT_MODELE=X AVANT le chargement de ia.ts.
 * Sortie 1 si le déterministe est < 45/50 (90 % des cas joués) ou si le juge
 * compte ≥ 3 « faux ».
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL!;
const ref = process.env.SUPABASE_PROJECT_REF!;
if (!url.includes(ref) || ref === 'bbzcuzqfgsdvjsymfwmr') throw new Error('QA sur staging seulement');
// Jamais de Slack depuis la QA : .env.local porte les vraies clés Slack.
delete process.env.SLACK_BOT_TOKEN;
delete process.env.SLACK_SIGNING_SECRET;

// ── Arguments ──
const args = process.argv.slice(2);
function option(nom: string): string | null {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}
const modeleDemande = option('--modele');
const seulement = option('--seulement');
const avecJuge = option('--juge') !== 'non';
if (modeleDemande) process.env.LUMI_SUPPORT_MODELE = modeleDemande;

// ia.ts (et tout ce qui pourrait l'importer) se charge APRÈS la variable, pour que --modele soit vu.
const { repondreSupportIA, MODELE_SUPPORT } = await import('../../server/lib/support/ia');
const { dossierClient } = await import('../../server/lib/support/dossier');
const { contexteOrg, slaTexte } = await import('../../server/lib/support/tickets');
const { chercherAide } = await import('../../server/lib/agent/tools-aide');
const { clientAnthropic } = await import('../../server/lib/lumi/llm');
const { coutEnCents } = await import('../../server/lib/lumi/tarifs');

const MODELE_JUGE = 'claude-haiku-4-5-20251001';
/** coutEnCents ne connaît que les ids sans date (« claude-haiku-4-5 ») : sans ce retrait, le juge serait compté au tarif plancher Opus. */
const TARIF_JUGE = MODELE_JUGE.replace(/-\d{8}$/, '');
const modeleEffectif = process.env.LUMI_SUPPORT_MODELE || MODELE_SUPPORT;

// ── Contexte QA (identique à evaluer-support.mts) ──
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const email = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const { data: lien, error: eLien } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
if (eLien || !lien?.user) throw new Error(`compte QA introuvable : ${eLien?.message}`);
const user = lien.user;
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', user.id).eq('status', 'active').limit(1).maybeSingle();
const orgId = m!.org_id as string;
const dossier = await dossierClient(admin, orgId, user.id);
const ctx = await contexteOrg(admin, orgId, user);
const contexte = { langue: ctx.langue, companyName: ctx.companyName, planLabel: ctx.planLabel, userName: ctx.userName, slaTexte: slaTexte(ctx.slaKey, ctx.langue), surface: 'app' as const, dossier: dossier.texte };

// ── Les cas ──
interface Attendu { route?: RegExp; mots?: RegExp; transfert: boolean | 'tolere' }
interface Cas { id: string; question: string; attendu: Attendu }

const CAS: Cas[] = [
  // ── Travail quotidien ──
  { id: 'taches-supprimer', question: "comment je fais pour effacer une tache que j'ai pu besoin", attendu: { route: /\/tasks/, mots: /Supprimer/, transfert: false } },
  { id: 'jobs-supprimer', question: "c'est où pour supprimer une job au complet", attendu: { route: /\/jobs/, mots: /Supprimer/, transfert: false } },
  { id: 'calendrier-creer', question: 'comment je cree une job direct dans le calendrier', attendu: { route: /\/calendar/, mots: /Créer/, transfert: false } },
  { id: 'repartition-map', question: "c'est où que je vois mes gars sur la map en temps réel", attendu: { route: /\/dispatch/, mots: /répartition/i, transfert: false } },
  { id: 'clients-archiver', question: "mon client a fermé sa shop, comment je l'archive", attendu: { route: /\/clients/, mots: /Archiver/, transfert: false } },
  { id: 'demandes-convertir', question: "j'ai recu une demande par mon formulaire, comment je la change en soumission", attendu: { route: /\/requests/, mots: /Convertir en devis/, transfert: false } },
  { id: 'devis-modele', question: 'comment je fais un modèle de soumission pour pas tout retaper à chaque fois', attendu: { route: /\/quotes\/(presets|templates)/, mots: /Nouveau modèle/, transfert: false } },
  { id: 'devis-mesure', question: 'est-ce que je peux mesurer le terrain sur une carte pour ma soumission', attendu: { route: /\/quotes(\/:id)?\/measure/, mots: /Envoyer au devis|Terminer|Rechercher une adresse/, transfert: false } },
  { id: 'devis-depot', question: "je veux demander un dépot de 30% sur mes soumissions, c'est où", attendu: { route: /\/quotes/, mots: /dépôt/i, transfert: false } },
  { id: 'messages-texto', question: "comment j'envoie un texto a un client", attendu: { route: /\/messages/, mots: /Nouveau message/, transfert: false } },
  // ── Argent ──
  { id: 'factures-creer', question: 'comment je fais une facture', attendu: { route: /\/invoices\/new|\/finances/, mots: /Nouvelle facture/, transfert: false } },
  { id: 'factures-payee', question: "mon client m'a payé cash, comment je marque sa facture payée", attendu: { route: /\/finances|\/invoices/, mots: /Marquer payée/, transfert: false } },
  { id: 'finances-paiements', question: "c'est où que je vois tous les paiements que j'ai recus ce mois-ci", attendu: { route: /\/finances/, mots: /Paiements/, transfert: false } },
  { id: 'finances-versements', question: "c'est où que je vois quand l'argent rentre dans mon compte de banque", attendu: { route: /\/finances/, mots: /Versements/, transfert: false } },
  { id: 'finances-csv', question: 'je veux sortir mes factures en csv pour mon comptable', attendu: { route: /\/finances/, mots: /CSV/, transfert: false } },
  // Les cinq suivants : la page existe (/settings/payments) mais ses interrupteurs, litiges et versements instantanés ne sont PAS décrits dans CARTE_APP → route seule.
  { id: 'payments-interrupteurs', question: 'je veux fermer le paiement en ligne sur les devis mais le garder sur les factures', attendu: { route: /\/settings\/payments/, transfert: false } },
  { id: 'payments-pourboires', question: 'est-ce que mes clients peuvent laisser un pourboire quand ils paient leur facture', attendu: { route: /\/settings\/payments/, transfert: false } },
  { id: 'payments-instantanes', question: "je peux tu recevoir mon argent le jour meme au lieu d'attendre le versement", attendu: { route: /\/settings\/payments|\/finances/, transfert: false } },
  { id: 'payments-litiges', question: 'un client a contesté un paiement sur sa carte, je fais quoi', attendu: { transfert: 'tolere' } },
  { id: 'payments-rappels', question: "comment j'active les rappels automatiques pour les factures en retard", attendu: { route: /\/settings\/payments|\/automations/, mots: /rappel|relance/i, transfert: false } },
  { id: 'taxes-region', question: "comment j'ajoute la TPS pis la TVQ sur mes factures", attendu: { route: /\/settings\/taxes/, mots: /Ajouter une région/, transfert: false } },
  // Un changement de forfait est aussi un motif de transfert dans le prompt : toléré.
  { id: 'forfait-changer', question: 'je veux monter de forfait, je fais ça où', attendu: { route: /\/settings\/billing/, mots: /Changer ou rétrograder mon plan|Voir tous les plans|Passer à/, transfert: 'tolere' } },
  { id: 'commissions-voir', question: "c'est où que je vois mes commissions du mois", attendu: { route: /\/commissions/, mots: /Mes commissions/, transfert: false } },
  { id: 'paie-export', question: 'comment je sors la paie de mes gars pour quickbooks', attendu: { route: /\/settings\/payroll/, mots: /Exporter/, transfert: false } },
  // ── Équipe & temps ──
  { id: 'membres-inviter', question: "comment j'ajoute un nouvel employé dans lume", attendu: { route: /\/settings\/team/, mots: /Inviter un membre/, transfert: false } },
  { id: 'roles-permissions', question: 'je veux pas que mes techniciens voient les factures, je fais comment', attendu: { route: /\/settings\/roles/, mots: /permission/i, transfert: false } },
  { id: 'temps-approuver', question: "comment j'approuve les heures de mes gars pour la semaine", attendu: { route: /\/timesheets/, mots: /Approuver/, transfert: false } },
  { id: 'gps-activer', question: "je veux voir où sont mes trucks, comment j'active le gps", attendu: { route: /\/settings\/location/, mots: /GPS/i, transfert: false } },
  { id: 'formations-creer', question: 'comment je fais une formation pour mes nouveaux employés', attendu: { route: /\/courses/, mots: /Créer une formation/, transfert: false } },
  // ── Vente terrain ──
  { id: 'terrain-pin', question: "comment j'ajoute une adresse sur la map de porte a porte", attendu: { route: /\/field-sales/, mots: /Ajouter un pin/, transfert: false } },
  { id: 'terrain-pipeline', question: "comment je change l'étape d'un deal dans le pipeline", attendu: { route: /\/pipeline/, mots: /glisser/i, transfert: false } },
  { id: 'terrain-classement', question: 'je veux voir le classement de mes reps pour le mois passé', attendu: { route: /\/leaderboard/, mots: /Changer/, transfert: false } },
  { id: 'terrain-rapports', question: "c'est où les rapports de vente terrain de la semaine", attendu: { route: /\/d2d-reports/, mots: /hebdomadaire/i, transfert: false } },
  { id: 'stats-revenus', question: 'je veux voir mes revenus des 12 derniers mois', attendu: { route: /\/insights/, mots: /12 derniers mois/, transfert: false } },
  // ── Réglages ──
  { id: 'profil-langue', question: "comment je mets l'app en anglais", attendu: { route: /\/settings\/profile/, mots: /English|Langue de l'interface/, transfert: false } },
  { id: 'entreprise-logo', question: 'je veux mettre mon logo sur mes factures', attendu: { route: /\/settings\/company/, mots: /logo/i, transfert: false } },
  { id: 'bureaux-nouveau', question: "j'ouvre une 2e succursale, comment j'ajoute un bureau", attendu: { route: /\/settings\/offices/, mots: /Nouveau bureau/, transfert: false } },
  { id: 'produits-service', question: "comment j'ajoute un service avec son prix", attendu: { route: /\/settings\/products/, mots: /Nouveau service/, transfert: false } },
  { id: 'automatisations-pause', question: 'comment je mets en pause une automatisation qui envoie trop de courriels', attendu: { route: /\/automations/, mots: /Désactiver|interrupteur/i, transfert: false } },
  { id: 'avis-google', question: 'comment je demande un avis google apres une job', attendu: { route: /\/settings\/reviews/, mots: /Demander un avis/, transfert: false } },
  { id: 'formulaire-site', question: 'comment je mets le formulaire de demande sur mon site web', attendu: { route: /\/settings\/request-form/, mots: /Copier ce code/, transfert: false } },
  { id: 'securite-2fa', question: "c'est quoi le code qr qu'il me demande quand j'invite quelqu'un", attendu: { mots: /Google Authenticator|6 chiffres|QR/i, transfert: false } },
  { id: 'connexion-mdp', question: "j'ai oublié mon mot de passe pis je rentre pu", attendu: { route: /\/auth|\/reset-password/, mots: /Mot de passe oublié/, transfert: false } },
  { id: 'pages-clients-devis', question: "mon client recoit quoi quand j'envoie une soumission", attendu: { route: /\/quote\//, mots: /approuver/i, transfert: false } },
  // ── Hors « comment faire » ──
  { id: 'hors-bug', question: "quand j'ouvre le calendrier ça charge sans arret pis ça affiche rien", attendu: { transfert: true } },
  { id: 'hors-humain', question: 'je veux parler à une vraie personne svp', attendu: { transfert: true } },
  { id: 'hors-lume', question: 'est-ce que je peux déduire mon camion dans mes impots', attendu: { mots: /hors|extérieur|pas .{0,40}(Lume|CRM)|comptable|ne (concerne|couvre|relève) pas/i, transfert: false } },
  // Ajusté après lecture du dossier : sans abonnement sur staging, « aucun abonnement » est la bonne réponse (transfert toléré).
  { id: 'compte-forfait', question: "c'est quoi mon forfait pis ça se renouvelle quand", attendu: { transfert: false } },
  { id: 'compte-paiements', question: 'est-ce que lume payments est déja branché sur mon compte', attendu: { transfert: false } },
  { id: 'ambigu-taches', question: 'comment je supprime toutes mes taches de la semaine passée', attendu: { mots: /(tâche[\s\S]*(job|travau))|((job|travau)[\s\S]*tâche)|précis|voulez-vous dire|parlez-vous|s'agit-il/i, transfert: false } },
];

const casForfait = CAS.find((c) => c.id === 'compte-forfait')!;
casForfait.attendu = /aucun abonnement/i.test(dossier.texte) ? { transfert: 'tolere', mots: /abonnement/i } : { transfert: false, mots: new RegExp(ctx.planLabel, 'i') };

const joues = seulement ? CAS.filter((c) => c.id.includes(seulement) || c.question.includes(seulement)) : CAS;
if (!joues.length) throw new Error(`aucun cas ne contient « ${seulement} »`);

// ── Juge ──
type NoteJuge = 'exact' | 'partiel' | 'faux';
interface Jugement { note: NoteJuge | 'illisible'; raison: string; coutCents: number }

async function juger(question: string, reponse: string, transfere: boolean): Promise<Jugement> {
  const extraits = chercherAide(question, 3).map((p) => `— ${p.titre} (${p.page}) : ${p.extrait}`).join('\n');
  const system = `Tu notes la réponse d'un assistant de support pour un CRM. Voici la vérité (extraits de la carte de l'app) :
${extraits || '(aucun extrait)'}
Réponds UNIQUEMENT en JSON : {"note": "exact"|"partiel"|"faux", "raison": "…"} . exact = le chemin et les boutons cités existent et répondent ; partiel = bonne page mais détail manquant ou flou ; faux = bouton ou page inventé, ou réponse à côté.`;
  const r = await clientAnthropic().messages.create({
    model: MODELE_JUGE,
    max_tokens: 200,
    system,
    messages: [{ role: 'user', content: `Question du client : ${question}\nRéponse de l'assistant : ${reponse}\nTransfert à l'équipe : ${transfere ? 'oui' : 'non'}` }],
  });
  const coutCents = coutEnCents(TARIF_JUGE, r.usage);
  const texte = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const brut = /\{[\s\S]*\}/.exec(texte)?.[0];
  try {
    const j = JSON.parse(brut ?? '') as { note?: unknown; raison?: unknown };
    const note = typeof j.note === 'string' && ['exact', 'partiel', 'faux'].includes(j.note) ? (j.note as NoteJuge) : 'illisible';
    return { note, raison: String(j.raison ?? '').slice(0, 200), coutCents };
  } catch {
    return { note: 'illisible', raison: texte.replace(/\s+/g, ' ').slice(0, 200), coutCents };
  }
}

// ── Boucle ──
interface Resultat {
  id: string; question: string; reponse: string; transfert: boolean; motif: string | null; outils: string[];
  attendu: { route: string | null; mots: string | null; transfert: boolean | 'tolere' };
  deterministe: { ok: boolean; transfertOk: boolean; routeOk: boolean | null; motsOk: boolean | null };
  juge: { note: Jugement['note']; raison: string } | null;
  coutCents: number; coutJugeCents: number; erreur?: string;
}

const resultats: Resultat[] = [];
let coutReponses = 0;
let coutJuge = 0;
const compte = { exact: 0, partiel: 0, faux: 0, illisible: 0 };
const marque = (v: boolean | null) => (v === null ? '—' : v ? '✓' : '✗');

for (let i = 0; i < joues.length; i++) {
  const c = joues[i];
  if (i > 0) await new Promise((r) => setTimeout(r, 1500));
  let reponse = '';
  let transfert = false;
  let motif: string | null = null;
  let outils: string[] = [];
  let coutCents = 0;
  let erreur: string | undefined;
  try {
    const r = await repondreSupportIA(contexte, [], c.question, {});
    reponse = r.texte; transfert = r.transferer; motif = r.motif; outils = r.outils; coutCents = r.coutCents;
  } catch (e: any) {
    erreur = String(e?.message || e).slice(0, 200);
  }
  coutReponses += coutCents;
  const transfertOk = !erreur && (c.attendu.transfert === 'tolere' || transfert === c.attendu.transfert);
  const routeOk = c.attendu.route ? c.attendu.route.test(reponse) : null;
  const motsOk = c.attendu.mots ? c.attendu.mots.test(reponse) : null;
  const ok = transfertOk && routeOk !== false && motsOk !== false;

  let juge: Resultat['juge'] = null;
  let coutJugeCents = 0;
  if (avecJuge && !erreur) {
    try {
      const j = await juger(c.question, reponse, transfert);
      juge = { note: j.note, raison: j.raison };
      coutJugeCents = j.coutCents;
      compte[j.note]++;
    } catch (e: any) {
      juge = { note: 'illisible', raison: `juge en erreur : ${String(e?.message || e).slice(0, 120)}` };
      compte.illisible++;
    }
  }
  coutJuge += coutJugeCents;

  resultats.push({
    id: c.id, question: c.question, reponse, transfert, motif, outils,
    attendu: { route: c.attendu.route?.source ?? null, mots: c.attendu.mots?.source ?? null, transfert: c.attendu.transfert },
    deterministe: { ok, transfertOk, routeOk, motsOk }, juge, coutCents, coutJugeCents, erreur,
  });
  const apercu = erreur ? `ERREUR : ${erreur}` : reponse.replace(/\n/g, ' / ').slice(0, 220);
  console.log(`${ok ? 'OK ' : 'KO '} [${c.id}] ${c.question}\n     R : ${apercu}\n     transfert=${transfert}${motif ? ` (${motif.slice(0, 80)})` : ''} · route=${marque(routeOk)} · mots=${marque(motsOk)}${juge ? ` · juge=${juge.note}${juge.raison ? ` — ${juge.raison}` : ''}` : ''} · ${coutCents.toFixed(2)} ¢`);
}

// ── Bilan ──
const reussis = resultats.filter((r) => r.deterministe.ok).length;
console.log(`\ndéterministe : ${reussis}/${joues.length}`);
if (avecJuge) console.log(`juge : exact ${compte.exact} · partiel ${compte.partiel} · faux ${compte.faux}${compte.illisible ? ` · illisible ${compte.illisible}` : ''}`);
console.log(`coût réponses : ${coutReponses.toFixed(2)} ¢ · coût juge : ${coutJuge.toFixed(2)} ¢`);
console.log(`modèle : ${modeleEffectif}${avecJuge ? ` · juge : ${MODELE_JUGE}` : ''}`);

const dossierRapports = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'rapports');
mkdirSync(dossierRapports, { recursive: true });
const fichier = path.join(dossierRapports, `support-qualite-${modeleEffectif.replace(/[^a-z0-9.-]/gi, '_')}-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(fichier, JSON.stringify({
  date: new Date().toISOString(), modele: modeleEffectif, juge: avecJuge ? MODELE_JUGE : null, seulement, compte: email,
  deterministe: { reussis, total: joues.length }, jugeCompte: avecJuge ? compte : null,
  coutReponsesCents: coutReponses, coutJugeCents: coutJuge, cas: resultats,
}, null, 2));
console.log(`rapport : ${fichier}`);

// 45/50 = 90 % ; le même seuil s'applique proportionnellement à un sous-ensemble (--seulement).
const seuil = Math.ceil(joues.length * 0.9);
const echec = reussis < seuil || (avecJuge && compte.faux >= 3);
console.log(echec ? `\nECHEC : déterministe ${reussis}/${joues.length} (seuil ${seuil})${avecJuge && compte.faux >= 3 ? ` · ${compte.faux} réponses jugées fausses` : ''}` : '\nOK');
process.exit(echec ? 1 : 0);
