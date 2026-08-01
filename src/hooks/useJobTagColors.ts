import { useEffect, useMemo, useState } from 'react';
import { listJobTags, JobTagRecord } from '../lib/jobTagsApi';

/**
 * Couleurs des tags de jobs pour le calendrier : charge les tags de l'org une
 * fois et expose `colorForTagIds(tag_ids)` — la couleur du PREMIER tag assigné
 * (ordre de jobs.tag_ids), ou null si la job n'a aucun tag.
 */
export function useJobTagColors() {
  const [tags, setTags] = useState<JobTagRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void listJobTags().then((rows) => { if (alive) setTags(rows); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const byId = useMemo(() => new Map(tags.map((tg) => [tg.id, tg.color_hex])), [tags]);

  return useMemo(() => ({
    colorForTagIds(tagIds: string[] | null | undefined): string | null {
      if (!tagIds?.length) return null;
      for (const id of tagIds) {
        const hex = byId.get(id);
        if (hex) return hex;
      }
      return null;
    },
  }), [byId]);
}
