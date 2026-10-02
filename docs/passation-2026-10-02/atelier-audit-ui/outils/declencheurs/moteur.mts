// Jetable : l'évaluateur du moteur s'importe-t-il sans effet de bord ?
const t = Date.now();
const m = await import('../../wt/server/lib/automationEngine.ts');
console.log('importé en', Date.now() - t, 'ms', typeof m.evaluateConditions);
const ev = (metadata: Record<string, unknown>) => ({ type: 'quote.sent', orgId: 'o', entityType: 'quote', entityId: 'e', metadata }) as never;
console.log(m.evaluateConditions({ statut: 'envoye', source: { neq: 'web' }, total_cents: { gt: 500000 } }, ev({ statut: 'envoye', source: 'fb', total_cents: 600000 })));
console.log(m.evaluateConditions({ ouverture: 'premiere' }, ev({ client_name: 'x' })));
process.exit(0);
