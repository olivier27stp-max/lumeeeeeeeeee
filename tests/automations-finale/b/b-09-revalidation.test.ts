/**
 * Point 9 (revalidation avant chaque étape différée) et point 13 (entité
 * modifiée ou supprimée en cours de route) — ce que fait le moteur AUJOURD'HUI.
 *
 * Pour chaque cas : une règle publiée « message au client après 1 jour », un
 * vrai événement sur le bus, la situation change pendant l'attente, puis le
 * délai s'écoule (la file avance). Attendu par la mission : RIEN ne part, la
 * tâche est annulée, et la raison dit ce qui s'est passé.
 *
 * Drapeau `auto_sortie_parcours` ÉTEINT, comme dans les vraies entreprises
 * (AUTOMATIONS_TEST_REPORT.md, « Risques restants »).
 *
 * Les cas sont joués une fois (beforeAll) et consignés dans
 * D:/lume-final/sorties/b/b-09-revalidation.json ; chaque `it` affirme un cas.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { marque } from '../../automations-suite/harnais/moteur';
import {
  preparerBureau, ok, creerClient, creerDevis, creerJob, creerDeal, pipelineParDefaut, drapeau, type Bureau,
} from '../../automations-suite/integration/10-b-outils';
import {
  regle, courriel, emettre, attendreTaches, avancer, tachesDe, journauxDe, envoisAvec, factureEnRetard, payer, MOTIF_GENERIQUE,
} from './outils-b';

let b: Bureau & { fuseau: string };

interface Resultat {
  id: string; titre: string; declencheur: string; forme: string;
  envois: number; statuts: string[]; motifs: Array<string | null>; sauts: string[]; erreur?: string;
}
const resultats = new Map<string, Resultat>();

interface Cas {
  id: string;
  titre: string;
  declencheur: string;
  /** Crée l'entité ; rend de quoi émettre l'événement et de quoi changer la situation. */
  preparer: (m: string) => Promise<{
    entityType: string; entityId: string; metadata?: Record<string, unknown>; conditions?: Record<string, unknown>;
    changer: () => Promise<void>;
  }>;
}

const UN_JOUR = 86_400;

async function visite(m: string, jobId: string) {
  const debut = new Date(Date.now() + 5 * 86_400_000);
  return ok<{ id: string }>(b.admin.from('schedule_events').insert({
    org_id: b.orgA, job_id: jobId, title: `Visite ${m}`, status: 'scheduled', created_by: b.users.proprioA,
    start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString(),
  }).select('id').single(), 'visite');
}

const CAS: Cas[] = [
  {
    id: 'B9-01', titre: 'facture PAYÉE pendant le délai', declencheur: 'invoice.overdue',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const f = await factureEnRetard(b, m, c.id, 1, b.fuseau);
      return { entityType: 'invoice', entityId: f.id, metadata: { days_overdue: 1, invoice_number: f.invoice_number }, changer: () => payer(b, f.id, c.id, f.total_cents) };
    },
  },
  {
    id: 'B9-02', titre: 'facture ANNULÉE (void) pendant le délai', declencheur: 'invoice.overdue',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const f = await factureEnRetard(b, m, c.id, 1, b.fuseau);
      return { entityType: 'invoice', entityId: f.id, metadata: { days_overdue: 1 }, changer: async () => { await ok(b.admin.from('invoices').update({ status: 'void' }).eq('id', f.id), 'void'); } };
    },
  },
  // (B9-03 retiré : une facture ÉMISE ne peut pas revenir en brouillon — le trigger de la base re-dérive le
  //  statut « sent » et l'outil revert_invoice_to_draft le refuse. Le cas de la mission ne peut pas se produire.)
  // (B9-04 retiré : repousser l'échéance d'une facture ÉMISE est refusé par la base — « Cette facture a déjà
  //  été émise » —, le cas ne peut pas se produire.)
  {
    id: 'B9-05', titre: 'facture SUPPRIMÉE (corbeille) pendant le délai', declencheur: 'invoice.overdue',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const f = await factureEnRetard(b, m, c.id, 1, b.fuseau);
      return { entityType: 'invoice', entityId: f.id, metadata: { days_overdue: 1 }, changer: async () => { await ok(b.admin.from('invoices').update({ deleted_at: new Date().toISOString() }).eq('id', f.id), 'corbeille'); } };
    },
  },
  {
    id: 'B9-06', titre: 'devis ACCEPTÉ pendant le délai', declencheur: 'quote.sent',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const d = await creerDevis(b, m, c.id);
      return { entityType: 'quote', entityId: d.id, changer: async () => { await ok(b.admin.from('quotes').update({ status: 'approved' }).eq('id', d.id), 'accepté'); } };
    },
  },
  {
    id: 'B9-07', titre: 'devis REVENU EN BROUILLON pendant le délai', declencheur: 'quote.sent',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const d = await creerDevis(b, m, c.id);
      return { entityType: 'quote', entityId: d.id, changer: async () => { await ok(b.admin.from('quotes').update({ status: 'draft' }).eq('id', d.id), 'brouillon'); } };
    },
  },
  {
    id: 'B9-08', titre: 'CLIENT du devis mis à la corbeille (soft_delete_client)', declencheur: 'quote.sent',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const d = await creerDevis(b, m, c.id);
      return { entityType: 'quote', entityId: d.id, changer: async () => { await ok(b.admin.rpc('soft_delete_client', { p_org_id: b.orgA, p_client_id: c.id }), 'client supprimé'); } };
    },
  },
  {
    id: 'B9-09', titre: 'rendez-vous ANNULÉ pendant le délai', declencheur: 'appointment.created',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const j = await creerJob(b, m, c.id);
      const v = await visite(m, j.id);
      return { entityType: 'schedule_event', entityId: v.id, metadata: { job_id: j.id, client_id: c.id }, changer: async () => { await ok(b.admin.from('schedule_events').update({ status: 'cancelled' }).eq('id', v.id), 'annulation'); } };
    },
  },
  {
    id: 'B9-10', titre: 'JOB annulé (statut « cancelled »), la visite reste au calendrier', declencheur: 'appointment.created',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const j = await creerJob(b, m, c.id);
      const v = await visite(m, j.id);
      return { entityType: 'schedule_event', entityId: v.id, metadata: { job_id: j.id, client_id: c.id }, changer: async () => { await ok(b.admin.from('jobs').update({ status: 'cancelled' }).eq('id', j.id), 'job annulé'); } };
    },
  },
  {
    id: 'B9-11', titre: 'JOB supprimé comme le fait l’app (ses visites à la corbeille, puis soft_delete_job)', declencheur: 'appointment.created',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const j = await creerJob(b, m, c.id);
      const v = await visite(m, j.id);
      return {
        entityType: 'schedule_event', entityId: v.id, metadata: { job_id: j.id, client_id: c.id },
        changer: async () => {
          // src/lib/jobsApi.ts softDeleteJob : les visites d'abord, puis le job.
          await ok(b.admin.from('schedule_events').update({ deleted_at: new Date().toISOString() }).eq('job_id', j.id), 'visites à la corbeille');
          await ok(b.admin.rpc('soft_delete_job', { p_org_id: b.orgA, p_job_id: j.id }), 'job supprimé');
        },
      };
    },
  },
  {
    id: 'B9-12', titre: 'CLIENT supprimé avant le rappel de sa visite', declencheur: 'appointment.created',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const j = await creerJob(b, m, c.id);
      const v = await visite(m, j.id);
      return { entityType: 'schedule_event', entityId: v.id, metadata: { job_id: j.id, client_id: c.id }, changer: async () => { await ok(b.admin.rpc('soft_delete_client', { p_org_id: b.orgA, p_client_id: c.id }), 'client supprimé'); } };
    },
  },
  {
    id: 'B9-13', titre: 'JOB supprimé avant le message « après le job »', declencheur: 'job.completed',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const j = await creerJob(b, m, c.id, { status: 'completed' });
      return { entityType: 'job', entityId: j.id, metadata: { client_id: c.id }, changer: async () => { await ok(b.admin.rpc('soft_delete_job', { p_org_id: b.orgA, p_job_id: j.id }), 'job supprimé'); } };
    },
  },
  {
    id: 'B9-14', titre: 'CLIENT supprimé avant le message « après le job »', declencheur: 'job.completed',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const j = await creerJob(b, m, c.id, { status: 'completed' });
      return { entityType: 'job', entityId: j.id, metadata: { client_id: c.id }, changer: async () => { await ok(b.admin.rpc('soft_delete_client', { p_org_id: b.orgA, p_client_id: c.id }), 'client supprimé'); } };
    },
  },
  {
    id: 'B9-15', titre: 'client FUSIONNÉ dans une autre fiche (fusionner_clients)', declencheur: 'note.added',
    preparer: async (m) => {
      const absorbe = await creerClient(b, m);
      const garde = await creerClient(b, `${m} gardé`);
      return {
        entityType: 'client', entityId: absorbe.id,
        changer: async () => { await ok(b.admin.rpc('fusionner_clients', { p_org: b.orgA, p_garder: garde.id, p_absorber: absorbe.id }), 'fusion'); },
      };
    },
  },
  {
    id: 'B9-16', titre: 'étiquette RETIRÉE avant le message de « Étiquette ajoutée »', declencheur: 'client.tagged',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const tag = `b9-${Date.now().toString(36)}`;
      await ok(b.admin.from('client_tags').insert({ client_id: c.id, tag }), 'étiquette');
      return {
        entityType: 'client', entityId: c.id, metadata: { tag }, conditions: { tag },
        changer: async () => { await ok(b.admin.from('client_tags').delete().eq('client_id', c.id).eq('tag', tag), 'retrait'); },
      };
    },
  },
  {
    id: 'B9-17', titre: 'filtre « le client a l’étiquette X » : X retirée pendant le délai', declencheur: 'note.added',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const tag = `vip-${Date.now().toString(36)}`;
      await ok(b.admin.from('client_tags').insert({ client_id: c.id, tag }), 'étiquette');
      return {
        entityType: 'client', entityId: c.id, conditions: { client_a_etiquette: tag },
        changer: async () => { await ok(b.admin.from('client_tags').delete().eq('client_id', c.id).eq('tag', tag), 'retrait'); },
      };
    },
  },
  {
    id: 'B9-18', titre: 'opportunité DÉPLACÉE avant le message de « Sans mouvement »', declencheur: 'deal.stage_idle',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const p = await pipelineParDefaut(b);
      const d = await creerDeal(b, c.id, p.ouvertes[0].id, p.id);
      return {
        entityType: 'deal', entityId: d.id, metadata: { deal_id: d.id, stage_id: p.ouvertes[0].id, pipeline_id: p.id, idle_days: 7 },
        changer: async () => { await ok(b.admin.from('deals').update({ stage_id: p.ouvertes[1].id }).eq('id', d.id), 'déplacement'); },
      };
    },
  },
  {
    id: 'B9-19', titre: 'opportunité SUPPRIMÉE avant le message de « Entrée dans une étape »', declencheur: 'deal.stage_entered',
    preparer: async (m) => {
      const c = await creerClient(b, m);
      const p = await pipelineParDefaut(b);
      const d = await creerDeal(b, c.id, p.ouvertes[0].id, p.id);
      return {
        entityType: 'deal', entityId: d.id, metadata: { deal_id: d.id, stage_id: p.ouvertes[0].id, pipeline_id: p.id },
        changer: async () => { await ok(b.admin.from('deals').update({ deleted_at: new Date().toISOString() }).eq('id', d.id), 'suppression'); },
      };
    },
  },
  {
    id: 'B9-20', titre: 'prospect CONVERTI en client avant la relance de « Nouveau prospect »', declencheur: 'lead.created',
    preparer: async (m) => {
      const c = await creerClient(b, m, { status: 'lead', lead_status: 'new' });
      return {
        entityType: 'lead', entityId: c.id,
        changer: async () => { await ok(b.admin.from('clients').update({ status: 'active' }).eq('id', c.id), 'conversion'); },
      };
    },
  },
];

async function jouer(cas: Cas, forme: 'simple' | 'attendre' | 'reponse'): Promise<Resultat> {
  const m = marque(cas.id);
  const base: Resultat = { id: cas.id, titre: cas.titre, declencheur: cas.declencheur, forme, envois: -1, statuts: [], motifs: [], sauts: [] };
  try {
    const p = await cas.preparer(m);
    const action = courriel(m, 'Message différé');
    const champs: Record<string, unknown> = { trigger_event: cas.declencheur, conditions: p.conditions ?? {} };
    if (forme === 'simple') Object.assign(champs, { delay_seconds: UN_JOUR, actions: [action] });
    else {
      const attente = forme === 'attendre'
        ? { id: 'a1', type: 'attendre', delai_secondes: UN_JOUR, suivant: 'm1' }
        : { id: 'a1', type: 'attendre', mode: 'reponse', delai_secondes: UN_JOUR, suivant: 'm1', si_reponse: null };
      Object.assign(champs, { actions: [action], steps: [attente, { id: 'm1', type: 'action', action, suivant: null }] });
    }
    const id = await regle(b, m, champs);
    await emettre(b, cas.declencheur, p.entityType, p.entityId, p.metadata ?? {});
    await attendreTaches(b, id, 1);
    await p.changer();
    await avancer(b, id);
    // Une attente « jusqu'à réponse » ouvre l'action à son échéance : second passage.
    if (forme === 'reponse') await avancer(b, id);
    const taches = await tachesDe(b, id);
    const sauts = (await journauxDe(b, id)).map((j) => String(j.result_data?.saute ?? '')).filter(Boolean);
    return { ...base, envois: (await envoisAvec(b, m)).length, statuts: taches.map((t) => t.status), motifs: taches.map((t) => t.last_error), sauts };
  } catch (e) {
    return { ...base, erreur: e instanceof Error ? e.message : String(e) };
  }
}

beforeAll(async () => {
  b = await preparerBureau();
  await drapeau(b, 'auto_sortie_parcours', false);
  for (const cas of CAS) resultats.set(cas.id, await jouer(cas, 'simple'));
  // Les TYPES D'ATTENTE, sur le cas le plus cité : la facture payée pendant le délai.
  resultats.set('B9-01/attendre', await jouer(CAS[0], 'attendre'));
  resultats.set('B9-01/reponse', await jouer(CAS[0], 'reponse'));
  resultats.set('B9-06/attendre', await jouer(CAS.find((c) => c.id === 'B9-06')!, 'attendre'));
  resultats.set('B9-10/attendre', await jouer(CAS.find((c) => c.id === 'B9-10')!, 'attendre'));
  mkdirSync('D:/lume-final/sorties/b', { recursive: true });
  writeFileSync('D:/lume-final/sorties/b/b-09-revalidation.json', JSON.stringify([...resultats.entries()], null, 2));
}, 900_000);

describe('point 9/13 — la situation change pendant le délai : RIEN ne doit partir (drapeau de sortie éteint)', () => {
  for (const cas of CAS) {
    it(`[${cas.id}] ${cas.declencheur} + 1 jour — ${cas.titre} → aucun message`, () => {
      const r = resultats.get(cas.id)!;
      expect(r.erreur, `le cas n'a pas pu être joué : ${r.erreur}`).toBeUndefined();
      expect(r.envois, `messages partis : ${r.envois} ; tâches : ${JSON.stringify(r.statuts)} ${JSON.stringify(r.motifs)}`).toBe(0);
      // Une trace de l'arrêt : la tâche annulée, ou l'envoi « sauté » au journal.
      expect(r.statuts.includes('cancelled') || r.sauts.length > 0, `aucune trace : ${JSON.stringify(r.statuts)} ${JSON.stringify(r.sauts)}`).toBe(true);
    });
  }
  for (const cle of ['B9-01/attendre', 'B9-01/reponse', 'B9-06/attendre', 'B9-10/attendre']) {
    it(`[${cle}] même cas dans un PARCOURS (étape « attendre${cle.endsWith('reponse') ? ' la réponse' : ''} ») → aucun message`, () => {
      const r = resultats.get(cle)!;
      expect(r.erreur, `le cas n'a pas pu être joué : ${r.erreur}`).toBeUndefined();
      expect(r.envois, `messages partis : ${r.envois} ; tâches : ${JSON.stringify(r.statuts)} ${JSON.stringify(r.motifs)}`).toBe(0);
      expect(r.statuts).toContain('cancelled');
    });
  }
});

describe('point 9 — la raison de l’arrêt est lisible (« ignoré : condition plus valide »)', () => {
  const lisibles: Array<[string, RegExp]> = [
    ['B9-01', /pay/i],
    ['B9-02', /annul/i],
    ['B9-06', /accept/i],
    ['B9-09', /rendez-vous|annul/i],
  ];
  for (const [id, attendu] of lisibles) {
    it(`[${id}] la tâche annulée dit pourquoi, pas « la condition d’arrêt de la règle est remplie »`, () => {
      const r = resultats.get(id)!;
      expect(r.statuts).toEqual(['cancelled']);
      expect(r.motifs[0]).not.toBe(MOTIF_GENERIQUE);
      expect(String(r.motifs[0])).toMatch(attendu);
    });
  }
});

describe('point 9 — drapeau `auto_sortie_parcours` ALLUMÉ : le motif devient lisible, les trous restent', () => {
  const avecDrapeau = new Map<string, Resultat>();
  beforeAll(async () => {
    await drapeau(b, 'auto_sortie_parcours', true);
    try {
      for (const id of ['B9-01', 'B9-05', 'B9-10']) {
        avecDrapeau.set(id, await jouer(CAS.find((c) => c.id === id)!, 'simple'));
      }
    } finally {
      await drapeau(b, 'auto_sortie_parcours', false);
    }
    writeFileSync('D:/lume-final/sorties/b/b-09-revalidation-drapeau.json', JSON.stringify([...avecDrapeau.entries()], null, 2));
  }, 300_000);

  it('[B9-01/drapeau] facture payée → annulée avec « la facture a été payée »', () => {
    const r = avecDrapeau.get('B9-01')!;
    expect(r.envois).toBe(0);
    expect(r.statuts).toEqual(['cancelled']);
    expect(String(r.motifs[0])).toMatch(/facture a été payée/);
  });
  it('[B9-05/drapeau] facture mise à la corbeille → aucun message, même drapeau allumé', () => {
    const r = avecDrapeau.get('B9-05')!;
    expect(r.envois, `messages partis : ${r.envois}`).toBe(0);
  });
  it('[B9-10/drapeau] job annulé → aucun rappel de rendez-vous, même drapeau allumé', () => {
    const r = avecDrapeau.get('B9-10')!;
    expect(r.envois, `messages partis : ${r.envois}`).toBe(0);
  });
});
