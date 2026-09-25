/**
 * CLIQUETS — un visiteur qui remplit un formulaire public reçoit UN courriel,
 * sans lien de désabonnement.
 *
 * Constaté le 2026-09-24 dans une vraie boîte : deux accusés de réception
 * presque identiques arrivaient à la même minute, et le second portait
 * « Se désabonner de ces communications ».
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('un seul accusé de réception par soumission', () => {
  it('le préréglage « Lead — Welcome » ne se déclenche pas sur un formulaire', () => {
    /* Une soumission fait DEUX choses : elle envoie son propre accusé
       (request-forms.ts) et émet `lead.created`, qui déclenchait le préréglage.
       Deux courriels, même instant, même message.

       C'est le préréglage qu'on filtre, pas l'accusé direct : un lead créé à la
       main n'a que lui pour accuser réception (leads.ts n'envoie rien), et
       l'accusé direct part même si l'entreprise désactive ses automatisations. */
    const data = lire('server/lib/automationPresets.data.ts');
    const bloc = data.slice(data.indexOf('"preset_key": "welcome_new_lead"'));
    const conditions = bloc.slice(bloc.indexOf('"conditions"'), bloc.indexOf('"delay_seconds"'));
    expect(conditions).toContain('"source"');
    expect(conditions).toContain('"neq"');
    expect(conditions).toContain('request_form');
  });

  it('la soumission émet bien la source que la condition attend', () => {
    // Sans cette métadonnée, la condition ne filtrerait rien.
    const src = lire('server/routes/request-forms.ts');
    const emission = src.slice(src.indexOf("eventBus.emit('lead.created'"));
    expect(emission.slice(0, 400)).toContain("source: 'request_form'");
  });
});

describe('le désabonnement ne figure que sur un message commercial', () => {
  it('un courriel transactionnel n’a ni lien ni en-tête de désabonnement', () => {
    /* Quelqu'un qui vient de demander une soumission n'est sur aucune liste de
       diffusion — et s'il clique, il cesse aussi de recevoir ses factures.
       `ctx.commercial` fait déjà cette distinction pour le plafond de
       fréquence et la base légale. */
    const src = lire('server/lib/actions/index.ts');
    expect(src).toMatch(/const unsubUrl = ctx\.commercial \? await getUnsubscribeUrl/);
    // Les en-têtes suivent la même variable : ils disparaissent avec elle.
    const entetes = src.slice(src.indexOf("'List-Unsubscribe'") - 200, src.indexOf("'List-Unsubscribe'"));
    expect(entetes).toContain('unsubUrl');
  });
});

describe('le mode QA est visible depuis la santé', () => {
  it('/api/health signale une redirection de courriel active', () => {
    /* Le mode QA détourne TOUS les courriels et préfixe leur objet de
       « [QA → …] ». Il n'apparaissait que dans la bannière de démarrage :
       laissé actif après un audit, plus aucun client ne recevait rien. */
    const src = lire('server/index.ts');
    expect(src).toContain('qa_redirection');
    expect(src).toMatch(/qaRedirectActif\(\) \? qaRedirectResume\(\) : null/);
  });
});
