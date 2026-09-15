// Compte les tokens exacts du prompt du support (API count_tokens), bloc stable (cache 1 h) et bloc variable (dossier type) :
//   node --env-file=.env.local --import tsx scripts/qa/compter-tokens-support.mts
import Anthropic from '@anthropic-ai/sdk';
import { promptsPourMesure, MODELE_SUPPORT } from '../../server/lib/support/ia';

const c = new Anthropic();
const dossierType = `Entreprise : Plomberie Tremblay — compte créé le 2026-03-02 (197 jours), 5 employés déclarés.
Abonnement : forfait Scale, statut active, mensuel, période en cours jusqu'au 2026-10-02.
Réglages : configuration initiale terminée, industrie plomberie, Québec, fuseau America/Toronto, langue fr ; avis Google configurés.
Personnes : 4 utilisateurs (1 owner, 1 admin, 2 technician), 6 membres d'équipe terrain.
Données : 212 clients, 340 jobs, 88 devis, 260 factures ; 9 factures avec un solde dû.
Automatisations : 12 règles, 9 actives.
Paiements : Stripe activé, PayPal non activé, défaut stripe ; Lume Payments (Stripe Connect) : inscription terminée, encaissements actifs, virements actifs.
Migration de données : aucune migration en cours ni passée.
Demandes de support récentes : « Comment changer mon forfait ? » (fermée, 2026-09-10).`;
for (const langue of ['fr', 'en'] as const) {
  const { stable, variable } = promptsPourMesure(langue, 'app', dossierType);
  const s = await c.messages.countTokens({ model: MODELE_SUPPORT, system: stable, messages: [{ role: 'user', content: 'x' }] });
  const v = await c.messages.countTokens({ model: MODELE_SUPPORT, system: variable, messages: [{ role: 'user', content: 'x' }] });
  console.log(`${langue} — bloc stable (cache 1 h) : ${stable.length} car. → ${s.input_tokens} tokens ; bloc variable (dossier) : ${variable.length} car. → ${v.input_tokens} tokens`);
}
console.log('Rappel tarif Sonnet 5 : lecture en cache = 10 % du prix d’entrée ; le bloc stable est partagé par toutes les entreprises (une écriture de cache par heure, par langue).');
