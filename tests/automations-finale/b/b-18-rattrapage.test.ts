/**
 * B-18 — « Date atteinte » : un balayage MANQUÉ est rattrapé au passage
 * suivant, une seule fois, et seulement pour une règle qui était déjà active
 * ce jour-là.
 *
 * Avant : le balayage ne lisait que la date du jour visé. Un jour sans passage
 * (déploiement à la minute du cron, base saturée) et les rappels de ce jour
 * ne partaient jamais.
 *
 * Vrai moteur, pile locale, bureau A « (b) » en bac à sable. La colonne
 * `automation_rules.activee_le` vient de la migration proposée M-01
 * (D:/lume-final/notes/M-migrations-proposees) ; sans elle le test recule
 * `updated_at`… que la base réécrit : il exige donc la migration locale.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { attendre, marque } from '../../automations-suite/harnais/moteur';
import { preparerBureau, ok, creerClient, type Bureau } from '../../automations-suite/integration/10-b-outils';
import { regle, courriel, envoisAvec, journauxDe } from './outils-b';

let b: Bureau & { fuseau: string };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attend `attendus` envois (les écouteurs du bus ne sont pas attendus par l'émetteur), puis laisse 3 s à un éventuel envoi de trop. */
async function envoisStables(m: string, attendus: number): Promise<number> {
  await attendre(() => envoisAvec(b, m), (l) => l.length >= attendus, 30_000, 500);
  await pause(3_000);
  return (await envoisAvec(b, m)).length;
}

const jour = (decalage: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: b.fuseau }).format(new Date(Date.now() + decalage * 86_400_000));

beforeAll(async () => { b = await preparerBureau(); });

describe('B-18 — « Date atteinte » : rattrapage d’un balayage manqué', () => {
  it('[B18-10] règle active depuis 3 jours, balayage d’hier manqué : la date d’HIER part aujourd’hui, une seule fois ; celle d’il y a 3 jours, non', async () => {
    const { balayerRappelsDates } = await import('../../../server/lib/rappels-dates');
    const m = marque('B18-10');
    const champ = await ok<{ id: string }>(b.admin.from('custom_fields').insert({
      org_id: b.orgA, object_type: 'client', field_type: 'date', label: `Fin de contrat ${m}`, key: `fin_${Date.now().toString(36)}`,
    }).select('id').single(), 'champ date');
    const cHier = await creerClient(b, `${m} hier`);
    const cJour = await creerClient(b, `${m} jour`);
    const cVieux = await creerClient(b, `${m} vieux`);
    await ok(b.admin.from('custom_field_values').insert([
      { org_id: b.orgA, field_id: champ.id, object_type: 'client', client_id: cHier.id, value_date: jour(-1) },
      { org_id: b.orgA, field_id: champ.id, object_type: 'client', client_id: cJour.id, value_date: jour(0) },
      { org_id: b.orgA, field_id: champ.id, object_type: 'client', client_id: cVieux.id, value_date: jour(-3) },
    ]), 'valeurs');
    const id = await regle(b, m, { trigger_event: 'date.reached', conditions: { champ_id: champ.id, jours_avant: 0 }, actions: [courriel(m, 'Votre contrat se termine')] });
    // La règle tourne depuis 3 jours : hier, elle aurait dû voir la date d'hier.
    await ok(b.admin.from('automation_rules').update({ activee_le: new Date(Date.now() - 3 * 86_400_000).toISOString() }).eq('id', id), 'activation ancienne');

    const resume = await balayerRappelsDates(b.admin, new Date(), { orgId: b.orgA });
    expect(resume.erreurs).toBe(0);
    const premiers = await envoisAvec(b, m);
    const n = await envoisStables(m, 2);
    expect(n, `envois : ${premiers.map((e) => e.destinataire).join(', ')}`).toBe(2);
    // L'événement de la date d'hier dit qu'il vient d'un rattrapage (les autres règles du bureau ne comptent pas ici).
    const emis = await ok<Array<{ entity_id: string; metadata: Record<string, unknown> }>>(
      b.admin.from('activity_log').select('entity_id, metadata').eq('org_id', b.orgA).eq('event_type', 'date_reached').eq('metadata->>rule_id', id), 'événements');
    expect(emis.map((e) => e.entity_id).sort()).toEqual([cHier.id, cJour.id].sort());
    expect(emis.find((e) => e.entity_id === cHier.id)?.metadata.rattrapage_jours).toBe(1);
    expect(emis.find((e) => e.entity_id === cJour.id)?.metadata.rattrapage_jours).toBeUndefined();

    // Une heure plus tard (filet horaire du tick, puis le cron) : rien ne repart, même hors de la
    // fenêtre anti-doublon de 2 min du moteur — on recule ses lignes de journal de 10 min.
    const lignes = await journauxDe(b, id);
    for (const [i, l] of lignes.entries()) {
      await ok(b.admin.from('automation_execution_logs').update({
        created_at: new Date(Date.parse(l.created_at) - 10 * 60_000).toISOString(),
        execution_key: `${id}:${l.entity_id}:0@vieilli${i}`,
      }).eq('id', l.id), 'vieillir');
    }
    for (let i = 0; i < 2; i++) {
      const rejeu = await balayerRappelsDates(b.admin, new Date(), { orgId: b.orgA });
      expect(rejeu.erreurs).toBe(0);
      void rejeu.emis; // (d’autres règles « date atteinte » du bureau peuvent émettre : on compte NOS envois ci-dessous)
    }
    await pause(3_000);
    expect((await envoisAvec(b, m)).length).toBe(2);
  });

  it('[B18-11] bureau en pause (« Tout arrêter ») le jour J : rien n’est émis ni marqué ; à la reprise, la date est rattrapée', async () => {
    const { balayerRappelsDates } = await import('../../../server/lib/rappels-dates');
    const { viderCachePause } = await import('../../../server/lib/automations-pause-org');
    const m = marque('B18-11');
    const champ = await ok<{ id: string }>(b.admin.from('custom_fields').insert({
      org_id: b.orgA, object_type: 'client', field_type: 'date', label: `Garantie ${m}`, key: `gar_${Date.now().toString(36)}`,
    }).select('id').single(), 'champ date');
    const c = await creerClient(b, m);
    await ok(b.admin.from('custom_field_values').insert({ org_id: b.orgA, field_id: champ.id, object_type: 'client', client_id: c.id, value_date: jour(0) }), 'valeur');
    await regle(b, m, { trigger_event: 'date.reached', conditions: { champ_id: champ.id, jours_avant: 0 }, actions: [courriel(m, 'Votre garantie se termine')] });
    try {
      await ok(b.admin.from('company_settings').update({ automations_paused: true }).eq('org_id', b.orgA), 'pause');
      viderCachePause();
      const enPause = await balayerRappelsDates(b.admin, new Date(), { orgId: b.orgA });
      expect(enPause.emis).toBe(0);
    } finally {
      await ok(b.admin.from('company_settings').update({ automations_paused: false }).eq('org_id', b.orgA), 'reprise');
      viderCachePause();
    }
    await balayerRappelsDates(b.admin, new Date(), { orgId: b.orgA });
    expect(await envoisStables(m, 1)).toBe(1);
  });
});
