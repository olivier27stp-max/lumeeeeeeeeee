// Export CSV des lignes rejetées/exclues d'une migration. Partagé entre la
// console admin et le portail client (les données sont celles du bureau —
// il a le droit de récupérer SES lignes en erreur pour les corriger).
// `ligne_excel` = ligne du fichier ouvert dans Excel (en-tête = ligne 1) :
// l'audit S13 a montré que le numéro de ligne de données seul faisait chercher
// le client à la mauvaise ligne.

import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE = 1000;

function esc(v: unknown): string {
  const str = String(v ?? '');
  // anti-injection de formule + guillemets CSV
  const safe = /^[=+\-@\t\r]/.test(str) && !/^-?\d/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function buildRejectsCsv(
  admin: SupabaseClient,
  migrationId: string,
): Promise<{ csv: string; rows: number }> {
  const { data: files } = await admin
    .from('migration_files')
    .select('id, original_name')
    .eq('migration_id', migrationId);
  const fileName = new Map((files ?? []).map((f: { id: string; original_name: string }) => [f.id, f.original_name]));

  const lines: string[] = ['fichier,ligne_excel,ligne_donnees,entite,statut,erreur,donnees_source_json'];
  for (let offset = 0; ; offset += PAGE) {
    const { data: rows, error } = await admin
      .from('migration_staging_records')
      .select('file_id, row_number, entity_type, status, error, payload')
      .eq('migration_id', migrationId)
      .in('status', ['error', 'orphan'])
      .order('file_id')
      .order('row_number')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      lines.push([
        esc(fileName.get(r.file_id) ?? r.file_id),
        esc(r.row_number + 1), // + ligne d'en-tête : correspond à la ligne Excel
        esc(r.row_number),
        esc(r.entity_type),
        esc(r.status),
        esc(r.error ?? ''),
        esc(JSON.stringify(r.payload ?? {})),
      ].join(','));
    }
    if (rows.length < PAGE) break;
  }
  return { csv: `\uFEFF${lines.join('\n')}`, rows: lines.length - 1 };
}
