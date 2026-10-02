/**
 * Bug n° 1 de la mission (deux copies du message dans une même règle), côté
 * MOTEUR : une règle convertie en parcours porte `steps` (ce que l'éditeur
 * écrit) et une ancienne copie `actions`. L'utilisateur supprime la dernière
 * étape de son parcours → `steps = []`, `actions` garde l'ancien message, et
 * la règle reste publiée. Que fait le moteur ?
 *
 * Attendu : dès que `steps` est un TABLEAU (même vide), la règle est un
 * parcours et `actions` n'est jamais lu. Vrai moteur, pile locale, bureau A
 * « (b) » en bac à sable.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { attendre, marque } from '../../automations-suite/harnais/moteur';
import { preparerBureau, creerClient, type Bureau } from '../../automations-suite/integration/10-b-outils';
import { regle, texto, emettre, attendreTaches, avancer, tachesDe, journauxDe, envoisAvec } from './outils-b';

let b: Bureau & { fuseau: string };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TOUT_LE_JOUR = { fenetre: { debut: 0, fin: 24 } };

beforeAll(async () => { b = await preparerBureau(); });

describe('parcours vidé de sa dernière étape : l’ancien message resté dans `actions` ne part pas', () => {
  it('[M1-01] règle publiée, `steps = []`, `actions = [texto « ancien »]` : l’événement n’envoie RIEN, rien n’est planifié, le journal dit « parcours vide »', async () => {
    const m = marque('M1-01');
    const c = await creerClient(b, m, { phone: '+12045559141' });
    const id = await regle(b, m, { trigger_event: 'note.added', actions: [texto(m, 'ANCIEN message supprimé')], steps: [], settings: TOUT_LE_JOUR });
    await emettre(b, 'note.added', 'client', c.id);
    await pause(3_000);
    expect((await envoisAvec(b, m)).length, 'l’ancien message est parti').toBe(0);
    expect(await tachesDe(b, id)).toHaveLength(0);
    const lignes = await journauxDe(b, id);
    expect(lignes.map((l) => l.result_data?.saute_code)).toEqual(['parcours_vide']);
    expect(lignes[0].result_success).toBe(true);
  });

  it('[M1-02] l’autre sens : la même règle jamais convertie (`steps = null`) envoie bien son message', async () => {
    const m = marque('M1-02');
    const c = await creerClient(b, m, { phone: '+12045559142' });
    await regle(b, m, { trigger_event: 'note.added', actions: [texto(m, 'Message à plat')], steps: null, settings: TOUT_LE_JOUR });
    await emettre(b, 'note.added', 'client', c.id);
    const envois = await attendre(() => envoisAvec(b, m), (l) => l.length >= 1, 20_000);
    expect(envois).toHaveLength(1);
    expect(String(envois[0].corps)).toContain('Message à plat');
  });

  it('[M1-03] parcours NON vide + ancienne copie `actions` : seul le message du parcours part', async () => {
    const m = marque('M1-03');
    const c = await creerClient(b, m, { phone: '+12045559143' });
    const nouveau = texto(m, 'NOUVEAU message du parcours');
    const id = await regle(b, m, {
      trigger_event: 'note.added', actions: [texto(m, 'ANCIEN message')], settings: TOUT_LE_JOUR,
      steps: [{ id: 'm1', type: 'action', action: nouveau, suivant: null }],
    });
    await emettre(b, 'note.added', 'client', c.id);
    await attendreTaches(b, id, 1);
    await avancer(b, id);
    const envois = await attendre(() => envoisAvec(b, m), (l) => l.length >= 1, 20_000);
    expect(envois.map((e) => String(e.corps))).toEqual([expect.stringContaining('NOUVEAU message du parcours')]);
  });

  it('[M1-04] une relance « à plat » déjà en file, puis la règle est convertie et vidée : à l’échéance elle est annulée (« étape retirée »), rien ne part', async () => {
    const m = marque('M1-04');
    const c = await creerClient(b, m, { phone: '+12045559144' });
    const id = await regle(b, m, { trigger_event: 'note.added', delay_seconds: 86_400, actions: [texto(m, 'ANCIENNE relance')], steps: null, settings: TOUT_LE_JOUR });
    await emettre(b, 'note.added', 'client', c.id);
    await attendreTaches(b, id, 1);
    // L'utilisateur convertit la règle en parcours dans l'éditeur, puis supprime sa dernière étape.
    const { error } = await b.admin.from('automation_rules').update({ steps: [] }).eq('id', id);
    expect(error).toBeNull();
    await avancer(b, id);
    expect((await envoisAvec(b, m)).length).toBe(0);
    const [t] = await tachesDe(b, id);
    expect(t.status).toBe('cancelled');
    expect(t.action_config.motif_code).toBe('etape_retiree');
    const lignes = await journauxDe(b, id);
    expect(lignes.filter((l) => l.result_data?.saute_code === 'etape_retiree')).toHaveLength(1);
  });
});
