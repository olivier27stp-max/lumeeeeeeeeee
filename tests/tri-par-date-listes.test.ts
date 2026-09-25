/**
 * « La plus ancienne » / « la plus récente » dans Devis, Clients et Jobs.
 *
 * Les trois pages triaient déjà par date en coulisse — `QuoteSort` et
 * `ClientSort` déclaraient `oldest`, et `clientsApi` l'appliquait (order
 * created_at ascending) — mais aucun menu ne permettait de le choisir.
 *
 * Ces tests lisent le code source plutôt que de rendre les pages : les trois
 * composants tirent des dizaines de modules (contextes, API, dnd-kit), et un
 * rendu complet mesurerait surtout la capacité des mocks à tenir debout. Ce
 * qu'on veut figer ici est précis : les options existent, elles sont câblées
 * à un tri réel, et la clé utilisée existe côté données.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

const QUOTES = lire('src/pages/Quotes.tsx');
const CLIENTS = lire('src/pages/Clients.tsx');
const JOBS = lire('src/pages/Jobs.tsx');
const JOBS_API = lire('src/lib/jobsApi.ts');
const CLIENTS_API = lire('src/lib/clientsApi.ts');

describe('Devis — les deux options de date sont offertes', () => {
  it('le menu propose « La plus récente » et « La plus ancienne »', () => {
    expect(QUOTES).toContain("label: fr ? 'La plus récente' : 'Newest first'");
    expect(QUOTES).toContain("label: fr ? 'La plus ancienne' : 'Oldest first'");
  });

  it('choisir « oldest » pose bien le tri, sans retomber sur « recent »', () => {
    // Le piège : un onChange qui ignore la valeur et remet 'recent' par
    // défaut — le menu changerait d'étiquette sans rien trier.
    expect(QUOTES).toContain("v === 'oldest'");
  });

  it('le tri par ancienneté est réellement appliqué à la liste', () => {
    expect(QUOTES).toContain("if (sort === 'oldest')");
  });

  it('les tris par montant existent toujours', () => {
    // Non-régression : le menu portait « Croissant / Décroissant » avant.
    expect(QUOTES).toContain("label: fr ? 'Croissant' : 'Low to High'");
    expect(QUOTES).toContain("label: fr ? 'Décroissant' : 'High to Low'");
  });

  it('le libellé du menu ne dit plus « Montant » alors qu’il trie aussi par date', () => {
    expect(QUOTES).toContain("label={fr ? 'Trier' : 'Sort'}");
  });
});

describe('Clients — les deux options de date sont offertes', () => {
  it('le menu propose les deux sens', () => {
    expect(CLIENTS).toContain("label: fr ? 'Le plus récent' : 'Newest first'");
    expect(CLIENTS).toContain("label: fr ? 'Le plus ancien' : 'Oldest first'");
  });

  it('le choix passe par setSortBy, donc part à l’API', () => {
    expect(CLIENTS).toContain("setSortBy(v === 'oldest' ? 'oldest' : 'recent')");
    expect(CLIENTS).toContain('sort: sortBy');
  });

  it('l’API sait trier du plus ancien', () => {
    // Sans cette ligne, l'option existerait et ne ferait rien.
    expect(CLIENTS_API).toContain("query.sort === 'oldest'");
    expect(CLIENTS_API).toContain("order('created_at', { ascending: true })");
  });

  it('revenir à la page 1 : un tri inversé sur la page 3 n’a pas de sens', () => {
    expect(CLIENTS).toContain("setSortBy(v === 'oldest' ? 'oldest' : 'recent'); setPage(1);");
  });
});

describe('Jobs — les deux options de date sont offertes', () => {
  it('le menu propose les deux sens plus le défaut', () => {
    expect(JOBS).toContain("label: fr ? 'La plus récente' : 'Newest first'");
    expect(JOBS).toContain("label: fr ? 'La plus ancienne' : 'Oldest first'");
    expect(JOBS).toContain("label: fr ? 'Par défaut' : 'Default'");
  });

  it('chaque sens pose la bonne direction', () => {
    // Jobs trie par (clé, direction) : une option qui oublierait la direction
    // afficherait « la plus ancienne » en montrant la plus récente.
    expect(JOBS).toContain("setSortBy('created_at'); setSortDirection('desc');");
    expect(JOBS).toContain("setSortBy('created_at'); setSortDirection('asc');");
  });

  it('« Par défaut » revient au tri d’origine (par visite, croissant)', () => {
    expect(JOBS).toContain("setSortBy('schedule'); setSortDirection('asc');");
  });

  it('la clé created_at existe dans le type ET dans la carte de tri', () => {
    // Une clé absente de SORT_MAP donnerait `order(undefined)` : PostgREST
    // rejetterait la requête et la liste resterait vide, sans erreur visible.
    expect(JOBS_API).toContain("| 'created_at'");
    expect(JOBS_API).toMatch(/SORT_MAP[\s\S]*created_at: 'created_at'/);
  });

  it('les tris par en-tête de colonne restent intacts', () => {
    // Non-régression : le menu s'ajoute, il ne remplace pas.
    for (const cle of ['client_name', 'job_number', 'scheduled_at', 'status', 'total_cents']) {
      expect(JOBS_API, cle).toContain(cle);
    }
  });
});
