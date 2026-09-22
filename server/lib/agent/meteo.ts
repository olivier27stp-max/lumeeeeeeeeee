/**
 * Météo côté serveur, pour Lumi (2026-09-22).
 * ────────────────────────────────────────────
 * La météo existait déjà dans l'app — bandeau d'accueil, `src/lib/weatherApi.ts` —
 * mais uniquement côté NAVIGATEUR : Lumi n'y avait pas accès. Il répondait donc
 * « je ne sais pas » à « est-ce qu'il va pleuvoir demain », alors que la page
 * d'accueil du site promet « Pluie annoncée ? Lumi propose le déplacement ».
 *
 * Pourquoi ça compte ici et pas ailleurs : les clients de Lume lavent des
 * vitres, posent des toitures, font du paysagement. La pluie n'est pas une
 * information d'agrément, c'est ce qui décide si la journée a lieu.
 *
 * Source : Open-Meteo — gratuit, sans clé, déjà autorisé dans la CSP. Pour une
 * org canadienne on force les modèles d'Environnement Canada (`gem_seamless`,
 * dont HRDPS à 2,5 km) : la prévision de précipitations y est nettement plus
 * juste que le mélange global. Même choix que le bandeau de l'app.
 *
 * Ce module ne fait que LIRE une API publique : aucune donnée de l'org n'en
 * sort, seulement des coordonnées.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';

/** Une heure de prévision, telle que Lumi la lit. */
export interface HeureMeteo {
  heure: string;        // ISO
  temp_c: number;
  precipitation_pct: number;
  precipitation_mm: number;
  vent_kmh: number;
  ciel: string;
}

export interface PrevisionMeteo {
  ville: string;
  maintenant: HeureMeteo | null;
  heures: HeureMeteo[];
  max_c: number;
  min_c: number;
  precipitation_mm_total: number;
  vent_max_kmh: number;
  /** Verdict travail extérieur — la seule chose que l'utilisateur veut vraiment savoir. */
  travail_exterieur: 'bon' | 'variable' | 'mauvais';
  resume: string;
}

/** Code WMO → libellé court. Même table que le bandeau de l'app. */
export function libelleCiel(code: number): string {
  if (code === 0) return 'ciel dégagé';
  if (code <= 2) return 'peu nuageux';
  if (code === 3) return 'couvert';
  if (code >= 45 && code <= 48) return 'brouillard';
  if (code >= 51 && code <= 57) return 'bruine';
  if (code >= 61 && code <= 67) return 'pluie';
  if (code >= 71 && code <= 77) return 'neige';
  if (code >= 80 && code <= 82) return 'averses';
  if (code >= 85 && code <= 86) return 'averses de neige';
  if (code >= 95) return 'orage';
  return 'variable';
}

/**
 * Verdict travail extérieur — mêmes seuils que `outdoorWorkVerdict` côté app,
 * pour que Lumi et le bandeau ne se contredisent jamais.
 */
export function verdictTravailExterieur(precipMm: number, ventMaxKmh: number): 'bon' | 'variable' | 'mauvais' {
  if (precipMm >= 5 || ventMaxKmh >= 45) return 'mauvais';
  if (precipMm >= 1 || ventMaxKmh >= 30) return 'variable';
  return 'bon';
}

interface Lieu { lat: number; lng: number; ville: string; pays: string | null }

/**
 * Où se trouve l'entreprise. L'adresse vit dans `company_settings`, PAS dans
 * `orgs` (piège connu du projet). Les coordonnées y sont déjà résolues quand
 * le bandeau de l'app a tourné au moins une fois ; sinon on géocode la ville.
 */
async function lieuDeLOrg(client: SupabaseClient, orgId: string): Promise<Lieu | null> {
  const { data, error } = await client
    .from('company_settings')
    .select('city, province, country, weather_lat, weather_lng')
    .eq('org_id', orgId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const s = data as { city: string | null; province: string | null; country: string | null; weather_lat: number | null; weather_lng: number | null };

  if (typeof s.weather_lat === 'number' && typeof s.weather_lng === 'number') {
    return { lat: s.weather_lat, lng: s.weather_lng, ville: s.city || 'votre secteur', pays: s.country ?? null };
  }
  if (!s.city) return null;

  // Géocodage : une seule ville, sans donnée personnelle.
  const q = new URLSearchParams({ name: s.city, count: '1', language: 'fr' });
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q}`);
  if (!r.ok) return null;
  const j = await r.json() as { results?: Array<{ latitude: number; longitude: number; name: string; country_code?: string }> };
  const hit = j.results?.[0];
  if (!hit) return null;
  return { lat: hit.latitude, lng: hit.longitude, ville: hit.name, pays: hit.country_code ?? s.country ?? null };
}

/**
 * Prévision pour l'entreprise. `null` quand l'adresse manque ou qu'Open-Meteo
 * ne répond pas — l'appelant dit alors qu'il ne sait pas, plutôt que d'inventer.
 *
 * `jour` : 0 = aujourd'hui, 1 = demain. Au-delà, la prévision horaire perd son
 * intérêt pour décider d'une journée de travail.
 */
export async function previsionPourOrg(
  client: SupabaseClient,
  orgId: string,
  opts: { jour?: 0 | 1 } = {},
): Promise<PrevisionMeteo | null> {
  const jour = opts.jour === 1 ? 1 : 0;
  try {
    const lieu = await lieuDeLOrg(client, orgId);
    if (!lieu) return null;

    // Modèles d'Environnement Canada pour le Canada : précipitations beaucoup
    // plus justes que le mélange global (même choix que le bandeau de l'app).
    const modeles = (lieu.pays || '').toUpperCase() === 'CA' ? '&models=gem_seamless' : '';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lieu.lat}&longitude=${lieu.lng}`
      + '&hourly=temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m'
      + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max'
      + `&timezone=auto&forecast_days=2${modeles}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as {
      hourly?: { time?: string[]; temperature_2m?: number[]; weather_code?: number[]; precipitation_probability?: number[]; precipitation?: number[]; wind_speed_10m?: number[] };
      daily?: { time?: string[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_sum?: number[]; wind_speed_10m_max?: number[] };
    };
    const h = data.hourly;
    if (!h?.time?.length) return null;

    // Les heures du jour demandé, dans le fuseau du lieu (timezone=auto).
    const jourVise = data.daily?.time?.[jour] ?? h.time[0].slice(0, 10);
    const indices = h.time.map((t, i) => ({ t, i })).filter(({ t }) => t.startsWith(jourVise)).map(({ i }) => i);

    const lire = (i: number): HeureMeteo => ({
      heure: h.time![i],
      temp_c: Math.round(Number(h.temperature_2m?.[i] ?? 0)),
      precipitation_pct: Math.round(Number(h.precipitation_probability?.[i] ?? 0)),
      precipitation_mm: Math.round(Number(h.precipitation?.[i] ?? 0) * 10) / 10,
      vent_kmh: Math.round(Number(h.wind_speed_10m?.[i] ?? 0)),
      ciel: libelleCiel(Number(h.weather_code?.[i] ?? 0)),
    });

    // Journée de travail : 7 h à 19 h. Une prévision pour 3 h du matin
    // n'aide personne à décider si la job a lieu.
    const heuresTravail = indices.filter((i) => { const hh = Number(h.time![i].slice(11, 13)); return hh >= 7 && hh <= 19; }).map(lire);

    const nowMs = Date.now();
    const iMaintenant = jour === 0 ? h.time.findIndex((t) => new Date(t).getTime() >= nowMs - 30 * 60_000) : -1;

    const d = data.daily;
    const precipTotal = Math.round(Number(d?.precipitation_sum?.[jour] ?? 0) * 10) / 10;
    const ventMax = Math.round(Number(d?.wind_speed_10m_max?.[jour] ?? 0));
    const maxC = Math.round(Number(d?.temperature_2m_max?.[jour] ?? 0));
    const minC = Math.round(Number(d?.temperature_2m_min?.[jour] ?? 0));
    const verdict = verdictTravailExterieur(precipTotal, ventMax);

    // Un résumé en une phrase : c'est ce que Lumi reprendra, pas le tableau.
    const pire = heuresTravail.reduce((a, b) => (b.precipitation_pct > (a?.precipitation_pct ?? -1) ? b : a), heuresTravail[0]);
    const quand = jour === 1 ? 'Demain' : "Aujourd'hui";
    const resume = heuresTravail.length
      ? `${quand} à ${lieu.ville} : ${minC} à ${maxC} °C, ${precipTotal} mm de précipitations, vent jusqu'à ${ventMax} km/h.`
        + (pire && pire.precipitation_pct >= 40 ? ` Risque le plus élevé vers ${pire.heure.slice(11, 16)} (${pire.precipitation_pct} %).` : '')
      : `${quand} à ${lieu.ville} : ${minC} à ${maxC} °C, ${precipTotal} mm, vent jusqu'à ${ventMax} km/h.`;

    return {
      ville: lieu.ville,
      maintenant: iMaintenant >= 0 ? lire(iMaintenant) : null,
      heures: heuresTravail,
      max_c: maxC,
      min_c: minC,
      precipitation_mm_total: precipTotal,
      vent_max_kmh: ventMax,
      travail_exterieur: verdict,
      resume,
    };
  } catch (e: any) {
    // Une météo indisponible n'est jamais une erreur bloquante : Lumi dira
    // qu'il ne l'a pas plutôt que d'échouer le tour.
    logger.warn('[meteo] prévision indisponible', { orgId, error: e?.message || String(e) });
    return null;
  }
}
