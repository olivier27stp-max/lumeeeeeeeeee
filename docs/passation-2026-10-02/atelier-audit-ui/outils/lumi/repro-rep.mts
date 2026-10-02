/**
 * Rejoue la demande réelle de Rafba (prod, 2026-10-01 10 h 59) sur le vrai modèle, bureau de test staging.
 *   cd D:/lume-uiaudit/wt-lumi && node --env-file=.env.local node_modules/tsx/dist/cli.mjs ../outils/lumi/repro-rep.mts [n]
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { genererParcours } from '../../wt-lumi/server/lib/lumi/generer-parcours';

const url = process.env.VITE_SUPABASE_URL!;
if (url.includes('bbzcuzqfgsdvjsymfwmr')) throw new Error('REFUS : staging seulement');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const e = JSON.parse(readFileSync('D:/lume-uiaudit/sorties/serveurs.json', 'utf8'));
const DEMANDE = 'fais un message pour notifier le rep en questions qui a envoye le devis';
const TEXTO_DEFAUT = { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_name], c’est [company_name]. Merci !' } }, suivant: null };

const scenarios: Array<{ nom: string; parcoursActuel: { trigger_event?: string; steps?: unknown[] } | null }> = [
  { nom: 'A. devis consulté + texto par défaut dans le canevas', parcoursActuel: { trigger_event: 'quote.viewed', steps: [TEXTO_DEFAUT] } },
  { nom: 'B. devis envoyé + texto par défaut dans le canevas', parcoursActuel: { trigger_event: 'quote.sent', steps: [TEXTO_DEFAUT] } },
  { nom: 'C. canevas vide', parcoursActuel: null },
];
const n = Number(process.argv[2] || 1);
for (const s of scenarios) {
  for (let i = 0; i < n; i++) {
    const r = await genererParcours({ admin: admin as never, orgId: e.orgA, userId: e.comptes.proprioA.id, demande: DEMANDE, langue: 'fr', echanges: [], parcoursActuel: s.parcoursActuel } as never);
    const p = (r as { parcours?: { nom?: string; trigger_event?: string; resume?: string; steps?: Array<Record<string, unknown>> } | null; erreur?: string }).parcours;
    console.log(`\n=== ${s.nom} (essai ${i + 1})`);
    if (!p) { console.log('  ERREUR / QUESTION :', JSON.stringify(r).slice(0, 500)); continue; }
    console.log('  nom :', p.nom, '| déclencheur :', p.trigger_event);
    console.log('  réponse de Lumi :', JSON.stringify(p.resume));
    for (const st of p.steps ?? []) {
      const a = st.action as { type?: string; config?: Record<string, unknown> } | undefined;
      console.log('   -', st.type, a ? `${a.type} ${JSON.stringify(a.config).slice(0, 230)}` : JSON.stringify(st).slice(0, 160));
    }
  }
}
