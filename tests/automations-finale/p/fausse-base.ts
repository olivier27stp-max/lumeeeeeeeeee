/**
 * Agent P — une fausse base, en mémoire, qui parle comme le client Supabase :
 * `from(table).select(…).eq(…).in(…).order(…).range(…)`, `insert`, `update`.
 *
 * Elle ne sait faire que ce dont le ciblage, les doublons, les conflits et leurs
 * routes se servent. Ce qu'elle imite de la VRAIE base, parce que le code en dépend :
 *   · la pagination (`range`) — pour éprouver les carnets de plus de 1 000 fiches ;
 *   · l'index unique `(org_id, execution_key) where scheduled_task_id is null` de
 *     `automation_execution_logs` — une seconde insertion rend l'erreur 23505 ;
 *   · une panne de lecture ou d'écriture par table (`pannes`, `pannesEcriture`).
 * Les preuves contre la vraie base sont dans `integration/` (pile locale).
 */
type Ligne = Record<string, unknown>;
type Erreur = { message: string; code?: string };

export class FausseBase {
  tables: Record<string, Ligne[]> = {};
  /** Lecture ratée, par table : l'erreur que PostgREST rendrait. */
  pannes: Record<string, Erreur> = {};
  pannesEcriture: Record<string, Erreur> = {};
  /** Nombre de requêtes de LECTURE exécutées, par table. */
  lectures: Record<string, number> = {};
  ecritures: Array<{ table: string; genre: 'insert' | 'update'; valeurs: Ligne }> = [];
  private compteur = 0;

  constructor(tables: Record<string, Ligne[]> = {}) {
    this.tables = structuredClone(tables);
  }

  lignes(table: string): Ligne[] {
    return (this.tables[table] ??= []);
  }

  totalLectures(): number {
    return Object.values(this.lectures).reduce((a, b) => a + b, 0);
  }

  /** Le « client Supabase » à passer au code testé. */
  get client(): any {
    return { from: (table: string) => new Requete(this, table) };
  }

  nouvelId(): string {
    this.compteur += 1;
    return `00000000-0000-4000-8000-${String(this.compteur).padStart(12, '0')}`;
  }
}

/** Lit `a->b->>c` ou `a` dans une ligne. */
function lire(ligne: Ligne, colonne: string): unknown {
  const morceaux = colonne.split(/->>?/);
  let v: unknown = ligne;
  for (const m of morceaux) v = v && typeof v === 'object' ? (v as Ligne)[m] : undefined;
  return v;
}

class Requete {
  private filtres: Array<(l: Ligne) => boolean> = [];
  private tri: Array<{ colonne: string; croissant: boolean }> = [];
  private plage: [number, number] | null = null;
  private limite: number | null = null;
  private ecriture: { genre: 'insert' | 'update'; valeurs: Ligne | Ligne[] } | null = null;
  private veutLignes = false;
  private compte = false;

  constructor(private base: FausseBase, private table: string) {}

  select(_colonnes?: string, options?: { count?: string; head?: boolean }) {
    if (this.ecriture) this.veutLignes = true;
    if (options?.count) this.compte = true;
    return this;
  }
  insert(valeurs: Ligne | Ligne[]) { this.ecriture = { genre: 'insert', valeurs }; return this; }
  update(valeurs: Ligne) { this.ecriture = { genre: 'update', valeurs }; return this; }

  private filtre(colonne: string, test: (v: unknown) => boolean) {
    // `clients.org_id` (jointure `clients!inner(org_id)`) : la colonne du client de la ligne.
    const jointure = /^clients\.(\w+)$/.exec(colonne);
    this.filtres.push((l) => {
      if (!jointure) return test(lire(l, colonne));
      const client = this.base.lignes('clients').find((c) => c.id === l.client_id);
      return !!client && test(client[jointure[1]]);
    });
    return this;
  }
  eq(colonne: string, valeur: unknown) { return this.filtre(colonne, (v) => v === valeur); }
  neq(colonne: string, valeur: unknown) { return this.filtre(colonne, (v) => v !== valeur); }
  is(colonne: string, valeur: unknown) { return this.filtre(colonne, (v) => (valeur === null ? v === null || v === undefined : v === valeur)); }
  not(colonne: string, _op: string, valeur: unknown) { return this.filtre(colonne, (v) => (valeur === null ? v !== null && v !== undefined : v !== valeur)); }
  in(colonne: string, valeurs: unknown[]) { return this.filtre(colonne, (v) => valeurs.includes(v)); }
  gte(colonne: string, valeur: string | number) { return this.filtre(colonne, (v) => v !== null && v !== undefined && (v as string | number) >= valeur); }
  lt(colonne: string, valeur: string | number) { return this.filtre(colonne, (v) => v !== null && v !== undefined && (v as string | number) < valeur); }
  like(colonne: string, motif: string) {
    const re = new RegExp(`^${motif.split('%').map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return this.filtre(colonne, (v) => typeof v === 'string' && re.test(v));
  }
  order(colonne: string, options?: { ascending?: boolean }) { this.tri.push({ colonne, croissant: options?.ascending !== false }); return this; }
  range(de: number, a: number) { this.plage = [de, a]; return this; }
  limit(n: number) { this.limite = n; return this; }

  private executer(): { data: Ligne[] | null; error: Erreur | null; count?: number } {
    if (this.ecriture) {
      const panne = this.base.pannesEcriture[this.table];
      if (panne) return { data: null, error: panne };
      if (this.ecriture.genre === 'insert') {
        const nouvelles = (Array.isArray(this.ecriture.valeurs) ? this.ecriture.valeurs : [this.ecriture.valeurs]).map((v) => structuredClone(v));
        for (const n of nouvelles) {
          // L'index unique de la vraie base : (org_id, execution_key) where scheduled_task_id is null.
          if (this.table === 'automation_execution_logs' && n.execution_key != null && n.scheduled_task_id == null
            && this.base.lignes(this.table).some((l) => l.org_id === n.org_id && l.execution_key === n.execution_key && l.scheduled_task_id == null)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_execution_logs_immediat_dedup"' } };
          }
          n.id ??= this.base.nouvelId();
          n.created_at ??= new Date().toISOString();
          this.base.lignes(this.table).push(n);
          this.base.ecritures.push({ table: this.table, genre: 'insert', valeurs: structuredClone(n) });
        }
        return { data: this.veutLignes ? structuredClone(nouvelles) : null, error: null };
      }
      const touchees = this.base.lignes(this.table).filter((l) => this.filtres.every((f) => f(l)));
      for (const l of touchees) Object.assign(l, structuredClone(this.ecriture.valeurs));
      this.base.ecritures.push({ table: this.table, genre: 'update', valeurs: structuredClone(this.ecriture.valeurs as Ligne) });
      return { data: this.veutLignes ? structuredClone(touchees) : null, error: null };
    }
    this.base.lectures[this.table] = (this.base.lectures[this.table] ?? 0) + 1;
    const panne = this.base.pannes[this.table];
    if (panne) return { data: null, error: panne };
    let lignes = this.base.lignes(this.table).filter((l) => this.filtres.every((f) => f(l)));
    for (const { colonne, croissant } of [...this.tri].reverse()) {
      lignes = [...lignes].sort((x, y) => {
        const [a, b] = [lire(x, colonne), lire(y, colonne)] as [string | number, string | number];
        return (a < b ? -1 : a > b ? 1 : 0) * (croissant ? 1 : -1);
      });
    }
    const total = lignes.length;
    if (this.plage) lignes = lignes.slice(this.plage[0], this.plage[1] + 1);
    if (this.limite !== null) lignes = lignes.slice(0, this.limite);
    return { data: structuredClone(lignes), error: null, ...(this.compte ? { count: total } : {}) };
  }

  maybeSingle() {
    const r = this.executer();
    return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
  }
  single() {
    const r = this.executer();
    if (!r.error && !r.data?.[0]) return Promise.resolve({ data: null, error: { message: 'aucune ligne', code: 'PGRST116' } });
    return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
  }
  then<T>(resoudre: (v: { data: Ligne[] | null; error: Erreur | null; count?: number }) => T, rejeter?: (e: unknown) => T) {
    return Promise.resolve().then(() => this.executer()).then(resoudre, rejeter);
  }
}

/** Un identifiant lisible et stable : `id('client', 3)`. */
export function uuid(n: number, genre = 0): string {
  return `${String(genre).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}
