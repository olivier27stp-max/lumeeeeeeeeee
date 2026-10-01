/**
 * Contrat SSE de Lumi, côté lecture. C'est ici qu'une rupture de contrat
 * serveur doit se voir — pas à l'écran, en NaN.
 *
 * Ce que le serveur a changé le 2026-09-30 (PR #817/#824) :
 *  - `done` porte `credits` (EtatCredits) et plus `cost_cents` ni `budget` ;
 *  - `usage` n'a plus `cost_cents` ;
 *  - un 403 `plan_sans_lumi` joint `credits` et plus `budget`.
 */
import { ErreurLumi, lireFlux, type EvenementFlux } from './lumi';

const CREDITS = {
  inclus: true,
  total: 1000,
  utilises: 258,
  restants: 742,
  pourcentage: 26,
  renouvellement_le: '2026-11-12',
  palier: 'normal' as const,
  avertissement: null,
};

/** Une fausse Response SSE : les morceaux arrivent comme sur le réseau. */
function fluxSSE(morceaux: string[], ok = true, corps?: unknown): Response {
  const encodeur = new TextEncoder();
  let i = 0;
  return {
    ok,
    status: ok ? 200 : 403,
    json: async () => corps ?? {},
    body: {
      getReader: () => ({
        read: async () => (i < morceaux.length ? { value: encodeur.encode(morceaux[i++]), done: false } : { value: undefined, done: true }),
        cancel: async () => {},
      }),
    },
  } as unknown as Response;
}

const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

async function evenements(morceaux: string[]): Promise<EvenementFlux[]> {
  const recus: EvenementFlux[] = [];
  await lireFlux(fluxSSE(morceaux), (e) => recus.push(e));
  return recus;
}

describe('événement done', () => {
  it('porte les crédits, lisibles tels quels', async () => {
    const recus = await evenements([ev('done', { conversation_id: 'c1', credits: CREDITS, proposal: null })]);
    expect(recus).toHaveLength(1);
    const done = recus[0] as Extract<EvenementFlux, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.conversation_id).toBe('c1');
    expect(done.credits).toEqual(CREDITS);
    expect(done.credits.restants).toBe(742);
    expect(done.credits.renouvellement_le).toBe('2026-11-12');
  });

  it('ne transporte plus ni cost_cents ni budget', async () => {
    const recus = await evenements([ev('done', { conversation_id: 'c1', credits: CREDITS, proposal: null })]);
    expect(recus[0]).not.toHaveProperty('cost_cents');
    expect(recus[0]).not.toHaveProperty('budget');
  });

  it('un done sans crédits ne casse pas la lecture', async () => {
    // Serveur plus vieux, ou crédits indisponibles : l'app garde son dernier état.
    const recus = await evenements([ev('done', { conversation_id: 'c1', proposal: null })]);
    expect((recus[0] as { credits?: unknown }).credits).toBeUndefined();
    expect(recus[0].type).toBe('done');
  });

  it('un avertissement à 80 % puis à 100 % se lit dans done', async () => {
    const recus = await evenements([
      ev('done', { conversation_id: 'c1', credits: { ...CREDITS, restants: 150, utilises: 850, pourcentage: 85, avertissement: '80' }, proposal: null }),
      ev('done', { conversation_id: 'c1', credits: { ...CREDITS, restants: 0, utilises: 1000, pourcentage: 100, avertissement: '100', palier: 'epuise' }, proposal: null }),
    ]);
    const a = recus[0] as Extract<EvenementFlux, { type: 'done' }>;
    const b = recus[1] as Extract<EvenementFlux, { type: 'done' }>;
    expect(a.credits.avertissement).toBe('80');
    expect(b.credits.avertissement).toBe('100');
    expect(b.credits.palier).toBe('epuise');
  });
});

describe('événement usage', () => {
  it('porte le modèle et les tokens, sans coût', async () => {
    const recus = await evenements([ev('usage', { model: 'claude-sonnet-5', usage: { input_tokens: 120, output_tokens: 40 } })]);
    const u = recus[0] as Extract<EvenementFlux, { type: 'usage' }>;
    expect(u.model).toBe('claude-sonnet-5');
    expect(u.usage?.input_tokens).toBe(120);
    expect(recus[0]).not.toHaveProperty('cost_cents');
  });
});

describe('lecture du flux', () => {
  it('découpe plusieurs événements d un même morceau', async () => {
    const recus = await evenements([
      ev('text', { delta: 'Salut' }) + ev('text', { delta: ' !' }),
      ev('done', { conversation_id: 'c1', credits: CREDITS, proposal: null }),
    ]);
    expect(recus.map((e) => e.type)).toEqual(['text', 'text', 'done']);
  });

  it('recolle un événement coupé entre deux morceaux', async () => {
    const entier = ev('done', { conversation_id: 'c1', credits: CREDITS, proposal: null });
    const coupe = Math.floor(entier.length / 2);
    const recus = await evenements([entier.slice(0, coupe), entier.slice(coupe)]);
    expect(recus).toHaveLength(1);
    expect((recus[0] as Extract<EvenementFlux, { type: 'done' }>).credits.restants).toBe(742);
  });

  it('ignore un événement illisible sans perdre les suivants', async () => {
    const recus = await evenements(['event: done\ndata: {pas du json\n\n' + ev('text', { delta: 'ok' })]);
    expect(recus.map((e) => e.type)).toEqual(['text']);
  });

  it('un flux fermé sans aucun événement est une coupure, pas une réponse vide', async () => {
    await expect(evenements([])).rejects.toMatchObject({ code: 'flux_coupe' });
  });
});

describe('403 plan_sans_lumi', () => {
  it('joint les crédits à l erreur, plus le budget', async () => {
    const corps = { code: 'plan_sans_lumi', error: 'Lumi is not included in this plan.', credits: { ...CREDITS, inclus: false } };
    await expect(lireFlux(fluxSSE([], false, corps), () => {})).rejects.toThrow(ErreurLumi);
    // `lireFlux` ne renvoie rien quand il réussit : on force le type de la
    // valeur rejetée, sinon TS voit `void | ErreurLumi`.
    const err = (await lireFlux(fluxSSE([], false, corps), () => {}).then(
      () => null,
      (e: ErreurLumi) => e,
    )) as ErreurLumi;
    expect(err.code).toBe('plan_sans_lumi');
    expect(err.credits?.inclus).toBe(false);
    expect(err).not.toHaveProperty('budget');
  });
});
