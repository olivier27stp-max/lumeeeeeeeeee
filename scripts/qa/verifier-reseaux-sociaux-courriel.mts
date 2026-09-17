/**
 * verifier-reseaux-sociaux-courriel.mts — les liens réseaux sociaux
 * arrivent bien (1) au bas des courriels sortants et (2) sur la page de
 * paiement publique.
 *
 *   npx tsx --env-file=.env.local scripts/qa/verifier-reseaux-sociaux-courriel.mts
 *
 * Écrit sur l'org QA (staging seulement), crée un lien de paiement jetable
 * et remet tout en place à la fin. Le serveur Express doit tourner
 * (API_URL, défaut http://localhost:3002).
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { getCompanySettings, buildEmailLayout } from '../../server/routes/emails';

const URL_SB = process.env.VITE_SUPABASE_URL as string;
const API = (process.env.API_URL || 'http://localhost:3002').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
if (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  console.error('REFUS : ce banc écrit des réglages. La cible est la PRODUCTION.'); process.exit(2);
}
const admin = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } });
const resultats: boolean[] = [];
const ok = (nom: string, vrai: unknown, detail = '') => { resultats.push(!!vrai); console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`); return !!vrai; };

// generateLink renvoie l'utilisateur sans paginer listUsers.
const { data: lien, error: eLien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const user = lien?.user;
if (!user) throw new Error(`compte ${COMPTE} introuvable : ${eLien?.message}`);
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', user.id).eq('status', 'active').limit(1).maybeSingle();
const orgId = m!.org_id as string;
const { data: avant } = await admin.from('company_settings').select('id, social_links').eq('org_id', orgId).maybeSingle();
const LIENS = { facebook: 'https://www.facebook.com/visionlavage', instagram: 'https://www.instagram.com/visionlavage/', yelp: 'https://www.yelp.ca/biz/visionlavage' };
let prId: string | null = null;

try {
  await admin.from('company_settings').update({ social_links: LIENS }).eq('id', avant!.id);

  console.log('\n1. Pied de courriel');
  const company = await getCompanySettings(orgId);
  ok('getCompanySettings renvoie les liens', JSON.stringify(company.social_links) === JSON.stringify(LIENS), JSON.stringify(company.social_links));
  const html = buildEmailLayout(company, '<p>Bonjour</p>');
  ok('le HTML contient le lien Instagram', html.includes('href="https://www.instagram.com/visionlavage/"'));
  ok('les libellés Facebook · Instagram · Yelp sont là, dans cet ordre', /Facebook[\s\S]*Instagram[\s\S]*Yelp/.test(html));
  ok('X et Angi (vides) n’apparaissent pas', !/>X<|>Angi</.test(html));
  const sansLiens = buildEmailLayout({ ...company, social_links: {} }, '<p>Bonjour</p>');
  ok('sans liens : aucune rangée ajoutée', !sansLiens.includes('Facebook'));

  console.log('\n2. Page de paiement publique (GET /api/pay/:token)');
  const { data: inv } = await admin.from('invoices').select('id, balance_cents, currency, client_id')
    .eq('org_id', orgId).is('deleted_at', null).gt('balance_cents', 0).not('client_id', 'is', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!inv) {
    ok('une facture avec solde existe sur l’org', false);
  } else {
    const token = randomBytes(24).toString('hex');
    const { data: pr, error } = await admin.from('payment_requests')
      .insert({ org_id: orgId, invoice_id: inv.id, public_token: token, amount_cents: inv.balance_cents, currency: inv.currency || 'CAD', status: 'pending' })
      .select('id').single();
    if (!ok('lien de paiement jetable créé', !error && pr, error?.message)) throw new Error('stop');
    prId = pr!.id;
    const rep = await fetch(`${API}/api/pay/${token}`);
    const corps: any = await rep.json();
    ok('la route répond 200', rep.status === 200, `${rep.status} ${corps?.error || ''}`);
    ok('business.social_links contient les 3 liens', JSON.stringify(corps?.business?.social_links) === JSON.stringify(LIENS), JSON.stringify(corps?.business?.social_links));
  }
} finally {
  if (prId) await admin.from('payment_requests').delete().eq('id', prId);
  await admin.from('company_settings').update({ social_links: avant?.social_links ?? {} }).eq('id', avant!.id);
  console.log(`\nRemis en place : social_links=${JSON.stringify(avant?.social_links)}${prId ? ', lien de paiement jetable supprimé' : ''}`);
}
const echecs = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passent`);
process.exit(echecs ? 1 : 0);
