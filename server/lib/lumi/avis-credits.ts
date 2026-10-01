/**
 * Avertir le PROPRIÉTAIRE quand ses crédits Lumi passent 80 % puis 100 %
 * (demande de Rafba, 2026-09-30).
 *
 * Courriel + notification dans la cloche, en CRÉDITS seulement (jamais un
 * montant en $), avec la vraie date de renouvellement. Un seul envoi par
 * seuil et par période pour tout le groupe d'entreprises (le pool est
 * partagé) : la table `lumi_credits_avis` (clé primaire) tranche, même si
 * plusieurs requêtes franchissent le seuil au même instant.
 *
 * Ne lève jamais : un avertissement raté ne doit pas faire échouer Lumi.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EtatCredits } from './credits';
import { dateRenouvellement } from './budget';
import { companyOrgIds } from '../supabase';
import { sendEmail, isMailerConfigured } from '../mailer';
import { rendreCourrielLume } from '../courriels/gabarit';
import { urlApplication } from '../helpers';
import { insertTargetedNotifications } from '../notificationHelpers';

type Langue = 'fr' | 'en';

const nombre = (n: number, l: Langue) => new Intl.NumberFormat(l === 'fr' ? 'fr-CA' : 'en-CA').format(n);

/** Les textes, en crédits seulement. Pur : testé tel quel. */
export function textesAvis(seuil: 80 | 100, e: EtatCredits, l: Langue) {
  const quand = e.renouvellement_le ? dateRenouvellement(l, e.renouvellement_le) : '';
  if (seuil === 100) {
    return l === 'fr'
      ? {
        sujet: 'Tes crédits Lumi sont épuisés',
        titre: 'Crédits Lumi épuisés',
        intro: `Ton entreprise a utilisé ses ${nombre(e.total, l)} crédits Lumi de la période. L’assistant IA avancé est en pause jusqu’au ${quand}, date où tes crédits se renouvellent.`,
        note: 'Les actions rapides et tout le reste de Lume continuent de fonctionner normalement.',
        notif: `Crédits Lumi épuisés jusqu’au ${quand}.`,
      }
      : {
        sujet: 'Your Lumi credits are used up',
        titre: 'Lumi credits used up',
        intro: `Your company has used its ${nombre(e.total, l)} Lumi credits for this period. The advanced AI assistant is paused until ${quand}, when your credits renew.`,
        note: 'Quick actions and everything else in Lume keep working normally.',
        notif: `Lumi credits used up until ${quand}.`,
      };
  }
  return l === 'fr'
    ? {
      sujet: `Il te reste ${nombre(e.restants, l)} crédits Lumi`,
      titre: 'Tu as utilisé 80 % de tes crédits Lumi',
      intro: `Il te reste ${nombre(e.restants, l)} crédits Lumi sur ${nombre(e.total, l)} jusqu’au ${quand}, date où ils se renouvellent.`,
      note: 'À l’épuisement, l’assistant avancé se met en pause jusqu’au renouvellement ; le reste de Lume fonctionne normalement.',
      notif: `Il te reste ${nombre(e.restants, l)} crédits Lumi jusqu’au ${quand}.`,
    }
    : {
      sujet: `You have ${nombre(e.restants, l)} Lumi credits left`,
      titre: 'You have used 80% of your Lumi credits',
      intro: `You have ${nombre(e.restants, l)} of ${nombre(e.total, l)} Lumi credits left until ${quand}, when they renew.`,
      note: 'When they run out, the advanced assistant pauses until renewal; the rest of Lume keeps working normally.',
      notif: `You have ${nombre(e.restants, l)} Lumi credits left until ${quand}.`,
    };
}

export async function avertirSiSeuilCredits(
  admin: SupabaseClient,
  orgId: string,
  e: EtatCredits,
  envoyer: typeof sendEmail = sendEmail,
): Promise<void> {
  try {
    if (!e.inclus || !e.avertissement) return;
    const seuil: 80 | 100 = e.avertissement === '100' ? 100 : 80;

    const { data: org } = await admin.from('orgs').select('company_group_id').eq('id', orgId).maybeSingle();
    const groupe = String((org as { company_group_id?: string | null } | null)?.company_group_id || orgId);
    const { data: periode, error: ePer } = await admin.rpc('lumi_periode_courante', { p_org: orgId });
    if (ePer || !periode) return;

    // Qui envoie : celui dont l'insertion passe (clé primaire groupe + période + seuil).
    const { data: reserve, error: eIns } = await admin.from('lumi_credits_avis')
      .upsert({ company_group_id: groupe, periode: String(periode), seuil }, { onConflict: 'company_group_id,periode,seuil', ignoreDuplicates: true })
      .select('seuil');
    if (eIns) { console.error('[lumi/avis-credits] réservation impossible :', eIns.message); return; }
    if (!reserve || reserve.length === 0) return; // déjà averti pour ce seuil et cette période

    // Les propriétaires actifs du groupe, chacun dans sa langue.
    const orgIds = await companyOrgIds(admin, orgId);
    const { data: membres } = await admin.from('memberships')
      .select('user_id, role, status, language, org_id').in('org_id', orgIds).eq('role', 'owner');
    const proprios = new Map<string, Langue>();
    for (const m of (membres ?? []) as Array<{ user_id: string | null; status: string | null; language: string | null }>) {
      if (!m.user_id || (m.status && m.status !== 'active')) continue;
      proprios.set(m.user_id, m.language === 'en' ? 'en' : 'fr');
    }
    if (proprios.size === 0) return;

    const lien = `${urlApplication()}/settings/billing`;
    if (isMailerConfigured()) {
      for (const [userId, langue] of proprios) {
        const { data: u } = await admin.auth.admin.getUserById(userId);
        const courriel = u?.user?.email;
        if (!courriel) continue;
        const t = textesAvis(seuil, e, langue);
        await envoyer({
          to: courriel,
          subject: t.sujet,
          html: rendreCourrielLume({
            langue, titre: t.titre, preheader: t.intro, intro: t.intro, note: t.note,
            bouton: { texte: langue === 'fr' ? 'Voir mes crédits Lumi' : 'See my Lumi credits', url: lien },
          }),
        }).catch((err: unknown) => console.error('[lumi/avis-credits] courriel non envoyé :', err instanceof Error ? err.message : err));
      }
    }
    await insertTargetedNotifications(admin, orgId, proprios, (langue) => {
      const t = textesAvis(seuil, e, langue);
      return { title: t.titre, body: t.notif };
    }, { type: 'lumi_credits', link: '/settings/billing', icon: 'sparkles' });
  } catch (err: unknown) {
    console.error('[lumi/avis-credits]', err instanceof Error ? err.message : err);
  }
}
