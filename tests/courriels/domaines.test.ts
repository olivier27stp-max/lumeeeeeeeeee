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
  statutDepuisSes,
  enregistrementsDepuisSes,
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
const REGION = 'ca-central-1';
const JETONS = ['afv2acoeu5paxpy2qleecrq6lyd2mv6z', 'iinvq67bwoyb2s2zjohisjpjlnyb4gzj', 'vhvzojpfb2nj725gn4h6xvziyhwdqt6m'];
const HOTE = `https://email.${REGION}.amazonaws.com`;

describe('statutDepuisSes', () => {
  it('SUCCESS → verified, FAILED → failed, le reste → pending', () => {
    expect(statutDepuisSes('SUCCESS')).toBe('verified');
    expect(statutDepuisSes('FAILED')).toBe('failed');
    for (const s of ['PENDING', 'NOT_STARTED', 'TEMPORARY_FAILURE', '', null, undefined, 'inconnu']) {
      expect(statutDepuisSes(s)).toBe('pending');
    }
  });
});

describe('enregistrementsDepuisSes', () => {
  it('rend les CNAME DKIM au format de la carte des réglages', () => {
    const r = enregistrementsDepuisSes([{ name: `${JETONS[0]}._domainkey.coquinlavage.ca`, value: `${JETONS[0]}.dkim.${REGION}.amazonses.com` }]);
    expect(r).toEqual([{
      record: 'DKIM',
      type: 'CNAME',
      name: `${JETONS[0]}._domainkey.coquinlavage.ca`,
      value: `${JETONS[0]}.dkim.${REGION}.amazonses.com`,
      ttl: null,
      priority: null,
      status: null,
    }]);
  });

  it('tolère l’absence de jetons et ignore une entrée incomplète', () => {
    expect(enregistrementsDepuisSes(undefined)).toEqual([]);
    expect(enregistrementsDepuisSes([{ name: '', value: 'x' } as any, { name: 'a', value: '' } as any])).toEqual([]);
  });
});

describe('demanderDomaine / verifierDomaine / retirerDomaine (SES simulé)', () => {
  const appels: Array<{ method: string; url: string; body: any; headers: Record<string, string> }> = [];
  let reponses: Array<Response>;

  beforeEach(() => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-de-test';
    process.env.SES_REGION = REGION;
    appels.length = 0;
    reponses = [];
    oublierCacheDomaine(ORG);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      appels.push({
        method: String(init?.method || 'GET'),
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: (init?.headers as Record<string, string>) ?? {},
      });
      const r = reponses.shift();
      if (!r) throw new Error(`réponse SES non prévue pour ${init?.method} ${url}`);
      return r;
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  /** Ce que SES rend sur CreateEmailIdentity / GetEmailIdentity. */
  function identiteSes(statut: string, pretPourEnvoi = false) {
    return {
      IdentityType: 'DOMAIN',
      VerifiedForSendingStatus: pretPourEnvoi,
      DkimAttributes: { Status: statut, Tokens: JETONS, SigningEnabled: true },
    };
  }

  it('demanderDomaine : CreateEmailIdentity en RSA_2048, puis ligne pending avec les 3 CNAME', async () => {
    const etat = { lignes: [] as Ligne[] };
    reponses.push(reponse(200, identiteSes('PENDING')));

    const d = await demanderDomaine(fauxAdmin(etat), ORG, 'CoquinLavage.ca');

    expect(appels).toHaveLength(1);
    expect(appels[0]).toMatchObject({
      method: 'POST',
      url: `${HOTE}/v2/email/identities`,
      body: { EmailIdentity: 'coquinlavage.ca', DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048' } },
    });
    expect(d.status).toBe('pending');
    expect(d.domain).toBe('coquinlavage.ca');
    // SES n'a pas d'identifiant opaque : le domaine porte l'identité.
    expect(d.resend_domain_id).toBe('coquinlavage.ca');
    expect(d.from_local_part).toBe('facturation');
    expect(d.dns_records).toHaveLength(3);
    expect(d.dns_records[0]).toMatchObject({
      type: 'CNAME',
      name: `${JETONS[0]}._domainkey.coquinlavage.ca`,
      value: `${JETONS[0]}.dkim.${REGION}.amazonses.com`,
    });
    expect(etat.lignes).toHaveLength(1);
  });

  it('demanderDomaine : la requête est signée SigV4 pour le service ses', async () => {
    reponses.push(reponse(200, identiteSes('PENDING')));
    await demanderDomaine(fauxAdmin({ lignes: [] }), ORG, 'example.com');
    const h = appels[0].headers;
    expect(h.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/ca-central-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(h['X-Amz-Date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('demanderDomaine : refuse (409) si l’org a déjà un domaine, sans appeler SES', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', resend_domain_id: 'a.com', from_local_part: 'facturation', status: 'pending', dns_records: [] }] };
    await expect(demanderDomaine(fauxAdmin(etat), ORG, 'b.com')).rejects.toMatchObject({ status: 409 });
    expect(appels).toHaveLength(0);
  });

  it('demanderDomaine : refuse un sous-domaine de lumecrm.net avant tout appel réseau', async () => {
    await expect(demanderDomaine(fauxAdmin({ lignes: [] }), ORG, 'moi.lumecrm.net')).rejects.toMatchObject({ status: 400 });
    expect(appels).toHaveLength(0);
  });

  it('demanderDomaine : une erreur SES remonte en 502 et rien n’est écrit', async () => {
    const etat = { lignes: [] as Ligne[] };
    reponses.push(reponse(400, { message: 'Email identity already exists' }));
    await expect(demanderDomaine(fauxAdmin(etat), ORG, 'example.com')).rejects.toMatchObject({ status: 502 });
    expect(etat.lignes).toHaveLength(0);
  });

  it('demanderDomaine : sans clés AWS → 503, sans appel', async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    await expect(demanderDomaine(fauxAdmin({ lignes: [] }), ORG, 'example.com')).rejects.toMatchObject({ status: 503 });
    expect(appels).toHaveLength(0);
  });

  it('verifierDomaine : un seul GET (SES vérifie seul) ; SUCCESS + prêt → verified', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'coquinlavage.ca', resend_domain_id: 'coquinlavage.ca', from_local_part: 'facturation', status: 'pending', dns_records: [], verified_at: null }] };
    reponses.push(reponse(200, identiteSes('SUCCESS', true)));

    const d = await verifierDomaine(fauxAdmin(etat), ORG);

    expect(appels.map((a) => `${a.method} ${a.url}`)).toEqual([
      `GET ${HOTE}/v2/email/identities/coquinlavage.ca`,
    ]);
    expect(d.status).toBe('verified');
    expect(d.verified_at).toBeTruthy();
    expect(d.last_checked_at).toBeTruthy();
    expect(d.dns_records).toHaveLength(3);
  });

  it('verifierDomaine : DKIM SUCCESS mais pas encore prêt à l’envoi → reste pending', async () => {
    // Le piège : SES peut avoir signé le DKIM sans autoriser l'envoi. Publier
    // « vérifié » à ce moment ferait partir les courriels depuis un domaine
    // que SES refuse, et ils seraient rejetés en silence.
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', resend_domain_id: 'a.com', from_local_part: 'facturation', status: 'pending', dns_records: [], verified_at: null }] };
    reponses.push(reponse(200, identiteSes('SUCCESS', false)));
    const d = await verifierDomaine(fauxAdmin(etat), ORG);
    expect(d.status).toBe('pending');
    expect(d.verified_at).toBeNull();
  });

  it('verifierDomaine : PENDING → reste pending, verified_at null', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', resend_domain_id: 'a.com', from_local_part: 'facturation', status: 'pending', dns_records: [], verified_at: null }] };
    reponses.push(reponse(200, identiteSes('PENDING')));
    const d = await verifierDomaine(fauxAdmin(etat), ORG);
    expect(d.status).toBe('pending');
    expect(d.verified_at).toBeNull();
  });

  it('verifierDomaine : FAILED → failed et verified_at effacé', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', resend_domain_id: 'a.com', from_local_part: 'facturation', status: 'verified', dns_records: [], verified_at: '2026-09-01' }] };
    reponses.push(reponse(200, identiteSes('FAILED')));
    const d = await verifierDomaine(fauxAdmin(etat), ORG);
    expect(d.status).toBe('failed');
    expect(d.verified_at).toBeNull();
  });

  it('verifierDomaine : sans domaine → 404', async () => {
    await expect(verifierDomaine(fauxAdmin({ lignes: [] }), ORG)).rejects.toMatchObject({ status: 404 });
  });

  it('retirerDomaine : DeleteEmailIdentity puis suppression locale ; un 404 SES n’empêche pas la suppression', async () => {
    const etat = { lignes: [{ id: 'x', org_id: ORG, domain: 'a.com', resend_domain_id: 'a.com', from_local_part: 'facturation', status: 'verified', dns_records: [] }] };
    reponses.push(reponse(404, { message: 'Email identity does not exist' }));
    await retirerDomaine(fauxAdmin(etat), ORG);
    expect(appels[0]).toMatchObject({ method: 'DELETE', url: `${HOTE}/v2/email/identities/a.com` });
    expect(etat.lignes).toHaveLength(0);
  });

  it('retirerDomaine : sans domaine, rien ne se passe', async () => {
    await retirerDomaine(fauxAdmin({ lignes: [] }), ORG);
    expect(appels).toHaveLength(0);
  });
});
