/**
 * Ce que l'IA coûte, par entreprise ET par usage.
 *
 * `ai_usage` comptait déjà les tokens de Lumi. L'assistant de support, lui,
 * calculait son coût et le jetait dans un compteur en mémoire : personne ne
 * savait ce qu'il coûtait, ni par client ni au total.
 *
 * Ces tests figent trois promesses :
 *   · une ligne par APPEL à l'API, pas une par conversation ;
 *   · la surface publique n'impute rien à personne ;
 *   · une panne du journal ne casse JAMAIS la réponse à l'usager.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { journaliserUsage, type SourceUsage } from '../server/lib/lumi/budget';

/** Un client Supabase qui retient ce qu'on lui insère. */
function clientEspion(erreur: { message: string } | null = null) {
  const inserts: any[] = [];
  return {
    inserts,
    client: {
      from: (table: string) => ({
        insert: (ligne: any) => {
          inserts.push({ table, ligne });
          return Promise.resolve({ error: erreur });
        },
      }),
    } as any,
  };
}

const ligne = (o: Partial<Parameters<typeof journaliserUsage>[1]> = {}) => ({
  orgId: 'org-1',
  userId: 'user-1',
  conversationId: null,
  model: 'claude-sonnet-5',
  input_tokens: 120,
  output_tokens: 340,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 5600,
  cost_cents: 1.2345,
  ...o,
});

beforeEach(() => vi.restoreAllMocks());

describe('journaliserUsage', () => {
  it('écrit une ligne dans ai_usage avec le bon org', async () => {
    const e = clientEspion();
    await journaliserUsage(e.client, ligne());
    expect(e.inserts).toHaveLength(1);
    expect(e.inserts[0].table).toBe('ai_usage');
    expect(e.inserts[0].ligne.org_id).toBe('org-1');
  });

  it('impute la dépense à la bonne source', async () => {
    for (const source of ['lumi', 'support', 'migration', 'briefing', 'routeur', 'cache'] as SourceUsage[]) {
      const e = clientEspion();
      await journaliserUsage(e.client, ligne({ source }));
      expect(e.inserts[0].ligne.source, source).toBe(source);
    }
  });

  it('sans source : « lumi », parce que c’était le seul écrivain', async () => {
    // Le défaut garde les lignes d'avant cohérentes avec la colonne.
    const e = clientEspion();
    await journaliserUsage(e.client, ligne());
    expect(e.inserts[0].ligne.source).toBe('lumi');
  });

  it('garde les quatre compteurs de tokens, séparés', async () => {
    // Le cache lu et le cache écrit ne coûtent PAS le même prix : les
    // confondre fausserait le coût d'un facteur 12.
    const e = clientEspion();
    await journaliserUsage(e.client, ligne({ cache_creation_input_tokens: 4096, cache_read_input_tokens: 8192 }));
    const l = e.inserts[0].ligne;
    expect(l.input_tokens).toBe(120);
    expect(l.output_tokens).toBe(340);
    expect(l.cache_creation_input_tokens).toBe(4096);
    expect(l.cache_read_input_tokens).toBe(8192);
  });

  it('n’écrit AUCUN contenu : ni prompt, ni réponse, ni PII (loi 25)', async () => {
    const e = clientEspion();
    await journaliserUsage(e.client, ligne());
    const champs = Object.keys(e.inserts[0].ligne).sort();
    expect(champs).toEqual([
      'cache_creation_input_tokens', 'cache_read_input_tokens', 'conversation_id',
      'cost_cents', 'input_tokens', 'model', 'org_id', 'output_tokens', 'source', 'user_id',
    ]);
    // Aucun champ ne peut transporter du texte libre : que des compteurs,
    // un modèle, et des identifiants.
    for (const [k, v] of Object.entries(e.inserts[0].ligne)) {
      if (typeof v === 'string' && !['org-1', 'user-1', 'claude-sonnet-5', 'lumi'].includes(v)) {
        throw new Error(`champ texte inattendu : ${k} = ${v}`);
      }
    }
  });

  it('une panne du journal ne lève pas : l’usager reçoit sa réponse', async () => {
    // La règle d'or : le suivi de coût est du confort d'exploitation. Il ne
    // doit jamais coûter une réponse à quelqu'un qui attend.
    const e = clientEspion({ message: 'connexion perdue' });
    const erreurs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: any[]) => { erreurs.push(a.join(' ')); });
    await expect(journaliserUsage(e.client, ligne())).resolves.toBeUndefined();
    // L'échec est dit côté serveur, pas avalé en silence.
    expect(erreurs.join(' ')).toContain('ai_usage');
  });

  it('accepte une dépense sans personne identifiée', async () => {
    // Un briefing part d'un cron : il y a une org, pas d'utilisateur qui a
    // cliqué. Le journal doit l'accepter plutôt que de perdre la dépense.
    const e = clientEspion();
    await journaliserUsage(e.client, ligne({ userId: null, source: 'briefing' }));
    expect(e.inserts[0].ligne.user_id).toBeNull();
    expect(e.inserts[0].ligne.org_id).toBe('org-1');
  });
});

describe('une ligne par appel, pas par conversation', () => {
  it('trois appels d’une boucle d’outils font trois lignes', async () => {
    // Une conversation de support enchaîne les appels : c'est justement ce
    // qui coûte. Compter la conversation masquerait le vrai prix.
    const e = clientEspion();
    for (let i = 0; i < 3; i += 1) {
      await journaliserUsage(e.client, ligne({ source: 'support', cost_cents: 0.5 }));
    }
    expect(e.inserts).toHaveLength(3);
    expect(e.inserts.every((x) => x.ligne.source === 'support')).toBe(true);
  });
});
