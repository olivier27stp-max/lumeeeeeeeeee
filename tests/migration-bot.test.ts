/**
 * Bot de migration (server/lib/migration/bot.ts) — les décisions pures et
 * les garde-fous :
 * - un champ inconnu du catalogue ne passe jamais (null, confiance 0) ;
 * - confirmation seulement à ≥ 0,90, sinon question au client ;
 * - doublon : courriel ou téléphone identique → fusion ; nom seul → question ;
 *   ressemblance faible → nouvelle fiche ; jamais une fusion par le nom ;
 * - gabarit appliqué seulement à ≥ 80 % de couverture ;
 * - réponses du client interprétées prudemment (null si ambiguë) ;
 * - le bot ne contient ni approbation ni import final ni rollback.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { couvertureGabarit, validerVerdicts, deciderDoublon, deciderMapping, modeBot, constatsRejets, interpreterReponseColonne, SEUIL_CONFIRMATION, SEUIL_GABARIT, MAX_PASSES, RAPPEL_ADMIN_HEURES } from '../server/lib/migration/bot';
import { FIELD_CATALOG } from '../server/lib/migration/mapping';

const lu = (p: string) => readFileSync(resolve(__dirname, '..', ...p.split('/')), 'utf8');
const champsClient = FIELD_CATALOG.client;

describe('verdicts de correspondance', () => {
  it('un champ hors catalogue devient null avec confiance 0 ; les candidats inconnus sont retirés', () => {
    const v = validerVerdicts({ colonnes: [
      { position: 0, field: 'email', confidence: 0.97, raison: 'en-tête Courriel' },
      { position: 1, field: 'numero_de_cellulaire', confidence: 0.95 },
      { position: 2, field: null, confidence: 0.4, candidats: ['phone', 'fax', 'phone_secondary'] },
    ] }, champsClient);
    expect(v[0]).toMatchObject({ field: 'email', confidence: 0.97 });
    expect(v[1]).toMatchObject({ field: null, confidence: 0 });
    expect(v[2].candidats).toEqual(['phone', 'phone_secondary']);
    expect(validerVerdicts('pas du json', champsClient)).toEqual([]);
    // Un verdict mal formé est jeté seul ; une raison trop longue est coupée, pas refusée (vu en direct : le modèle explique en 250 caractères).
    const mixte = validerVerdicts({ colonnes: [{ position: 0, field: 'email', confidence: 1.5 }, { position: 1, field: 'phone', confidence: 0.95, raison: 'x'.repeat(400), candidats: ['a', 'b', 'c', 'd'] }] }, champsClient);
    expect(mixte).toHaveLength(1);
    expect(mixte[0].raison).toHaveLength(200);
    // Tableau sérialisé en chaîne (vu en direct avec Sonnet 5) : accepté.
    expect(validerVerdicts({ colonnes: JSON.stringify({ colonnes: [{ position: 3, field: 'email', confidence: 0.95 }] }) }, champsClient)).toHaveLength(1);
    expect(validerVerdicts({ colonnes: JSON.stringify([{ position: 3, field: 'email', confidence: 0.95 }]) }, champsClient)).toHaveLength(1);
  });
  it('confirmer seulement à ≥ 0,90 avec un champ ; sinon demander', () => {
    expect(SEUIL_CONFIRMATION).toBe(0.9);
    expect(deciderMapping({ position: 0, field: 'email', confidence: 0.9, raison: '', candidats: [] })).toBe('confirmer');
    expect(deciderMapping({ position: 0, field: 'email', confidence: 0.89, raison: '', candidats: [] })).toBe('demander');
    expect(deciderMapping({ position: 0, field: null, confidence: 0.99, raison: '', candidats: [] })).toBe('demander');
  });
  it('mode autonome : jamais « demander » — une colonne incertaine est conservée dans les notes', () => {
    expect(deciderMapping({ position: 0, field: 'email', confidence: 0.9, raison: '', candidats: [] }, 'autonome')).toBe('confirmer');
    expect(deciderMapping({ position: 0, field: 'email', confidence: 0.89, raison: '', candidats: [] }, 'autonome')).toBe('conserver');
    expect(deciderMapping({ position: 0, field: null, confidence: 0.99, raison: '', candidats: [] }, 'autonome')).toBe('conserver');
    expect(modeBot({ bot_mode: 'client' })).toBe('client');
    expect(modeBot({ bot_mode: 'autonome' })).toBe('autonome');
    expect(modeBot({ bot_mode: null })).toBe('autonome');
    expect(modeBot({})).toBe('autonome');
  });
});

describe('doublons', () => {
  it('courriel ou téléphone identique → fusion ; nom seul → question ; faible → nouvelle fiche ; déjà décidé → rien', () => {
    expect(deciderDoublon({ score: 95, decision: 'pending', match_reasons: ['email', 'name'] })).toBe('merge');
    expect(deciderDoublon({ score: 92, decision: 'pending', match_reasons: 'phone' })).toBe('merge');
    expect(deciderDoublon({ score: 95, decision: 'pending', match_reasons: ['name'] })).toBe('demander');
    expect(deciderDoublon({ score: 95, decision: 'pending', match_reasons: ['name', 'address'] })).toBe('demander');
    expect(deciderDoublon({ score: 80, decision: 'review', match_reasons: ['email'] })).toBe('create_new');
    expect(deciderDoublon({ score: 95, decision: 'merge', match_reasons: ['email'] })).toBeNull();
  });
  it('mode autonome : le nom seul donne une nouvelle fiche (rien de perdu, fusionnable plus tard) ; la fusion sur courriel/téléphone reste', () => {
    expect(deciderDoublon({ score: 95, decision: 'pending', match_reasons: ['name'] }, 'autonome')).toBe('create_new');
    expect(deciderDoublon({ score: 95, decision: 'pending', match_reasons: ['email', 'name'] }, 'autonome')).toBe('merge');
    expect(deciderDoublon({ score: 80, decision: 'review', match_reasons: ['name'] }, 'autonome')).toBe('create_new');
    expect(deciderDoublon({ score: 95, decision: 'merge', match_reasons: ['name'] }, 'autonome')).toBeNull();
  });
});

describe('gabarits et réponses', () => {
  it('couverture d un gabarit : à la normalisation des en-têtes près, seuil 80 %', () => {
    expect(SEUIL_GABARIT).toBe(0.8);
    const map = { 'first name': 'first_name', 'last name': 'last_name', email: 'email', phone: 'phone' };
    expect(couvertureGabarit(['First Name', 'Last Name', 'Email', 'Phone', 'Notes'], map)).toBeCloseTo(0.8);
    expect(couvertureGabarit(['A', 'B'], map)).toBe(0);
    expect(couvertureGabarit([], map)).toBe(0);
    expect(couvertureGabarit(['Email'], undefined)).toBe(0);
  });
  it('réponse du client : option choisie, « ignorer », ou null si ambiguë', () => {
    const c = [{ field: 'phone', label: 'Téléphone' }, { field: 'phone_secondary', label: 'Téléphone secondaire' }];
    expect(interpreterReponseColonne('Téléphone secondaire', c)).toEqual({ field: 'phone_secondary', ignorer: false });
    expect(interpreterReponseColonne('phone', c)).toEqual({ field: 'phone', ignorer: false });
    expect(interpreterReponseColonne('Ignorer cette colonne', c)).toEqual({ field: null, ignorer: true });
    expect(interpreterReponseColonne('je sais pas', c)).toBeNull();
    expect(interpreterReponseColonne('', c)).toBeNull();
  });
  it('constats sur les rejets : une phrase par entité et raison, vocabulaire d affichage', () => {
    const c = constatsRejets([{ entity_type: 'invoice', status: 'orphan', n: 12 }, { entity_type: 'job', status: 'error', n: 1 }, { entity_type: 'client', status: 'ready', n: 5 }, { entity_type: 'visit', status: 'orphan', n: 0 }]);
    expect(c).toEqual([
      '12 factures sans client ou job correspondant dans les fichiers (lignes orphelines : elles ne seront pas importées).',
      '1 jobs avec une valeur illisible (date, montant ou identifiant) : voir les rejets.',
    ]);
  });
});

describe('garde-fous', () => {
  it('le bot ne contient ni approbation, ni import final, ni rollback ; il est borné ; le modèle ne voit que des échantillons masqués', () => {
    const src = lu('server/lib/migration/bot.ts');
    expect(src).not.toMatch(/runFinalImport\(|rollbackFinalBatch\(|from\('migration_approvals'\)|status: 'approved'|poserStatut\([^)]*'ready_for_final_import'/);
    expect(MAX_PASSES).toBeLessThanOrEqual(10);
    expect(src).toContain('samples_masked');
    expect(src).not.toMatch(/payload/);
    // Les décisions sont auditées comme « assistant », jamais comme un admin.
    expect(src).toContain("role: 'assistant'");
    expect(src).not.toContain("actorRole: 'platform_admin'");
    // Mode autonome : l'approbation au nom du client est un geste d'admin (route), jamais du bot ; l'admin est prévenu, pas le client.
    expect(src).not.toMatch(/approuverAuNomDuClient/);
    expect(src).toContain("if (mode === 'autonome') await resoudreQuestionsAutonome(");
    expect(src).toContain("client_visible: false");
    expect(RAPPEL_ADMIN_HEURES).toBeGreaterThanOrEqual(24);
  });
  it("l'approbation au nom du client est honnête : confirmed_text null, commentaire explicite, rôle platform_admin, message au client", () => {
    const e = lu('server/lib/migration/execution.ts');
    expect(e).toContain('confirmed_text: null');
    expect(e).toContain("au nom du client");
    expect(e).toContain("action: 'approval.on_behalf'");
    expect(e).toContain("actorRole: 'platform_admin'");
    expect(e).toContain("author_kind: 'admin'");
    const r = lu('server/routes/migration-admin.ts');
    expect(r).toContain("router.post('/migration-admin/migrations/:id/approve-on-behalf'");
    expect(r).toContain("'bot_actif', 'bot_mode'] as const");
    expect(lu('src/pages/AdminMigrations.tsx')).toContain('Approuver au nom du client');
  });
  it('les routes admin et le bot partagent le même import test et la même demande d approbation', () => {
    const r = lu('server/routes/migration-admin.ts');
    expect(r).toContain("import { lancerImportTest, demanderApprobation, approuverAuNomDuClient } from '../lib/migration/execution';");
    expect(r).toContain("router.post('/migration-admin/migrations/:id/bot'");
    expect(r).toContain("'bot_actif', 'bot_mode'] as const");
    expect(lu('server/index.ts')).toContain("withAdvisoryLock('migration-bot'");
    expect(lu('src/pages/AdminMigrations.tsx')).toContain('Confier au bot');
  });
});

// ── 2026-09-17 : le bot rapproché de Claude Code (gardes, décision par colonne, audit) ──
import { appliquerGardes, estRapportUtilisation } from '../server/lib/migration/gardes-bot';
import { deciderColonne, validerManques, validerNature, construireTextePourClaude, auditVide, MODELES_BOT } from '../server/lib/migration/bot';
import { REGLES_LUME, SEMANTIQUE_ENTITE } from '../server/lib/migration/connaissances-bot';

describe('gardes en dur (jamais un champ deviné)', () => {
  const champs = FIELD_CATALOG.client;
  const base = { fichier: 'clients.csv', entity: 'client' as const, champs };
  it('booléen vers une entreprise ou un identifiant → null + alerte', () => {
    const r = appliquerGardes({ ...base,
      colonnes: [{ position: 0, header: 'Is Company?', detected_type: 'boolean' }, { position: 1, header: 'Archived', detected_type: 'boolean' }],
      verdicts: [{ position: 0, field: 'company', confidence: 0.83 }, { position: 1, field: 'external_id', confidence: 0.9 }] });
    expect(r.verdicts.map((v) => v.field)).toEqual([null, null]);
    expect(r.alertes).toHaveLength(2);
    expect(r.alertes[0].message).toMatch(/type incompatible/);
  });
  it('date vers un nom de famille → null', () => {
    const r = appliquerGardes({ ...base, colonnes: [{ position: 0, header: 'CFT[Last review invite]', detected_type: 'date' }], verdicts: [{ position: 0, field: 'last_name', confidence: 0.81 }] });
    expect(r.verdicts[0].field).toBeNull();
  });
  it('Tags vers Identifiant externe → null (aurait écrasé le J-ID)', () => {
    const r = appliquerGardes({ ...base, colonnes: [{ position: 0, header: 'Tags', detected_type: 'id' }], verdicts: [{ position: 0, field: 'external_id', confidence: 0.95 }] });
    expect(r.verdicts[0].field).toBeNull();
    expect(r.alertes[0].message).toMatch(/étiquettes/);
  });
  it('deux colonnes vers Adresse : la plus sûre gagne, l\'autre → null', () => {
    const r = appliquerGardes({ ...base,
      colonnes: [{ position: 3, header: 'Service Street 1', detected_type: 'address' }, { position: 4, header: 'Service Street 2', detected_type: 'text' }],
      verdicts: [{ position: 3, field: 'address', confidence: 0.92 }, { position: 4, field: 'address', confidence: 0.8 }] });
    expect(r.verdicts.find((v) => v.position === 3)?.field).toBe('address');
    expect(r.verdicts.find((v) => v.position === 4)?.field).toBeNull();
    expect(r.alertes[0].message).toMatch(/la plus à droite aurait écrasé/);
  });
  it('un champ déjà fixé par un humain n\'est jamais repris', () => {
    const r = appliquerGardes({ ...base, colonnes: [{ position: 9, header: 'Text Message Enabled Phone #', detected_type: 'number' }],
      verdicts: [{ position: 9, field: 'phone', confidence: 0.95 }], fixes: [{ position: 1, field: 'phone' }] });
    expect(r.verdicts[0].field).toBeNull();
    expect(r.alertes[0].message).toMatch(/humain/);
  });
  it('rapport d\'utilisation Products & Services : seul le nom passe', () => {
    const cols = ['Name', 'Quoted qty', 'Quoted $', 'Jobs qty', 'Jobs $', 'Invoiced qty', 'Invoiced $'].map((h, i) => ({ position: i, header: h, detected_type: i === 0 ? 'name' : i % 2 ? 'boolean' : 'money' }));
    expect(estRapportUtilisation(cols.map((c) => c.header))).toBe(true);
    const r = appliquerGardes({ fichier: 'ps.csv', entity: 'service', champs: FIELD_CATALOG.service, colonnes: cols,
      verdicts: [{ position: 0, field: 'name', confidence: 1 }, { position: 1, field: 'taxable', confidence: 0.6 }, { position: 2, field: 'price', confidence: 0.7 }] });
    expect(r.nature).toMatch(/rapport d'utilisation/i);
    expect(r.verdicts.map((v) => v.field)).toEqual(['name', null, null]);
  });
  it('un verdict propre passe inchangé', () => {
    const r = appliquerGardes({ ...base, colonnes: [{ position: 0, header: 'E-mails', detected_type: 'email' }], verdicts: [{ position: 0, field: 'email', confidence: 0.96 }] });
    expect(r.verdicts[0].field).toBe('email');
    expect(r.alertes).toEqual([]);
  });
});

describe('décision par colonne (statut actuel × verdict)', () => {
  const v = (field: string | null, confidence: number, alerte?: string) => ({ position: 0, field, confidence, raison: '', candidats: [] as string[], alerte });
  it('alerte sans champ → conserver, dans les deux modes', () => {
    expect(deciderColonne({ statut: 'suggested', actuel: 'external_id', verdict: v(null, 0, 'tags'), mode: 'client' })).toBe('conserver');
    expect(deciderColonne({ statut: 'needs_review', actuel: null, verdict: v(null, 0, 'tags'), mode: 'autonome' })).toBe('conserver');
  });
  it('alerte informative AVEC champ → la colonne est quand même importée (vu en direct : « E-mails » au pluriel)', () => {
    expect(deciderColonne({ statut: 'suggested', actuel: 'email', verdict: v('email', 0.85, 'en-tête au pluriel'), mode: 'autonome' })).toBe('confirmer');
    expect(deciderColonne({ statut: 'suggested', actuel: 'phone', verdict: v('phone_secondary', 0.9, 'aurait écrasé le principal'), mode: 'autonome' })).toBe('corriger');
  });
  it('≥ 0,90 : confirmer si même champ, corriger sinon', () => {
    expect(deciderColonne({ statut: 'suggested', actuel: 'email', verdict: v('email', 0.95), mode: 'autonome' })).toBe('confirmer');
    expect(deciderColonne({ statut: 'suggested', actuel: 'external_id', verdict: v('lead_source', 0.93), mode: 'autonome' })).toBe('corriger');
  });
  it('moteur et modèle d\'accord à 0,75 sur une proposition → confirmer', () => {
    expect(deciderColonne({ statut: 'suggested', actuel: 'phone', verdict: v('phone', 0.75), mode: 'client' })).toBe('confirmer');
  });
  it('incertain : suggested → laisser ; needs_review → conserver (autonome) / demander (client)', () => {
    expect(deciderColonne({ statut: 'suggested', actuel: 'full_name', verdict: v('company', 0.6), mode: 'autonome' })).toBe('laisser');
    expect(deciderColonne({ statut: 'needs_review', actuel: null, verdict: v('company', 0.6), mode: 'autonome' })).toBe('conserver');
    expect(deciderColonne({ statut: 'needs_review', actuel: null, verdict: v('company', 0.6), mode: 'client' })).toBe('demander');
  });
});

describe('manques, nature et texte pour Claude', () => {
  it('manques validés en forme, jamais dans « field »', () => {
    const m = validerManques({ manques: [{ colonne: 'Deposit $', proposition: 'deposit', besoin: 'acompte reçu' }, { colonne: '', proposition: 'x', besoin: 'y' }, 42] }, 'invoices.csv', 'invoice');
    expect(m).toEqual([{ fichier: 'invoices.csv', entite: 'invoice', colonne: 'Deposit $', proposition: 'deposit', besoin: 'acompte reçu' }]);
    expect(validerManques(null, 'f', 'e')).toEqual([]);
    expect(validerNature({ nature_fichier: '  rapport  ' })).toBe('rapport');
    expect(validerNature({})).toBeNull();
  });
  it('le texte pour Claude a ses 6 sections et reprend corrections, alertes, à vérifier et manques', () => {
    const audit = auditVide();
    audit.fichiers.push({ nom: 'clients.csv', entite: 'client', nature: null });
    audit.corrections.push({ fichier: 'clients.csv', colonne: 'Tags', avant: 'Identifiant externe', apres: null, pourquoi: 'étiquettes' });
    audit.alertes.push({ fichier: 'clients.csv', colonne: 'Is Company?', message: 'type incompatible', action: 'ne pas importer' });
    audit.a_verifier.push({ fichier: 'clients.csv', colonne: 'Display Name', actuel: 'Nom complet', candidats: ['Entreprise'], pourquoi: 'doute' });
    audit.manques.push({ fichier: 'clients.csv', colonne: 'Archived', entite: 'client', proposition: 'archived', besoin: 'statut archivé' });
    audit.modele = 'claude-fable-5-1';
    const t = construireTextePourClaude({ migration_id: 'm1', declencheur: 'manuel', debut: '2026-09-17T10:00:00Z', fin: '2026-09-17T10:01:00Z', statut_avant: 'mapping', statut_apres: 'mapping', decisions: [], questions_posees: 0, arret: 'ok', cout_cents: 1, audit }, { id: 'm1', source_crm: 'jobber', org_id: 'o' } as any);
    for (const h of ['## 1. Fichiers', '## 2. Corrections', '## 3. Alertes', '## 4. À trancher', '## 5. Manques', '## 6. Comment procéder']) expect(t).toContain(h);
    expect(t).toContain('« Tags » : Identifiant externe → ne pas importer');
    expect(t).toContain('« Archived » (entité client) : proposer « archived »');
    expect(t).toContain('claude-fable-5-1');
    expect(t).toContain('applique l\'audit');
  });
  it('modèle par défaut = Fable 5.1 avec repli Opus 5 puis Sonnet 5', () => {
    expect(MODELES_BOT[0]).toBe(process.env.LUMI_MODEL_MIGRATION || 'claude-fable-5-1');
    expect(MODELES_BOT).toContain('claude-opus-5');
    expect(MODELES_BOT[MODELES_BOT.length - 1]).toBe('claude-sonnet-5');
  });
  it('les connaissances couvrent chaque entité et les pièges connus, sans valeur variable', () => {
    for (const e of Object.keys(FIELD_CATALOG)) expect(SEMANTIQUE_ENTITE[e as keyof typeof SEMANTIQUE_ENTITE]).toBeTruthy();
    for (const piege of ['la plus À DROITE', 'Tags', 'CFT', 'AVANT TAXES', 'Quoted qty', 'client_email_ref', 'Deposit', 'Billing']) expect(REGLES_LUME).toContain(piege);
    expect(REGLES_LUME).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('relecture après import test', () => {
  it('le bot relit les correspondances au statut test_review et refait le dry-run si ça change (source)', () => {
    const src = lu('server/lib/migration/bot.ts');
    const bloc = src.slice(src.indexOf("if (s === 'test_review')"), src.indexOf("if (s === 'ready_for_test')"));
    expect(bloc).toContain('proposerParModele(admin, m, acteur, rapport, mode)');
    expect(bloc).toContain("poserStatut(admin, m, 'ready_for_test', rapport)");
  });
  it('une proposition relue sans verdict est marquée et jamais re-soumise au modèle', () => {
    const src = lu('server/lib/migration/bot.ts');
    expect(src).toContain('PREFIXE_A_VERIFIER');
    expect(src).toContain("!dejaRelues.includes(mp)");
  });
});
