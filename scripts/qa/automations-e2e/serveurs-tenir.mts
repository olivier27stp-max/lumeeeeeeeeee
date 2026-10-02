/**
 * Démarre l'API et Vite de la pile locale (même code que la suite : harnais/serveurs-ui.ts) et les
 * garde debout jusqu'à l'arrêt du processus. Lancé par serveurs.mjs, jamais seul.
 */
import setup from '../../../tests/automations-suite/harnais/serveurs-ui';

const arreter = await setup({ provide: () => undefined } as never);
console.log(`[serveurs] API et Vite prêts (${process.env.E2E_BASE}) — Ctrl+C pour arrêter.`);
const finir = async () => { await arreter?.(); process.exit(0); };
process.once('SIGINT', finir);
process.once('SIGTERM', finir);
setInterval(() => undefined, 1 << 30);
