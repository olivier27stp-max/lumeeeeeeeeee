/**
 * Lumi apprend de l'équipe (2026-09-17) : 📌 dans Slack = retenu, jamais
 * relayé au client ; les réponses retenues entrent dans search_help ; un 👎
 * du client fait oublier la réponse mémorisée. Pur, sans Slack ni base.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { texteAApprendre, questionDuTicket } from '../../server/lib/support/savoir';
import { estNoteInterne } from '../../server/lib/support/relais-slack';
import { chercherAide, definirSavoir, passagesSavoir } from '../../server/lib/agent/tools-aide';

const racine = resolve(__dirname, '..', '..');

describe('texteAApprendre', () => {
  it('reconnaît 📌 et « Lumi, retiens » et rend le texte sans le marqueur', () => {
    expect(texteAApprendre('📌 Les rappels de rendez-vous par texto arrivent en octobre, en attendant c’est une automatisation « Job planifiée → SMS ».')).toBe('Les rappels de rendez-vous par texto arrivent en octobre, en attendant c’est une automatisation « Job planifiée → SMS ».');
    expect(texteAApprendre(':pushpin: Le calendrier Google n’est pas branché pour l’instant.')).toBe('Le calendrier Google n’est pas branché pour l’instant.');
    expect(texteAApprendre('Lumi, retiens : les modèles de courriel se changent dans Paramètres → Communication.')).toBe('les modèles de courriel se changent dans Paramètres → Communication.');
    expect(texteAApprendre('lumi retiens que la TVQ se règle dans Paramètres → Taxes')).toBe('la TVQ se règle dans Paramètres → Taxes');
    expect(texteAApprendre('📌 Lumi, retiens ça : on ne fait pas de PayPal pour l’instant.')).toBe('on ne fait pas de PayPal pour l’instant.');
  });
  it('ignore une vraie réponse au client, une note interne, ou un 📌 vide', () => {
    expect(texteAApprendre('Bonjour William, pour supprimer une tâche : Tâches → ligne → « Supprimer ».')).toBeNull();
    expect(texteAApprendre('🔒 on attend Oli')).toBeNull();
    expect(texteAApprendre('📌')).toBeNull();
    expect(texteAApprendre('📌 ok')).toBeNull();
  });
  it('un message à retenir est aussi une note interne : jamais relayé, même si l’apprentissage échoue', () => {
    expect(estNoteInterne('📌 Les rappels arrivent en octobre.')).toBe(true);
    expect(estNoteInterne('Lumi, retiens : pas de PayPal.')).toBe(true);
  });
  it('la question retenue est le premier message du client, sinon le sujet', () => {
    expect(questionDuTicket({ subject: 'Rappels' }, [{ author: 'ai', body: 'Bonjour' }, { author: 'user', body: '  Est-ce que je peux envoyer des rappels de rendez-vous par texto ? ' }])).toBe('Est-ce que je peux envoyer des rappels de rendez-vous par texto ?');
    expect(questionDuTicket({ subject: 'Rappels' }, [])).toBe('Rappels');
  });
});

describe('les réponses de l’équipe dans search_help', () => {
  it('une réponse retenue est trouvée en premier sur la question du client, avec son auteur ; sans savoir, rien ne change', () => {
    definirSavoir([]);
    const avant = chercherAide('rappels de rendez-vous par texto', 3);
    expect(avant.some((p) => /Réponse de l'équipe/.test(p.titre))).toBe(false);
    definirSavoir([{ question: 'Est-ce que je peux envoyer des rappels de rendez-vous par texto ?', reponse: 'Les rappels par texto arrivent en octobre ; en attendant, une automatisation « Job planifiée → SMS » fait le travail.', auteur: 'Rafba', date: '2026-09-17T12:00:00Z' }]);
    const apres = chercherAide('rappels de rendez-vous par texto', 3);
    expect(apres[0].titre).toMatch(/^Réponse de l'équipe Lume — Est-ce que je peux envoyer des rappels/);
    expect(apres[0].extrait).toContain('(Rafba, 2026-09-17)');
    expect(passagesSavoir()).toHaveLength(1);
    definirSavoir([]);
  });
});

describe('câblage', () => {
  const relais = readFileSync(resolve(racine, 'server', 'lib', 'support', 'relais-slack.ts'), 'utf8');
  const route = readFileSync(resolve(racine, 'server', 'routes', 'support.ts'), 'utf8');
  it('le relais retient AVANT de relayer, et la réaction 📌 est lue au relevé', () => {
    const apprend = relais.indexOf('const aApprendre = texteAApprendre(corps)');
    expect(apprend).toBeGreaterThan(0);
    expect(apprend).toBeLessThan(relais.indexOf('if (estNoteInterne(corps))'));
    expect(relais).toContain("x.name === 'pushpin'");
    expect(relais).toContain("return `learned:${verdict}`");
    // Marqué traité (message system) avant l'accusé : jamais deux 🧠 ni un message répété à chaque relevé ; un doublon reste silencieux.
    expect(relais.indexOf('await marquerTraiteSlack(admin, t, e.ts, `slack:retenu:${verdict}`)')).toBeLessThan(relais.indexOf('await accuserApprentissage(e.channel, e.ts, verdict)'));
    expect(readFileSync(resolve(racine, 'server', 'lib', 'support', 'savoir.ts'), 'utf8')).toContain("if (verdict === 'deja') return;");
  });
  it('un 👎 fait oublier la réponse mémorisée, entreprise et partagée, et seule une réponse de Lumi se note', () => {
    expect(route).toContain("router.post('/support/:id/messages/:mid/avis'");
    expect(route).toContain("if (!m || m.author !== 'ai') return res.status(404)");
    expect(route).toContain('oublierSemantique(PORTEE_CACHE_SUPPORT(auth.orgId), q.body), oublierSemantique(PORTEE_CACHE_SUPPORT_GLOBALE(ctx.langue), q.body)');
    expect(readFileSync(resolve(racine, 'server', 'index.ts'), 'utf8')).toContain('demarrerSavoir');
    expect(readFileSync(resolve(racine, 'server', 'lib', 'support', 'ia.ts'), 'utf8')).toContain("Réponse de l'équipe Lume");
  });
});
