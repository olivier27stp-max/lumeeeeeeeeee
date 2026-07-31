/**
 * Notification sortante des évènements de sécurité.
 *
 * POURQUOI CE FICHIER EXISTE
 * L'audit du 2026-07-31 a installé de la détection — sondes d'invariants
 * chaque nuit, télémétrie d'authentification, capture des connexions échouées.
 * Tout cela écrit dans `security_events` et `security_alerts`. Mais **rien ne
 * lisait ces tables automatiquement**.
 *
 * Une détection que personne ne regarde équivaut à pas de détection. C'était
 * le dernier maillon manquant, et le plus important : sans lui, tout le reste
 * du travail ne sert à rien le jour où quelque chose arrive vraiment.
 *
 * CE QUE ÇA FAIT
 * Toutes les 10 minutes, cherche les évènements `high`/`critical` non résolus
 * apparus depuis le dernier passage, et envoie UN courriel de synthèse à
 * SECURITY_ALERT_EMAIL. Un seul courriel par salve, pas un par évènement.
 *
 * LIMITES ASSUMÉES — première itération, à connaître avant de s'y fier
 *   * Le repère de progression est EN MÉMOIRE. Un redéploiement le remet à
 *     `maintenant - 15 min` : un évènement survenu pendant le redémarrage peut
 *     être manqué, et quelques-uns peuvent être re-notifiés. Le rendre durable
 *     demande une table dédiée — à faire quand ce mécanisme aura fait ses
 *     preuves.
 *   * Suppose une seule instance de serveur. Avec plusieurs, chacune enverrait
 *     son courriel.
 *   * Le courriel n'est pas un canal d'astreinte. Pour du vrai « on-call »,
 *     brancher un webhook Slack ou PagerDuty à la place — la fonction
 *     `envoyerAlerte` est le seul point à changer.
 */
import { getServiceClient } from './supabase';
import { sendEmail, isMailerConfigured } from './mailer';

const INTERVALLE_MS = 10 * 60_000;
const SEVERITES = ['high', 'critical'];

let depuis = new Date(Date.now() - 15 * 60_000).toISOString();
let avertiPasDeDestination = false;

type Evenement = {
  id: string;
  created_at: string;
  event_type: string;
  severity: string;
  source: string;
  org_id: string | null;
  details: unknown;
};

function corpsHtml(evts: Evenement[]): string {
  const lignes = evts.map((e) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${e.created_at.slice(0, 19).replace('T', ' ')}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;">${e.severity}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${e.event_type}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${e.source}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;">${
        String(JSON.stringify(e.details ?? {})).slice(0, 180)
      }</td>
    </tr>`).join('');

  return `
  <div style="font-family:-apple-system,sans-serif;max-width:760px;">
    <h2 style="font-size:16px;margin-bottom:4px;">Lume — ${evts.length} évènement(s) de sécurité</h2>
    <p style="font-size:13px;color:#666;margin-top:0;">
      Sévérité <strong>high</strong> ou <strong>critical</strong>, non résolus.
      Consulter <code>security_events</code> pour le détail complet.
    </p>
    <table style="border-collapse:collapse;font-size:12px;width:100%;">
      <tr style="text-align:left;background:#fafafa;">
        <th style="padding:6px 10px;">Quand (UTC)</th><th style="padding:6px 10px;">Sévérité</th>
        <th style="padding:6px 10px;">Type</th><th style="padding:6px 10px;">Source</th>
        <th style="padding:6px 10px;">Détails</th>
      </tr>
      ${lignes}
    </table>
  </div>`;
}

async function verifierUneFois(): Promise<void> {
  const destination = process.env.SECURITY_ALERT_EMAIL;

  const admin = getServiceClient();
  const borne = depuis;
  // On avance le repère AVANT l'envoi : mieux vaut manquer une notification
  // qu'entrer dans une boucle de renvoi si l'expédition échoue en continu.
  depuis = new Date().toISOString();

  const { data, error } = await admin
    .from('security_events')
    .select('id, created_at, event_type, severity, source, org_id, details')
    .in('severity', SEVERITES)
    .eq('resolved', false)
    .gt('created_at', borne)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[alerting] lecture de security_events refusée:', error.message, error.code || '');
    return;
  }
  const evts = (data || []) as Evenement[];
  if (!evts.length) return;

  // Toujours tracer dans les journaux, même sans destination : c'est le
  // filet de dernier recours, et il est gratuit.
  console.warn(`[alerting] ${evts.length} évènement(s) de sécurité high/critical depuis ${borne}`);
  for (const e of evts.slice(0, 10)) {
    console.warn(`[alerting]   ${e.created_at} ${e.severity} ${e.event_type} (${e.source})`);
  }

  if (!destination) {
    if (!avertiPasDeDestination) {
      console.error(
        '[alerting] SECURITY_ALERT_EMAIL non défini — les évènements de sécurité ne sont ' +
        'notifiés QUE dans ces journaux. Définir la variable pour recevoir les alertes.',
      );
      avertiPasDeDestination = true;
    }
    return;
  }
  if (!isMailerConfigured()) {
    console.error('[alerting] SMTP non configuré — alerte non envoyée à ' + destination);
    return;
  }

  try {
    await sendEmail({
      to: destination,
      subject: `[Lume] ${evts.length} évènement(s) de sécurité — ${evts[0].severity}`,
      html: corpsHtml(evts),
    });
  } catch (err: any) {
    console.error('[alerting] envoi du courriel échoué:', err?.message);
  }
}

/** Démarre la surveillance. Sans effet si déjà démarrée. */
export function demarrerAlertingSecurite(): void {
  if ((globalThis as any).__lumeAlertingDemarre) return;
  (globalThis as any).__lumeAlertingDemarre = true;

  const destination = process.env.SECURITY_ALERT_EMAIL;
  console.log(
    destination
      ? `[alerting] surveillance de security_events active — alertes vers ${destination}`
      : '[alerting] surveillance de security_events active — journaux seulement ' +
        '(définir SECURITY_ALERT_EMAIL pour recevoir les alertes par courriel)',
  );

  // Premier passage rapide, puis rythme de croisière.
  setTimeout(() => { void verifierUneFois(); }, 30_000);
  setInterval(() => { void verifierUneFois(); }, INTERVALLE_MS);
}
