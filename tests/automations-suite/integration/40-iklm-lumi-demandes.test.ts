/**
 * I — Lumi construit une automatisation à partir d'une phrase, par son VRAI
 * chemin : POST /api/lumi/chat (orchestrateur, routeur, vrai modèle, garde
 * des outils) → carte `create_automation_from_text` → POST /api/lumi/execute
 * (confirmer) → la règle est en base. Identité : le JWT du propriétaire du
 * bureau A de test.
 *
 * Les assertions portent sur la STRUCTURE de la règle (déclencheur, filtres,
 * étapes, délais, types d'action, langue des messages), jamais sur la
 * formulation : le modèle peut écrire « petit rappel » ou « suivi », le
 * parcours doit être le même.
 *
 * COÛT : mesuré dans ai_usage du bureau A (orchestrateur + routeur +
 * générateur de parcours). Le dernier test borne la passe complète.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { demarrerMoteur } from '../harnais/moteur';
import { sessionDe, COMPTES } from '../harnais/bureau-test';
import { demanderALumi, deciderCarte, depenseDepuis, arreterApiLumi, type SessionLumi, type ReponseLumi } from '../harnais/lumi-api';
import { htmlVersTexte } from '../../../src/lib/emailBodyText';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
let jeton = '';
const debutFichier = new Date().toISOString();
const creees: string[] = [];

/** Plafond de coût d'une passe complète de CE fichier (cents). */
const PLAFOND_PASSE_CENTS = 60;

beforeAll(async () => {
  b = await demarrerMoteur();
  jeton = (await sessionDe(b.admin, COMPTES.proprioA.email)).jeton;
  await b.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', b.orgA);
});

afterAll(async () => {
  if (creees.length) await b.admin.from('automation_rules').delete().in('id', creees).eq('org_id', b.orgA);
  await b.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', b.orgA);
  await arreterApiLumi();
});

/* ── Lecture de la structure d'un parcours ──────────────────────────── */
type Etape = {
  id: string; type: string; suivant?: string | null; alors?: string | null; sinon?: string | null;
  delai_secondes?: number; mode?: string; secondes_avant?: number;
  conditions?: Record<string, unknown>;
  action?: { type: string; config?: Record<string, unknown> };
};
interface Regle { id: string; name: string; trigger_event: string; conditions: Record<string, unknown>; steps: Etape[] | null; is_active: boolean }

/** Le chemin principal : on suit `suivant`, et `alors` après un « si ». */
function chemin(steps: Etape[]): Etape[] {
  const parId = new Map(steps.map((e) => [e.id, e]));
  const vu = new Set<string>();
  const out: Etape[] = [];
  let e: Etape | undefined = steps[0];
  while (e && !vu.has(e.id)) {
    vu.add(e.id); out.push(e);
    const suivant: string | null | undefined = e.type === 'si' ? e.alors : e.suivant;
    e = suivant ? parId.get(suivant) : undefined;
  }
  return out;
}

/** Jetons lisibles du chemin : attente:259200, avant:86400, reponse:86400, si:status=sent, send_sms… */
function jetons(steps: Etape[]): string[] {
  return chemin(steps).map((e) => {
    if (e.type === 'attendre') {
      if (e.mode === 'avant_date') return `avant:${e.secondes_avant}`;
      if (e.mode === 'reponse') return `reponse:${e.delai_secondes}`;
      return `attente:${e.delai_secondes}`;
    }
    if (e.type === 'si') return `si:${JSON.stringify(e.conditions)}`;
    if (e.type === 'action') return String(e.action?.type);
    return e.type;
  });
}

/** Vrai si `attendus` apparaissent dans `liste` dans cet ordre (pas forcément contigus). */
function dansLOrdre(liste: string[], attendus: Array<string | RegExp>): boolean {
  let i = 0;
  for (const j of liste) {
    const a = attendus[i];
    if (a !== undefined && (typeof a === 'string' ? j === a : a.test(j))) i++;
  }
  return i === attendus.length;
}

/** Tous les messages au client (texto + courriel) du parcours, en texte. */
function messages(steps: Etape[]): string[] {
  return steps.filter((e) => e.type === 'action' && ['send_sms', 'send_email'].includes(String(e.action?.type)))
    .map((e) => {
      const c = e.action?.config ?? {};
      const corps = e.action?.type === 'send_email' ? htmlVersTexte(String(c.body ?? '')) : String(c.body ?? '');
      return `${String(c.subject ?? '')} ${corps}`.replace(/\s+/g, ' ').trim();
    });
}

const FRANCAIS = /\b(bonjour|vous|votre|merci|soumission|facture|rendez-vous)\b/i;
const ANGLAIS = /\b(hi|hello|your|thank|thanks|quote|invoice|appointment)\b/i;
function enLangue(textes: string[], langue: 'fr' | 'en'): string | true {
  for (const t of textes) {
    if (langue === 'fr' && !FRANCAIS.test(t)) return `message pas en français : « ${t.slice(0, 80)} »`;
    if (langue === 'en' && (FRANCAIS.test(t) || !ANGLAIS.test(t))) return `message pas en anglais : « ${t.slice(0, 80)} »`;
  }
  return true;
}

/** Un montant en dollars dans une condition « si » ou de déclencheur, quel que soit l'opérateur. */
function seuilMontant(r: Regle): number | null {
  const sources: Array<Record<string, unknown>> = [r.conditions ?? {}, ...(r.steps ?? []).filter((e) => e.type === 'si').map((e) => e.conditions ?? {})];
  for (const c of sources) {
    for (const [cle, v] of Object.entries(c)) {
      const m = /^(montant|total_cents|total|amount)(?:__(gt|gte))?$/.exec(cle);
      if (!m) continue;
      const brut = m[2] ? v : (v as Record<string, unknown>)?.gt ?? (v as Record<string, unknown>)?.gte;
      const n = Number(brut);
      if (!Number.isFinite(n)) continue;
      return m[1] === 'total_cents' ? n / 100 : n;
    }
  }
  return null;
}

/* ── Une demande de bout en bout ─────────────────────────────────────── */
async function construire(demande: string, langue: 'fr' | 'en'): Promise<{ r1: ReponseLumi; r2: ReponseLumi | null; regle: Regle | null }> {
  const s: SessionLumi = { jeton, orgId: b.orgA, langue };
  const depuis = new Date().toISOString();
  const r1 = await demanderALumi(s, demande);
  let r2: ReponseLumi | null = null;
  if (r1.proposition?.tool === 'create_automation_from_text' && r1.conversation_id) {
    r2 = await deciderCarte(s, r1.conversation_id, r1.proposition.tool_use_id, 'confirm');
  }
  const { data } = await b.admin.from('automation_rules')
    .select('id, name, trigger_event, conditions, steps, is_active')
    .eq('org_id', b.orgA).eq('is_preset', false).gte('created_at', depuis).order('created_at');
  for (const r of data ?? []) creees.push(r.id as string);
  return { r1, r2, regle: (data?.[0] as Regle | undefined) ?? null };
}

function diagnostic(x: { r1: ReponseLumi; r2: ReponseLumi | null; regle: Regle | null }): string {
  return JSON.stringify({
    texte: x.r1.texte.slice(0, 300), outils: x.r1.outils, proposition: x.r1.proposition, statut: x.r1.statut, erreur: x.r1.erreur,
    recu: x.r2?.texte, regle: x.regle && { trigger: x.regle.trigger_event, conditions: x.regle.conditions, jetons: jetons(x.regle.steps ?? []), messages: messages(x.regle.steps ?? []) },
  });
}

interface Cas {
  id: string;
  langue: 'fr' | 'en';
  demande: string;
  declencheur: string | string[];
  /** Jetons attendus dans l'ordre sur le chemin principal. */
  ordre: Array<string | RegExp>;
  /** Vérifications supplémentaires : true ou un message d'échec. */
  plus?: (r: Regle) => true | string;
}

const JOUR = 86400;
const SI_SANS_REPONSE = /^si:.*"(sent|awaiting_response)"/;
const SI_IMPAYEE = /^si:.*"(unpaid|sent|partial)"/;
const ENVOI = /^send_(sms|email)$/;

const CAS: Cas[] = [
  {
    id: 'I-001', langue: 'fr',
    demande: 'Crée une automatisation : quand j’envoie une soumission, attends 3 jours puis envoie un texto de relance au client s’il n’a pas encore répondu.',
    declencheur: 'quote.sent', ordre: [`attente:${3 * JOUR}`, 'send_sms'],
  },
  {
    id: 'I-002', langue: 'fr',
    demande: 'Crée un rappel automatique par texto la veille de chaque rendez-vous.',
    declencheur: 'appointment.created', ordre: [`avant:${JOUR}`, 'send_sms'],
  },
  {
    id: 'I-003', langue: 'fr',
    demande: 'Crée une automatisation qui demande un avis Google au client quand une job est terminée.',
    declencheur: 'job.completed', ordre: [/^(request_review|send_sms|send_email)$/],
  },
  {
    id: 'I-004', langue: 'fr',
    demande: 'Crée une automatisation : quand une facture de plus de 5 000 $ est payée, ajoute l’étiquette VIP au client.',
    declencheur: 'invoice.paid', ordre: ['ajouter_etiquette'],
    plus: (r) => {
      const et = (r.steps ?? []).find((e) => e.action?.type === 'ajouter_etiquette');
      if (!/^vip$/i.test(String(et?.action?.config?.etiquette ?? ''))) return `étiquette : ${JSON.stringify(et?.action?.config)}`;
      const seuil = seuilMontant(r);
      return seuil === 5000 || `aucune condition « montant > 5 000 $ » (conditions ${JSON.stringify(r.conditions)}, étapes ${JSON.stringify(jetons(r.steps ?? []))})`;
    },
  },
  {
    id: 'I-005', langue: 'fr',
    demande: 'Crée un parcours pour les nouveaux prospects : texto de bienvenue tout de suite, puis attends sa réponse jusqu’à 2 jours ; s’il ne répond pas, envoie-lui un courriel, puis 5 jours plus tard crée une tâche pour que je l’appelle.',
    declencheur: 'lead.created', ordre: ['send_sms', `reponse:${2 * JOUR}`, 'send_email', `attente:${5 * JOUR}`, 'create_task'],
  },
  {
    id: 'I-006', langue: 'en',
    demande: 'Create an automation: when a quote is approved, email the client a thank-you note right away.',
    declencheur: 'quote.approved', ordre: ['send_email'],
    plus: (r) => (chemin(r.steps ?? [])[0]?.type === 'action') || 'le courriel ne part pas tout de suite',
  },
  {
    id: 'I-007', langue: 'en',
    demande: 'Create an automation that texts the client a reminder 2 hours before their appointment.',
    declencheur: 'appointment.created', ordre: ['avant:7200', 'send_sms'],
  },
  {
    id: 'I-008', langue: 'en',
    demande: 'Create an automation: 7 days after an invoice is sent, if it is still unpaid, email the client a reminder with the payment link.',
    declencheur: 'invoice.sent', ordre: [`attente:${7 * JOUR}`, SI_IMPAYEE, 'send_email'],
    plus: (r) => messages(r.steps ?? []).some((m) => m.includes('[invoice_link]')) || 'pas de [invoice_link]',
  },
  {
    id: 'I-009', langue: 'fr',
    demande: 'Crée une automatisation : quand j’ajoute l’étiquette VIP à un client, envoie une notification à l’équipe.',
    declencheur: 'client.tagged', ordre: ['create_notification'],
    plus: (r) => {
      const tag = String((r.conditions as Record<string, unknown>)?.tag ?? '');
      const dansSi = (r.steps ?? []).some((e) => e.type === 'si' && /vip/i.test(JSON.stringify(e.conditions)));
      return /^vip$/i.test(tag) || dansSi || `aucun filtre sur l’étiquette VIP (conditions ${JSON.stringify(r.conditions)}) : la règle partirait pour N’IMPORTE quelle étiquette`;
    },
  },
  {
    id: 'I-010', langue: 'fr',
    demande: 'Crée une automatisation : une journée après qu’une job est terminée, envoie au client un courriel pour lui demander s’il est satisfait.',
    declencheur: 'job.completed', ordre: [`attente:${JOUR}`, 'send_email'],
  },
  {
    id: 'I-011', langue: 'fr',
    demande: 'Crée une automatisation : dès qu’un nouveau prospect arrive, crée une tâche pour le rappeler.',
    declencheur: 'lead.created', ordre: ['create_task'],
    plus: (r) => !(r.steps ?? []).some((e) => ENVOI.test(String(e.action?.type))) || 'un message au client a été ajouté sans demande',
  },
  {
    id: 'I-012', langue: 'en',
    demande: 'Create an automation: when a new lead comes in, text them right away; if they have not replied after 1 day, text them again.',
    declencheur: 'lead.created', ordre: ['send_sms', /^(reponse:86400|attente:86400)$/, 'send_sms'],
  },
  {
    id: 'I-013', langue: 'fr',
    demande: 'Crée une automatisation : 2 jours après qu’un client refuse une soumission, envoie-lui un courriel pour lui demander ce qui n’a pas fonctionné.',
    declencheur: 'quote.declined', ordre: [`attente:${2 * JOUR}`, 'send_email'],
  },
  {
    id: 'I-014', langue: 'fr',
    demande: 'Crée une automatisation qui envoie un texto de remerciement au client quand il paie sa facture.',
    declencheur: 'invoice.paid', ordre: ['send_sms'],
  },
  {
    id: 'I-015', langue: 'en',
    demande: 'Create an automation: 5 days after a quote is sent, email a follow-up if it is not accepted yet; 5 days later, if still not accepted, email one more follow-up.',
    declencheur: 'quote.sent', ordre: [`attente:${5 * JOUR}`, SI_SANS_REPONSE, 'send_email', `attente:${5 * JOUR}`, SI_SANS_REPONSE, 'send_email'],
  },
  {
    id: 'I-016', langue: 'fr',
    demande: 'Crée une automatisation : quand un rendez-vous est annulé, envoie un texto au client pour lui proposer de le reprendre.',
    declencheur: 'appointment.cancelled', ordre: ['send_sms'],
  },
  {
    id: 'I-017', langue: 'fr',
    demande: 'Crée une automatisation qui envoie un courriel de bienvenue au client quand il signe son contrat.',
    declencheur: 'agreement.signed', ordre: ['send_email'],
  },
  {
    id: 'I-018', langue: 'fr',
    demande: 'Crée un parcours : après l’envoi d’une facture, attends 3 jours ; si elle n’est pas payée, envoie un texto avec le lien de paiement ; attends encore 4 jours ; si elle est toujours impayée, crée une tâche pour appeler le client.',
    declencheur: 'invoice.sent', ordre: [`attente:${3 * JOUR}`, SI_IMPAYEE, 'send_sms', `attente:${4 * JOUR}`, SI_IMPAYEE, 'create_task'],
    plus: (r) => messages(r.steps ?? []).some((m) => m.includes('[invoice_link]')) || 'pas de [invoice_link]',
  },
  {
    id: 'I-019', langue: 'en',
    demande: 'Create an automation that asks the client for a Google review as soon as a job is completed.',
    declencheur: 'job.completed', ordre: [/^(request_review|send_sms|send_email)$/],
  },
  {
    id: 'I-020', langue: 'fr',
    demande: 'Crée une automatisation : quand un nouveau prospect arrive, notifie-moi, et 1 jour plus tard envoie-lui un courriel de suivi.',
    declencheur: 'lead.created', ordre: ['create_notification', `attente:${JOUR}`, 'send_email'],
  },
];

describe('I — Lumi crée la règle demandée (vrai modèle, vrai chemin)', () => {
  for (const c of CAS) {
    it(`[${c.id}] ${c.langue.toUpperCase()} « ${c.demande.slice(0, 90)}… » → ${Array.isArray(c.declencheur) ? c.declencheur.join('|') : c.declencheur}`, async () => {
      // Langue du bureau = langue de la demande (une entreprise anglophone écrit en anglais).
      await b.admin.from('company_settings').update({ default_language: c.langue }).eq('org_id', b.orgA);
      const x = await construire(c.demande, c.langue);
      const d = diagnostic(x);
      expect(x.r1.statut, d).toBe(200);
      expect(x.r1.proposition?.tool, `Lumi n’a pas proposé de créer l’automatisation — ${d}`).toBe('create_automation_from_text');
      expect(x.r2?.executes.every((e) => e.ok), `exécution refusée — ${d}`).toBe(true);
      expect(x.regle, `aucune règle en base — ${d}`).not.toBeNull();
      const r = x.regle!;
      expect(r.is_active, 'une règle créée par Lumi naît en pause').toBe(false);
      const attendus = Array.isArray(c.declencheur) ? c.declencheur : [c.declencheur];
      expect(attendus, `déclencheur — ${d}`).toContain(r.trigger_event);
      const j = jetons(r.steps ?? []);
      expect(dansLOrdre(j, c.ordre), `étapes ${JSON.stringify(j)} ≠ attendu ${c.ordre.map(String).join(' → ')} — ${d}`).toBe(true);
      expect(enLangue(messages(r.steps ?? []), c.langue), d).toBe(true);
      if (c.plus) expect(c.plus(r), d).toBe(true);
    });
  }
});

describe('I — demande ambiguë : Lumi demande au lieu de deviner', () => {
  const AMBIGUES = [
    { id: 'I-021', demande: 'Fais-moi une automatisation pour mes clients.' },
    { id: 'I-022', demande: 'Automatise mes rappels.' },
  ];
  for (const a of AMBIGUES) {
    it(`[${a.id}] « ${a.demande} » → une question, aucune règle créée`, async () => {
      const x = await construire(a.demande, 'fr');
      const d = diagnostic(x);
      expect(x.r1.statut, d).toBe(200);
      expect(x.r1.proposition, `Lumi a proposé une écriture sans préciser — ${d}`).toBeNull();
      expect(x.regle, `une règle a été créée — ${d}`).toBeNull();
      expect(x.r1.texte, `pas de question — ${d}`).toMatch(/\?/);
    });
  }
});

describe('I — coût', () => {
  it('[I-023] la passe complète de ce fichier coûte moins que le plafond (ai_usage du bureau A)', async () => {
    // Le journal d'usage s'écrit sans bloquer la réponse : laisse-le se poser.
    await new Promise((r) => setTimeout(r, 1500));
    const cents = await depenseDepuis(b.admin, b.orgA, debutFichier);
    console.info(`[I-023] coût de la passe « demandes » : ${cents.toFixed(2)} ¢`);
    expect(cents).toBeLessThan(PLAFOND_PASSE_CENTS);
  });
});


