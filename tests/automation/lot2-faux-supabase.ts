/**
 * Faux client Supabase des tests serveur du lot 2 (audit du 2026-10-01).
 *
 * Il tient des tables en mémoire et applique POUR VRAI ce que la route
 * demande : filtres (`eq`, `neq`, `in`, `is null`, `not is null`), tri,
 * limite, insertion, mise à jour, suppression. Il répond comme PostgREST
 * quand `.single()` ne trouve pas exactement une ligne (PGRST116). Chaque
 * écriture réellement appliquée est notée dans `ecritures` : un test peut
 * affirmer « rien n'a été écrit ».
 *
 * Une méthode de requête que le faux client ne connaît pas lève une erreur
 * (propriété absente) : un filtre ajouté à une route ne passe jamais
 * inaperçu.
 */

export type Ligne = Record<string, unknown>;
export interface Ecriture { table: string; op: 'update' | 'insert' | 'delete'; ids: unknown[]; valeurs: Ligne }

const PGRST116 = { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' };

export function creerFausseBase() {
  const etat = {
    tables: {} as Record<string, Ligne[]>,
    ecritures: [] as Ecriture[],
    /** Identifiant d'une ligne qui DISPARAÎT de la base juste après avoir été lue. */
    disparaitApresLecture: null as string | null,
    /** Tables lues ou écrites, dans l'ordre (pour affirmer « jamais lu »). */
    acces: [] as string[],
  };

  const client = () => ({
    from: (table: string) => {
      etat.acces.push(table);
      const filtres: Array<(l: Ligne) => boolean> = [];
      let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
      let valeurs: Ligne | Ligne[] = {};
      let tri: { col: string; croissant: boolean } | null = null;
      let limite: number | null = null;
      const lignes = () => (etat.tables[table] ??= []);

      const executer = (): Ligne[] => {
        if (op === 'insert') {
          const aInserer = Array.isArray(valeurs) ? valeurs : [valeurs];
          const nouvelles = aInserer.map((v) => ({ id: `nouvelle-${lignes().length + 1}`, deleted_at: null, purged_at: null, ...v }));
          for (const n of nouvelles) {
            lignes().push(n);
            etat.ecritures.push({ table, op: 'insert', ids: [n.id], valeurs: n });
          }
          return nouvelles;
        }
        let visees = lignes().filter((l) => filtres.every((f) => f(l)));
        if (op === 'update') {
          if (visees.length) {
            for (const l of visees) Object.assign(l, valeurs);
            etat.ecritures.push({ table, op, ids: visees.map((l) => l.id), valeurs: valeurs as Ligne });
          }
          return visees;
        }
        if (op === 'delete') {
          if (visees.length) {
            etat.tables[table] = lignes().filter((l) => !visees.includes(l));
            etat.ecritures.push({ table, op, ids: visees.map((l) => l.id), valeurs: {} });
          }
          return visees;
        }
        if (tri) {
          const { col, croissant } = tri;
          visees = [...visees].sort((a, b) => {
            const x = String(a[col] ?? '');
            const y = String(b[col] ?? '');
            return (x < y ? -1 : x > y ? 1 : 0) * (croissant ? 1 : -1);
          });
        }
        if (limite !== null) visees = visees.slice(0, limite);
        if (etat.disparaitApresLecture) {
          const id = etat.disparaitApresLecture;
          if (visees.some((l) => l.id === id)) {
            // Copie rendue à l'appelant ; la ligne, elle, n'existe plus.
            const copies = visees.map((l) => ({ ...l }));
            etat.tables[table] = lignes().filter((l) => l.id !== id);
            etat.disparaitApresLecture = null;
            return copies;
          }
        }
        return visees;
      };

      const q = {
        select: () => q,
        order: (col: string, options?: { ascending?: boolean }) => {
          // Premier tri seulement : c'est lui qui décide de l'ordre.
          tri ??= { col, croissant: options?.ascending !== false };
          return q;
        },
        limit: (n: number) => { limite = n; return q; },
        insert: (v: Ligne | Ligne[]) => { op = 'insert'; valeurs = v; return q; },
        update: (v: Ligne) => { op = 'update'; valeurs = v; return q; },
        delete: () => { op = 'delete'; return q; },
        eq: (col: string, v: unknown) => { filtres.push((l) => l[col] === v); return q; },
        neq: (col: string, v: unknown) => { filtres.push((l) => l[col] !== v); return q; },
        in: (col: string, vs: unknown[]) => { filtres.push((l) => vs.includes(l[col])); return q; },
        is: (col: string, v: unknown) => { filtres.push((l) => (l[col] ?? null) === v); return q; },
        not: (col: string, operateur: string, v: unknown) => {
          if (operateur !== 'is' || v !== null) throw new Error(`faux client : not(${col}, ${operateur}) non simulé`);
          filtres.push((l) => (l[col] ?? null) !== null);
          return q;
        },
        maybeSingle: async () => {
          const r = executer();
          if (r.length > 1) return { data: null, error: PGRST116 };
          return { data: r[0] ?? null, error: null };
        },
        single: async () => {
          const r = executer();
          if (r.length !== 1) return { data: null, error: PGRST116 };
          return { data: r[0], error: null };
        },
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve({ data: executer(), error: null }).then(ok, ko),
      };
      return q;
    },
  });

  return { etat, client };
}
