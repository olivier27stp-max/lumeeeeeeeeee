/**
 * Domaine d'envoi propre à l'entreprise (2026-09-17) — server/lib/courriels/domaines.ts.
 *
 * Aucun appel réel à Resend : `fetch` est remplacé, et le client Supabase est
 * une maquette chaînable minimale. Une garde statique vérifie aussi que les
 * routes d'envoi passent par `senderForOrg` (et non plus `senderFor` seul).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validerDomaine,
  statutDepuisResend,
  enregistrementsDepuisResend,
  construireExpediteur,
  demanderDomaine,
  verifierDomaine,
  retirerDomaine,
  expediteurDe,
  oublierCacheDomaine,
} from '../../server/lib/courriels/domaines';

const root = resolve(__dirname, '..', '..');
const lire = (p: string) => readFileSync(resolve(root, p), 'utf8');

// ── Validation ──

describe('validerDomaine', () => {
  it('normalise : minuscules, espaces, schéma, chemin, point final', () => {
    expect(validerDomaine('  CoquinLavage.CA ')).toBe('coquinlavage.ca');
    expect(validerDomaine('https://www.example.com/contact')).toBe('www.example.com');
    expect(validerDomaine('example.com.')).toBe('example.com');
  });

  it('accepte des sous-domaines et des tirets', () => {
    expect(validerDomaine('mail.mon-entreprise.qc.ca')).toBe('mail.mon-entreprise.qc.ca');
  });

  it('refuse un domaine vide, sans point, avec des caractères hors ASCII ou un TLD numérique', () => {
    for (const mauvais of ['', '   ', 'localhost', 'entreprise', 'éxample.ca', 'exa mple.com', 'example.123', '-bad.com', 'bad-.com', 'a..b.com', 'user@example.com']) {
      expect(() => validerDomaine(mauvais), mauvais).toThrow();
    }
  });

  it('refuse lumecrm.net et tous ses sous-domaines', () => {
    for (const reserve of ['lumecrm.net', 'LUMECRM.NET', 'facturation.lumecrm.net', 'x.y.lumecrm.net', 'lumecrm.com']) {
      expect(() => validerDomaine(reserve), reserve).toThrow(/platform/);
    }
    // Un domaine qui contient le mot sans être un sous-domaine passe.
    expect(validerDomaine('lumecrm-fan.net')).toBe('lumecrm-fan.net');
    expect(validerDomaine('notlumecrm.net')).toBe('notlumecrm.net');
  });

  it('lève une erreur portant status 400', () => {
    try {
      validerDomaine('bad');
      expect.unreachable();
    } catch (e: any) {
      expect(e.status).toBe(400);
    }
  });
});

// ── Mapping Resend ──

describe('statutDepuisResend', () => {
  it('ramène les sept statuts Resend à pending / verified / failed', () => {
    expect(statutDepuisResend('verified')).toBe('verified');
    expect(statutDepuisResend('not_started')).toBe('pending');
    expect(statutDepuisResend('pending')).toBe('pending');
    expect(statutDepuisResend('partially_verified')).toBe('pending');
    expect(statutDepuisResend('failed')).toBe('failed');
    expect(statutDepuisResend('temporary_failure')).toBe('failed');
    expect(statutDepuisResend('partially_failed')).toBe('failed');
    expect(statutDepuisResend(undefined)).toBe('pending');
    expect(statutDepuisResend('n_importe_quoi')).toBe('pending');
  });
});

describe('enregistrementsDepuisResend', () => {
  it('garde type/name/value/ttl/status/priority/record et ignore les lignes incomplètes', () => {
    const out = enregistrementsDepuisResend([
      { record: 'SPF', name: 'send', type: 'MX', ttl: 'Auto', status: 'not_started', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
      { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', ttl: 'Auto', status: 'not_started', value: 'p=MIGf…' },
      { name: 'sans-valeur', type: 'TXT' },
      null,
      'texte',
    ]);
    expect(out).toEqual([
      { record: 'SPF', name: 'send', type: 'MX', ttl: 'Auto', status: 'not_started', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
      { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', ttl: 'Auto', status: 'not_started', value: 'p=MIGf…', priority: null },
    ]);
  });

  it('renvoie [] pour autre chose qu’un tableau', () => {
    expect(enregistrementsDepuisResend(undefined)).toEqual([]);
    expect(enregistrementsDepuisResend({})).toEqual([]);
  });
});

// ── Expéditeur ──

describe('construireExpediteur', () => {
  it('donne « {Entreprise} <facturation@domaine> »', () => {
    expect(construireExpediteur('Coquin lavage', 'facturation', 'coquinlavage.ca')).toBe('Coquin lavage <facturation@coquinlavage.ca>');
  });

  it('retombe sur Lume sans nom et sur facturation sans partie locale', () => {
    expect(construireExpediteur(null, '', 'example.com')).toBe('Lume <facturation@example.com>');
  });

  it('nettoie les caractères qui casseraient l’en-tête', () => {
    expect(construireExpediteur('Evil <x@y.z>\r\nBcc: a@b.c', 'facturation', 'example.com')).toBe('Evil x@y.z Bcc: a@b.c <facturation@example.com>');
  });
});

// ── Maquette Supabase chaînable + fetch ──

type Ligne = Record<string, any>;

/** Maquette minimale : une table `org_sending_domains` en mémoire et company_settings fixe. */
function fauxAdmin(etat: { lignes: Ligne[]; company?: Ligne | null }) {
  const requete = (table: string) => {
    const filtres: Array<[string, any]> = [];
    let action: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let charge: Ligne | null = null;
    const rows = () => (table === 'org_sending_domains' ? etat.lignes : table === 'company_settings' ? (etat.company ? [etat.company] : []) : []);
    const filtrer = (l: Ligne) => filtres.every(([c, v]) => l[c] === v);
    const executer = (): { data: any; error: any } => {
      if (table !== 'org_sending_domains' && table !== 'company_settings') return { data: null, error: { message: `table inconnue ${table}` } };
      if (action === 'insert') {
        const l = { id: `id-${etat.lignes.length + 1}`, created_at: 'now', updated_at: 'now', verified_at: null, ...charge };
        etat.lignes.push(l);
        return { data: l, error: null };
      }
      if (action === 'update') {
        const cibles = rows().filter(filtrer);
        for (const c of cibles) Object.assign(c, charge);
        return { data: cibles[0] ?? null, error: null };
      }
      if (action === 'delete') {
        const restantes = rows().filter((l) => !filtrer(l));
        etat.lignes.length = 0;
        etat.lignes.push(...restantes);
        return { data: null, error: null };
      }
      return { data: rows().find(filtrer) ?? null, error: null };
    };
    const api: any = {
      select: () => api,
      insert: (p: Ligne) => { action = 'insert'; charge = p; return api; },
      update: (p: Ligne) => { action = 'update'; charge = p; return api; },
      delete: () => { action = 'delete'; return api; },
      eq: (c: string, v: any) => { filtres.push([c, v]); return api; },
      limit: () => api,
      maybeSingle: async () => executer(),
      single: async () => executer(),
      // Le vrai builder supabase-js est thenable : `await admin.from(t).delete().eq(…)` sans single().
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(executer()).then(res, rej),
    };
    return api;
  };
  return { from: (table: string) => requete(table) } as any;
}

function reponse(status: number, corps: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => corps } as Response;
}

const ORG = '11111111-1111-4111-8111-111111111111';
const RESEND_ID = 'd91cd9bd-1176-453e-8fc1-35364d380206';
const RECORDS = [
  { record: 'SPF', name: 'send', type: 'MX', ttl: 'Auto', status: 'not_started', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
  { record: 'SPF', name: 'send', type: 'TXT', ttl: 'Auto', status: 'not_started', value: 'v=spf1 include:amazonses.com ~all' },
  { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', ttl: 'Auto', status: 'not_started', value: 'p=MIGf…' },
];

describe('demanderDomaine / verifierDomaine / retirerDomaine (fetch simulé)', () => {
  const appels: Array<{ method: string; url: string; body: any }> = [];
  let reponses: Array<Response>;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test';
    appels.length = 0;
    reponses = [];
    oublierCacheDomaine(ORG);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      appels.push({ method: String(init?.method || 'GET'), url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      const r = reponses.shift();
      if (!r) throw new Error(`réponse Resend non prévue pour ${init?.method} ${url}`);
      return r;
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
  });

  it('demanderDomaine : POST /domains {name, region} avec la clé, puis ligne pending avec les DNS', async () => {
    const etat = { lignes: [] as Ligne[] };
    reponses.push(reponse(201, { object: 'domain', id: RESEND_ID, name: 'coquinlavage.ca', status: 'not_started', records: RECORDS }));

    const d = await demanderDomaine(fauxAdmin(etat), ORG, 'CoquinLavage.ca');

    expect(appels).toHaveLength(1);
    expect(appels[0]).toMatchObject({ method: 'POST', url: 'https://api.resend.com/domains', body: { name: 'coquinlavage.ca', region: 'us-east-1' } });
    expect(d.status).toBe('pending');
    expect(d.domain).toBe('coquinlavage.ca');
    expect(d.resend_domain_id).toBe(RESEND_ID);
    expect(d.from_local_part).toBe('facturation');
    expect(d.dns_records).toHaveLength(3);
    expect(d.dns_records[0]).toMatchObject({ type: 'MX', name: 'send', priority: 10 });
    expect(etat.lignes).toHaveLength(1);
  });

  it('demanderDomaine : envoie bien le Bearer RESEND_API_KEY', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => reponse(201, { id: RESEND_ID, status: 'not_started', records: [] }));
    vi.stubGlobal('fetch', f);
    await demanderDomaine(fauxAdmin({ lignes: [] }), ORG, 'example.com');
    const init = f.mock.calls[0][1];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
  });

  it('demanderDomaine : refuse (409) si l’org a déjà un domaine, sans appeler Resend', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', resend_domain_id: 'r', from_local_part: 'facturation', status: 'pending', dns_records: [] }] };
    await expect(demanderDomaine(fauxAdmin(etat), ORG, 'b.com')).rejects.toMatchObject({ status: 409 });
    expect(appels).toHaveLength(0);
  });

  it('demanderDomaine : refuse un sous-domaine de lumecrm.net avant tout appel réseau', async () => {
    await expect(demanderDomaine(fauxAdmin({ lignes: [] }), ORG, 'moi.lumecrm.net')).rejects.toMatchObject({ status: 400 });
    expect(appels).toHaveLength(0);
  });

  it('demanderDomaine : une erreur Resend remonte en 502 et rien n’est écrit', async () => {
    const etat = { lignes: [] as Ligne[] };
    reponses.push(reponse(422, { name: 'validation_error', message: 'Domain already exists' }));
    await expect(demanderDomaine(fauxAdmin(etat), ORG, 'example.com')).rejects.toMatchObject({ status: 502 });
    expect(etat.lignes).toHaveLength(0);
  });

  it('demanderDomaine : sans RESEND_API_KEY → 503, sans appel', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(demanderDomaine(fauxAdmin({ lignes: [] }), ORG, 'example.com')).rejects.toMatchObject({ status: 503 });
    expect(appels).toHaveLength(0);
  });

  it('verifierDomaine : POST verify puis GET ; verified → status verified + verified_at', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'coquinlavage.ca', resend_domain_id: RESEND_ID, from_local_part: 'facturation', status: 'pending', dns_records: [], verified_at: null }] };
    reponses.push(reponse(200, { object: 'domain', id: RESEND_ID }));
    reponses.push(reponse(200, { id: RESEND_ID, status: 'verified', records: RECORDS.map((r) => ({ ...r, status: 'verified' })) }));

    const d = await verifierDomaine(fauxAdmin(etat), ORG);

    expect(appels.map((a) => `${a.method} ${a.url}`)).toEqual([
      `POST https://api.resend.com/domains/${RESEND_ID}/verify`,
      `GET https://api.resend.com/domains/${RESEND_ID}`,
    ]);
    expect(d.status).toBe('verified');
    expect(d.verified_at).toBeTruthy();
    expect(d.last_checked_at).toBeTruthy();
    expect(d.dns_records.every((r) => r.status === 'verified')).toBe(true);
  });

  it('verifierDomaine : pending chez Resend → reste pending, verified_at null', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', resend_domain_id: RESEND_ID, from_local_part: 'facturation', status: 'pending', dns_records: RECORDS, verified_at: null }] };
    reponses.push(reponse(200, { object: 'domain', id: RESEND_ID }));
    reponses.push(reponse(200, { id: RESEND_ID, status: 'pending', records: RECORDS }));
    const d = await verifierDomaine(fauxAdmin(etat), ORG);
    expect(d.status).toBe('pending');
    expect(d.verified_at).toBeNull();
  });

  it('verifierDomaine : temporary_failure → failed', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', resend_domain_id: RESEND_ID, from_local_part: 'facturation', status: 'verified', dns_records: RECORDS, verified_at: '2026-09-01' }] };
    reponses.push(reponse(200, { object: 'domain', id: RESEND_ID }));
    reponses.push(reponse(200, { id: RESEND_ID, status: 'temporary_failure', records: RECORDS }));
    const d = await verifierDomaine(fauxAdmin(etat), ORG);
    expect(d.status).toBe('failed');
    expect(d.verified_at).toBeNull();
  });

  it('verifierDomaine : sans domaine → 404', async () => {
    await expect(verifierDomaine(fauxAdmin({ lignes: [] }), ORG)).rejects.toMatchObject({ status: 404 });
  });

  it('retirerDomaine : DELETE chez Resend puis suppression locale ; un 404 Resend n’empêche pas la suppression', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', resend_domain_id: RESEND_ID, from_local_part: 'facturation', status: 'verified', dns_records: [] }] };
    reponses.push(reponse(404, { name: 'not_found', message: 'Domain not found' }));
    await retirerDomaine(fauxAdmin(etat), ORG);
    expect(appels[0]).toMatchObject({ method: 'DELETE', url: `https://api.resend.com/domains/${RESEND_ID}` });
    expect(etat.lignes).toHaveLength(0);
  });

  it('retirerDomaine : sans domaine, rien ne se passe', async () => {
    await retirerDomaine(fauxAdmin({ lignes: [] }), ORG);
    expect(appels).toHaveLength(0);
  });
});

describe('expediteurDe', () => {
  beforeEach(() => oublierCacheDomaine(ORG));

  it('null sans domaine vérifié (pending ne compte pas)', async () => {
    expect(await expediteurDe(fauxAdmin({ lignes: [] }), ORG, { company_name: 'X', company_email: 'x@y.z' })).toBeNull();
    oublierCacheDomaine(ORG);
    const pending = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', from_local_part: 'facturation', status: 'pending', dns_records: [] }] };
    expect(await expediteurDe(fauxAdmin(pending), ORG, { company_name: 'X', company_email: 'x@y.z' })).toBeNull();
  });

  it('{ from, replyTo } avec le nom de l’entreprise et sa boîte en Reply-To quand le domaine est vérifié', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'coquinlavage.ca', from_local_part: 'facturation', status: 'verified', dns_records: [] }] };
    const e = await expediteurDe(fauxAdmin(etat), ORG, { company_name: 'Coquin lavage', company_email: 'info@coquinlavage.ca' });
    expect(e).toEqual({ from: 'Coquin lavage <facturation@coquinlavage.ca>', replyTo: 'info@coquinlavage.ca' });
  });

  it('lit company_settings quand l’appelant ne fournit pas l’entreprise', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', from_local_part: 'facturation', status: 'verified', dns_records: [] }], company: { org_id: ORG, company_name: 'ACME', email: 'bob@acme.com' } };
    expect(await expediteurDe(fauxAdmin(etat), ORG)).toEqual({ from: 'ACME <facturation@a.com>', replyTo: 'bob@acme.com' });
  });

  it('le cache de 5 min sert la seconde lecture sans retoucher la base ; oublierCacheDomaine l’invalide', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', from_local_part: 'facturation', status: 'verified', dns_records: [] }] };
    const admin = fauxAdmin(etat);
    const espion = vi.spyOn(admin, 'from');
    await expediteurDe(admin, ORG, { company_name: 'A' });
    await expediteurDe(admin, ORG, { company_name: 'A' });
    expect(espion).toHaveBeenCalledTimes(1);
    oublierCacheDomaine(ORG);
    await expediteurDe(admin, ORG, { company_name: 'A' });
    expect(espion).toHaveBeenCalledTimes(2);
  });

  it('une base qui refuse la lecture vaut null (expéditeur plateforme), jamais une exception', async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'relation does not exist' } }) }) }) }) }) } as any;
    expect(await expediteurDe(admin, ORG, { company_name: 'A' })).toBeNull();
  });
});

// ── Garde statique : les routes d'envoi passent par senderForOrg ──

describe('senderForOrg est l’expéditeur des routes d’envoi', () => {
  const emails = lire('server/routes/emails.ts');

  it('senderForOrg existe, garde senderFor comme repli et ne change pas le Reply-To', () => {
    expect(emails).toContain('export async function senderForOrg(orgId: string, company: CompanyInfo)');
    const fn = emails.slice(emails.indexOf('export async function senderForOrg'), emails.indexOf('// ── POST /api/emails/send-invoice'));
    expect(fn).toContain('senderFor(company)');
    expect(fn).toContain('expediteurDe(');
    expect(fn).toContain('replyTo: plateforme.replyTo');
  });

  it('emails.ts : TOUT envoi passe par senderForOrg, jamais par senderFor', () => {
    /* La règle protégée : un courriel part toujours au nom de l'entreprise,
       depuis son domaine s'il est vérifié. `senderFor` seul utiliserait
       l'adresse de la plateforme.

       Ce test exigeait exactement 4 appels. Le compteur a lâché le
       2026-09-23, quand l'envoi d'essai (« M'envoyer un essai ») en a ajouté
       un cinquième — un envoi parfaitement conforme. Un compteur ne distingue
       pas une violation d'un ajout légitime ; on vérifie donc la règle
       elle-même : chaque `sendEmail` de ce fichier a son expéditeur, et aucun
       ne passe par `senderFor` directement. */
    const appelsSender = (emails.match(/\.\.\.\(await senderForOrg\(/g) || []).length;
    const envois = (emails.match(/await sendEmail\(\{/g) || []).length;
    expect(appelsSender).toBe(envois);
    expect(appelsSender).toBeGreaterThanOrEqual(4);
    expect(emails).not.toMatch(/\.\.\.senderFor\(company\)/);
  });

  for (const [fichier, motif] of [
    ['server/routes/payment-requests.ts', /await senderForOrg\(params\.orgId, company\)/],
    ['server/routes/agreements.ts', /await senderForOrg\(orgId, company\)/],
    ['server/routes/reminders-cron.ts', /await senderForOrg\(orgId, societe\)/],
    ['server/routes/communications.ts', /await senderForOrg\(orgId, company\)/],
  ] as const) {
    it(`${fichier} passe par senderForOrg`, () => {
      const src = lire(fichier);
      expect(src).toMatch(motif);
      expect(src).not.toMatch(/[^A-Za-z]senderFor\(/);
    });
  }

  it('le domaine d’envoi n’est écrit que par le serveur : src/ ne touche pas org_sending_domains', () => {
    expect(lire('src/lib/sendingDomainApi.ts')).not.toContain("from('org_sending_domains')");
    expect(lire('src/lib/sendingDomainApi.ts')).toContain('/api/sending-domain');
  });

  it('les routes sont montées et protégées (owner/admin + settings.update)', () => {
    expect(lire('server/index.ts')).toContain("app.use('/api/sending-domain', sendingDomainsRouter)");
    const perms = lire('server/lib/route-permissions.ts');
    expect(perms).toContain("'POST /api/sending-domain': 'settings.update'");
    expect(perms).toContain("'DELETE /api/sending-domain': 'settings.update'");
    expect(lire('server/routes/sending-domains.ts')).toContain('isOrgAdminOrOwner');
  });

  it('la migration porte la RLS de lecture par membre et retire les écritures aux clients', () => {
    const sql = lire('supabase/migrations/20260917160000_org_sending_domains.sql');
    expect(sql).toContain('create table if not exists public.org_sending_domains');
    expect(sql).toContain("check (status in ('pending', 'verified', 'failed'))");
    expect(sql).toContain('enable row level security');
    expect(sql).toMatch(/for select to authenticated\s+using \(public\.has_org_membership\(\(select auth\.uid\(\)\), org_id\)\)/);
    expect(sql).toContain('revoke all on public.org_sending_domains from authenticated');
    expect(sql).toContain('grant select on public.org_sending_domains to authenticated');
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/);
  });
});
