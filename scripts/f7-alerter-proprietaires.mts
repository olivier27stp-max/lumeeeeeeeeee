/**
 * F7 — prévenir les propriétaires dont les automatisations ont été coupées.
 * ─────────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local --import tsx scripts/f7-alerter-proprietaires.mts [--prod] [--envoyer] [--clore "motif"]
 *
 * La migration `20260919100000_f7_desactiver_sollicitation.sql` a désactivé
 * 5 automatisations de sollicitation par organisation et laissé une trace par
 * org dans `security_events` (`automations_sollicitation_desactivee`,
 * `resolved = false`). Son commentaire le disait : « la trace sert à prévenir
 * chaque propriétaire ». Ce courriel n'était jamais parti.
 *
 * Par défaut le script ne fait RIEN d'autre qu'afficher : qui serait prévenu,
 * à quelle adresse, pour combien de règles. C'est volontaire — une alerte
 * réglementaire envoyée au mauvais destinataire est pire que pas d'alerte.
 *
 *   (aucun drapeau)   simulation : lit et affiche, n'écrit rien
 *   --envoyer         envoie le courriel au propriétaire de chaque org
 *   --clore "motif"   marque les traces résolues, avec la raison
 *
 * Les deux derniers sont indépendants : on peut clore sans envoyer (cas où
 * aucune org touchée n'est un vrai client), ou envoyer sans clore.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { rendreCourrielLume } from '../server/lib/courriels/gabarit';
import { sendEmail } from '../server/lib/mailer';

const args = process.argv.slice(2);
const prod = args.includes('--prod');
const envoyer = args.includes('--envoyer');
const iClore = args.indexOf('--clore');
const clore = iClore >= 0;
const motifCloture = clore ? (args[iClore + 1] ?? '').trim() : '';

if (clore && !motifCloture) {
  console.error('--clore exige un motif : --clore "raison de la clôture"');
  process.exitCode = 1;
}

const url = prod ? process.env.SUPABASE_URL_PROD : process.env.VITE_SUPABASE_URL;
const cle = prod ? process.env.SUPABASE_SERVICE_ROLE_KEY_PROD : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !cle) throw new Error(prod ? 'SUPABASE_URL_PROD / SUPABASE_SERVICE_ROLE_KEY_PROD manquants' : 'VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants');
const admin: SupabaseClient = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });

interface Trace {
  id: string;
  org_id: string;
  created_at: string;
  details: { motif?: string; nombre?: number; regles?: Array<{ preset_key: string; nom: string }> } | null;
}

const { data, error } = await admin
  .from('security_events')
  .select('id, org_id, created_at, details')
  .eq('event_type', 'automations_sollicitation_desactivee')
  .eq('resolved', false)
  .order('created_at', { ascending: true });
if (error) throw new Error(`security_events: ${error.message}`);
const traces = (data ?? []) as Trace[];

console.log(`\n═══ F7 · ${prod ? 'PRODUCTION' : 'staging'} ═══\n`);
console.log(`${traces.length} trace(s) non résolue(s).`);
if (!traces.length) console.log('Rien à faire.\n');

/**
 * L'adresse du responsable : celle de l'entreprise d'abord (c'est la boîte
 * qu'on surveille), sinon celle du propriétaire du compte.
 * Patron repris de `server/lib/subscription-email.ts`.
 */
async function destinataireDe(orgId: string): Promise<{ email: string; langue: 'fr' | 'en'; nomOrg: string }> {
  const { data: org } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle();
  const nomOrg = (org?.name ?? '').trim() || '(sans nom)';
  const { data: cs } = await admin.from('company_settings').select('email').eq('org_id', orgId).maybeSingle();
  let email = (cs?.email ?? '').trim();
  let langue: 'fr' | 'en' = 'fr';
  const { data: membre } = await admin
    .from('memberships').select('user_id, language')
    .eq('org_id', orgId).eq('role', 'owner').limit(1).maybeSingle();
  if (membre?.language === 'en') langue = 'en';
  if (!email && membre?.user_id) {
    const { data: u } = await admin.auth.admin.getUserById(membre.user_id);
    email = (u?.user?.email ?? '').trim();
  }
  return { email, langue, nomOrg };
}

function courriel(nomOrg: string, regles: Array<{ nom: string }>, langue: 'fr' | 'en') {
  const liste = regles.map((r) => `<li style="margin:4px 0;">${r.nom}</li>`).join('');
  const fr = langue === 'fr';
  return {
    sujet: fr
      ? `${regles.length} automatisation${regles.length > 1 ? 's' : ''} mise${regles.length > 1 ? 's' : ''} en pause — consentement requis`
      : `${regles.length} automation${regles.length > 1 ? 's' : ''} paused — consent required`,
    html: rendreCourrielLume({
      langue,
      preheader: fr
        ? 'Elles repartiront dès que le consentement de tes clients sera enregistré.'
        : 'They resume as soon as your clients\' consent is recorded.',
      titre: fr ? 'Des automatisations sont en pause' : 'Some automations are paused',
      intro: fr
        ? `Chez ${nomOrg}, ces automatisations envoyaient des offres commerciales sans vérifier le consentement des destinataires. Au Canada, la loi anti-pourriel l'exige, et l'amende vise l'entreprise qui envoie. On les a mises en pause plutôt que de te laisser exposé.`
        : `At ${nomOrg}, these automations were sending commercial offers without checking recipient consent. Canadian anti-spam law requires it, and the fine targets the sending business. We paused them rather than leave you exposed.`,
      corpsHtml: `<ul style="margin:0;padding-left:20px;font-size:14px;color:#374151;">${liste}</ul>`,
      note: fr
        ? "Rien d'autre n'a changé : factures, devis, confirmations et rappels de rendez-vous partent normalement. Sur la fiche d'un client, la carte « Consentement commercial » montre maintenant où il en est — et un client avec qui tu as fait affaire dans les 2 dernières années est déjà couvert, sans rien saisir."
        : 'Nothing else changed: invoices, quotes, confirmations and appointment reminders go out as usual. On a client\'s page, the "Commercial consent" card now shows where they stand — and a client you did business with in the last 2 years is already covered, with nothing to enter.',
      signature: null,
    }),
  };
}

for (const t of traces) {
  const { email, langue, nomOrg } = await destinataireDe(t.org_id);
  const regles = t.details?.regles ?? [];
  const nombre = t.details?.nombre ?? regles.length;
  console.log(`\n· ${nomOrg}`);
  console.log(`  trace du ${t.created_at.slice(0, 10)} — ${nombre} règle(s) : ${regles.map((r) => r.nom).join(', ') || '—'}`);
  console.log(`  destinataire : ${email || 'AUCUN COURRIEL JOIGNABLE'}`);

  if (envoyer) {
    if (!email) {
      console.log('  → non envoyé : aucune adresse.');
    } else {
      const { sujet, html } = courriel(nomOrg, regles, langue);
      const r = await sendEmail({ to: email, subject: sujet, html, suivi: { orgId: t.org_id, entityType: 'f7_consentement', entityId: t.id } });
      console.log(r.sent ? '  → envoyé.' : `  → ÉCHEC : ${r.error}`);
    }
  }

  if (clore && motifCloture) {
    // `resolved_by` porte une FK vers auth.users : sans utilisateur humain
    // derrière, on laisse NULL et le motif vit dans `details`.
    const { error: e } = await admin
      .from('security_events')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        details: { ...(t.details ?? {}), cloture_motif: motifCloture, cloture_le: new Date().toISOString() },
      })
      .eq('id', t.id);
    console.log(e ? `  → clôture ÉCHOUÉE : ${e.message}` : '  → trace close.');
  }
}

if (traces.length && !envoyer && !clore) {
  console.log('\nRien n\'a été écrit ni envoyé. Ajoute --envoyer et/ou --clore "motif".');
}
console.log('');
