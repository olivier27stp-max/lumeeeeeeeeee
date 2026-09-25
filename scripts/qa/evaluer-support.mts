/**
 * QA — le même Lumi partout, au courant de tout (staging).
 *
 *   node --env-file=.env.local --import tsx scripts/qa/evaluer-support.mts
 *
 * Construit le dossier du compte QA (willhebert30 / org de test), puis pose
 * au cerveau de support des questions dont la réponse DOIT venir du dossier
 * ou des outils, sur les trois surfaces. Vérifie : pas de transfert quand le
 * dossier répond ; transfert sur un bug ; surface publique sans dossier ;
 * start_migration crée une migration autonome + lien (puis l'annule).
 * Coût affiché à la fin (mesuré, jamais estimé).
 */
import { createClient } from '@supabase/supabase-js';
import { dossierClient } from '../../server/lib/support/dossier';
import { repondreSupportIA } from '../../server/lib/support/ia';
import { statutMigrationPour, demarrerMigrationPour } from '../../server/lib/support/migration-outils';
import { contexteOrg, slaTexte } from '../../server/lib/support/tickets';

const url = process.env.VITE_SUPABASE_URL!;
const ref = process.env.SUPABASE_PROJECT_REF!;
if (!url.includes(ref) || ref === 'bbzcuzqfgsdvjsymfwmr') throw new Error('QA sur staging seulement');
// Jamais de Slack depuis la QA : .env.local porte les vraies clés Slack, et start_migration a déjà envoyé une notification « Vision Lavage démarre une migration » au vrai canal (2026-09-17).
delete process.env.SLACK_BOT_TOKEN;
delete process.env.SLACK_SIGNING_SECRET;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const email = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const { data: lien, error: eLien } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
if (eLien || !lien?.user) throw new Error(`compte QA introuvable : ${eLien?.message}`);
const user = lien.user;
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', user.id).eq('status', 'active').limit(1).maybeSingle();
const orgId = m!.org_id as string;

const t0 = Date.now();
const dossier = await dossierClient(admin, orgId, user.id);
console.log(`── dossier (${Date.now() - t0} ms) ──\n${dossier.texte}\n`);
const ctx = await contexteOrg(admin, orgId, user);
const base = { langue: ctx.langue, companyName: ctx.companyName, planLabel: ctx.planLabel, userName: ctx.userName, slaTexte: slaTexte(ctx.slaKey, ctx.langue) };

const fautes: string[] = [];
let cout = 0;
let migrationCreee: string | null = null;
const outils = {
  statutMigration: () => statutMigrationPour(admin, orgId),
  demarrerMigration: async ({ sourceCrm }: { sourceCrm: string }) => {
    const r = await demarrerMigrationPour(admin, { orgId, userId: user.id, userEmail: user.email ?? null, companyName: ctx.companyName, sourceCrm });
    if (r.ok) {
      const { data } = await admin.from('data_migrations').select('id').eq('org_id', orgId).eq('status', 'invitation_sent').order('created_at', { ascending: false }).limit(1).maybeSingle();
      migrationCreee = data?.id ?? null;
    }
    return r;
  },
};

async function cas(nom: string, surface: 'app' | 'migration_portal' | 'public', question: string, attendu: { transfert: boolean | 'tolere'; contient?: RegExp; outil?: string }) {
  const r = await repondreSupportIA(surface === 'public' ? { ...base, companyName: '', planLabel: '', userName: 'visiteur', slaTexte: '', surface, dossier: null } : { ...base, surface, dossier: dossier.texte }, [], question, surface === 'public' ? {} : outils);
  cout += r.coutCents;
  const ok = (attendu.transfert === 'tolere' || r.transferer === attendu.transfert) && (!attendu.contient || attendu.contient.test(r.texte)) && (!attendu.outil || r.outils.includes(attendu.outil));
  console.log(`${ok ? 'OK ' : 'KO '} [${surface}] ${nom}\n     Q : ${question}\n     R : ${r.texte.replace(/\n/g, ' / ').slice(0, 300)}\n     transfert=${r.transferer}${r.motif ? ` (${r.motif})` : ''} · outils=${r.outils.join(',') || '—'} · ${r.coutCents.toFixed(2)} ¢`);
  if (!ok) fautes.push(nom);
}

try {
  // Sur staging, l'org QA peut ne pas avoir d'abonnement : la bonne réponse est alors « aucun abonnement » (transfert toléré), jamais un forfait inventé.
  const sansAbonnement = /aucun abonnement/i.test(dossier.texte);
  await cas('forfait depuis le dossier', 'app', 'Je suis sur quel forfait, et il se renouvelle quand ?', sansAbonnement ? { transfert: 'tolere', contient: /abonnement/i } : { transfert: false, contient: new RegExp(ctx.planLabel, 'i') });
  await cas('paiements depuis le dossier', 'app', 'Est-ce que mes paiements en ligne sont configurés ?', { transfert: false });
  await cas('migration : statut (outil)', 'app', 'Où en est ma migration de données ?', { transfert: false });
  await cas('bug → humain', 'app', 'Quand je clique sur Envoyer la facture, ça affiche une erreur 500.', { transfert: true });
  // Un « comment faire » banal hors FAQ ne part JAMAIS tout seul chez l'équipe (incident du 2026-09-15 : « supprimer des tâches » escaladé).
  await cas('comment faire hors FAQ → Lumi répond, pas de transfert', 'app', 'comment je fais pour supprimer des taches', { transfert: false, contient: /tâche|travaux|Tâches/i });
  await cas('comment faire hors FAQ (2) → pas de transfert', 'app', 'je veux archiver un client qui a fermé', { transfert: false });
  await cas('hors Lume → pas de transfert', 'app', 'Est-ce que je dois charger la TVQ à un client de l’Ontario ?', { transfert: false });
  await cas('« ça n’a pas marché, quelqu’un ? » → humain', 'app', 'Non ça marche pas votre affaire, je veux parler à quelqu’un.', { transfert: true });
  await cas('portail : question de migration', 'migration_portal', 'Est-ce que vous avez besoin de quelque chose de moi pour la migration ?', { transfert: false });
  await cas('public : prix, sans compte', 'public', 'C’est combien par mois ?', { transfert: false, contient: /150|340|495/ });
  await cas('public : client existant renvoyé au chat de l’app', 'public', 'Je suis déjà client et ma facture est fausse, tu peux la corriger ?', { transfert: false, contient: /connect|Aide|chat/i });
  await cas('démarrer une migration (outil)', 'app', 'Je veux transférer mes clients et mes jobs depuis Jobber dans Lume.', { transfert: false, outil: 'start_migration', contient: /migration\/invite\//i });
  if (!migrationCreee) fautes.push('aucune migration créée par start_migration');
  else {
    const { data: mig } = await admin.from('data_migrations').select('status, bot_mode, bot_actif, source_crm').eq('id', migrationCreee).single();
    console.log(`migration créée : ${JSON.stringify(mig)}`);
    if (mig?.status !== 'invitation_sent' || mig?.bot_mode !== 'autonome' || !mig?.bot_actif) fautes.push('migration créée sans le bon état (invitation_sent / autonome / bot actif)');
    await cas('seconde demande → pas de doublon', 'app', 'Peux-tu démarrer une migration depuis Jobber ?', { transfert: false });
    const { count } = await admin.from('data_migrations').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null).eq('status', 'invitation_sent');
    if ((count ?? 0) > 1) fautes.push(`${count} migrations en invitation_sent : doublon`);
  }
} finally {
  if (migrationCreee) {
    await admin.from('data_migrations').update({ status: 'cancelled', deleted_at: new Date().toISOString() }).eq('id', migrationCreee);
    await admin.from('notifications').update({ deleted_at: new Date().toISOString(), is_read: true }).eq('type', 'migration_bot').eq('link', `/admin/migrations#${migrationCreee}`);
    console.log('migration QA annulée + supprimée (soft)');
  }
}
console.log(`\ncoût total : ${cout.toFixed(2)} ¢ pour 13 tours`);
console.log(fautes.length ? `\nECHEC : ${fautes.join(' ; ')}` : '\nOK : le même Lumi répond depuis le dossier, transfère les bugs, ignore les comptes en public, démarre une migration autonome.');
process.exit(fautes.length ? 1 : 0);
