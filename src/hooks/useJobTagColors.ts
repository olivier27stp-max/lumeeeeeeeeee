import { useEffect, useMemo, useState } from 'react';
import { listJobTags, JobTagRecord } from '../lib/jobTagsApi';

/**
 * Tags de jobs pour le calendrier : charge les tags de l'org une fois et
 * expose `firstTagFor(tag_ids)` — nom + couleur du PREMIER tag assigné
 * (ordre de jobs.tag_ids), ou null si la job n'a aucun tag.
 */
export function useJobTagColors() {
  const [tags, setTags] = useState<JobTagRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void listJobTags().then((rows) => { if (alive) setTags(rows); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const byId = useMemo(() => new Map(tags.map((tg) => [tg.id, tg])), [tags]);

  return useMemo(() => ({
    firstTagFor(tagIds: string[] | null | undefined): { name: string; hex: string } | null {
      if (!tagIds?.length) return null;
      for (const id of tagIds) {
        const tag = byId.get(id);
        if (tag) return { name: tag.name, hex: tag.color_hex };
      }
      return null;
    },
  }), [byId]);
}
