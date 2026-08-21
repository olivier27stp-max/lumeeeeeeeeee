// Détection de doublons entre la zone de staging et les données ACTIVES du
// workspace. Lecture seule : aucune fusion automatique ici — on produit des
// candidats scorés que l'humain tranche (create_new / merge / skip / review).

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddressKey, normalizeDigits } from './normalize';
import type { DuplicateMatch, TargetEntity } from './types';

export interface ExistingClientLite {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  address: string | null;
}

export interface StagingLite {
  id: string;
  normalized: Record<string, unknown> | null;
  relations: Record<string, string> | null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function fullNameKey(first: string | null | undefined, last: string | null | undefined, company?: string | null): string {
  const name = `${first ?? ''} ${last ?? ''}`.trim() || (company ?? '');
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

/** Scoring pur d'un candidat client contre un client existant (testable). */
export function scoreClientDuplicate(
  candidate: { email?: string | null; phoneDigits?: string | null; fullName?: string | null; addressKey?: string | null },
  existing: ExistingClientLite,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const exEmail = (existing.email ?? '').trim().toLowerCase();
  if (candidate.email && exEmail && candidate.email === exEmail) {
    score = Math.max(score, 95);
    reasons.push('email');
  }
  const exPhone = normalizeDigits(existing.phone ?? '').slice(-10);
  if (candidate.phoneDigits && exPhone && exPhone.length >= 7 && candidate.phoneDigits.slice(-10) === exPhone) {
    score = Math.max(score, 90);
    reasons.push('phone');
  }
  const exName = fullNameKey(existing.first_name, existing.last_name, existing.company);
  if (candidate.fullName && exName && candidate.fullName === exName) {
    const exAddr = normalizeAddressKey(existing.address ?? '');
    if (candidate.addressKey && exAddr && candidate.addressKey === exAddr) {
      score = Math.max(score, 75);
      reasons.push('name+address');
    } else {
      score = Math.max(score, 60);
      reasons.push('name');
    }
  }
  return { score, reasons };
}

const PAGE = 1000;
const MAX_EXISTING = 25_000;

async function fetchAll<T>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  orgId: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < MAX_EXISTING; offset += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`[migration-duplicates] fetch ${table} failed:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Détecte les doublons potentiels d'une entité contre les données actives de
 * l'org. Index en mémoire construits une fois, aucun appel par ligne.
 */
export async function findDuplicatesForEntity(
  admin: SupabaseClient,
  orgId: string,
  entity: TargetEntity,
  records: StagingLite[],
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];
  if (records.length === 0) return matches;

  if (entity === 'client') {
    const existing = await fetchAll<ExistingClientLite>(admin, 'clients', 'id, email, phone, first_name, last_name, company, address', orgId);
    const byEmail = new Map<string, ExistingClientLite>();
    const byPhone = new Map<string, ExistingClientLite>();
    const byName = new Map<string, ExistingClientLite[]>();
    for (const c of existing) {
      const email = (c.email ?? '').trim().toLowerCase();
      if (email && !byEmail.has(email)) byEmail.set(email, c);
      const phone = normalizeDigits(c.phone ?? '').slice(-10);
      if (phone.length >= 7 && !byPhone.has(phone)) byPhone.set(phone, c);
      const name = fullNameKey(c.first_name, c.last_name, c.company);
      if (name) {
        const arr = byName.get(name) ?? [];
        arr.push(c);
        byName.set(name, arr);
      }
    }
    for (const r of records) {
      const n = r.normalized ?? {};
      const candidate = {
        email: str(n.email).toLowerCase() || null,
        phoneDigits: str(n.phone_digits) || normalizeDigits(str(n.phone)).slice(-10) || null,
        fullName: fullNameKey(str(n.first_name) || null, str(n.last_name) || null, str(n.company) || null) || null,
        addressKey: normalizeAddressKey(str(n.address)) || null,
      };
      const hits = new Map<string, ExistingClientLite>();
      if (candidate.email) {
        const hit = byEmail.get(candidate.email);
        if (hit) hits.set(hit.id, hit);
      }
      if (candidate.phoneDigits && candidate.phoneDigits.length >= 7) {
        const hit = byPhone.get(candidate.phoneDigits.slice(-10));
        if (hit) hits.set(hit.id, hit);
      }
      if (candidate.fullName) {
        for (const hit of byName.get(candidate.fullName) ?? []) hits.set(hit.id, hit);
      }
      for (const hit of hits.values()) {
        const { score, reasons } = scoreClientDuplicate(candidate, hit);
        if (score >= 60) {
          matches.push({ stagingRecordId: r.id, existingTable: 'clients', existingId: hit.id, matchReasons: reasons, score });
        }
      }
    }
    return matches;
  }

  if (entity === 'property') {
    const existing = await fetchAll<{ id: string; address: string | null }>(admin, 'properties', 'id, address', orgId);
    const byAddress = new Map<string, string>();
    for (const p of existing) {
      const key = normalizeAddressKey(p.address ?? '');
      if (key && !byAddress.has(key)) byAddress.set(key, p.id);
    }
    for (const r of records) {
      const key = normalizeAddressKey(str((r.normalized ?? {}).address));
      if (!key) continue;
      const hit = byAddress.get(key);
      if (hit) matches.push({ stagingRecordId: r.id, existingTable: 'properties', existingId: hit, matchReasons: ['address'], score: 92 });
    }
    return matches;
  }

  if (entity === 'job') {
    const existing = await fetchAll<{ id: string; job_number: string | null }>(admin, 'jobs', 'id, job_number', orgId);
    const byNumber = new Map<string, string>();
    for (const j of existing) {
      const num = (j.job_number ?? '').trim();
      if (num && !byNumber.has(num)) byNumber.set(num, j.id);
    }
    for (const r of records) {
      const n = r.normalized ?? {};
      const num = str(n.job_number) || str((r.relations ?? {}).external_id);
      if (!num) continue;
      const hit = byNumber.get(num);
      if (hit) matches.push({ stagingRecordId: r.id, existingTable: 'jobs', existingId: hit, matchReasons: ['job_number'], score: 95 });
    }
    return matches;
  }

  if (entity === 'invoice') {
    const existing = await fetchAll<{ id: string; invoice_number: string | null; total_cents: number | null }>(
      admin, 'invoices', 'id, invoice_number, total_cents', orgId,
    );
    const byNumber = new Map<string, { id: string; total_cents: number | null }>();
    for (const inv of existing) {
      const num = (inv.invoice_number ?? '').trim();
      if (num && !byNumber.has(num)) byNumber.set(num, { id: inv.id, total_cents: inv.total_cents });
    }
    for (const r of records) {
      const n = r.normalized ?? {};
      const num = str(n.invoice_number) || str((r.relations ?? {}).external_id);
      if (!num) continue;
      const hit = byNumber.get(num);
      if (!hit) continue;
      const total = typeof n.total_cents === 'number' ? n.total_cents : null;
      const sameTotal = total !== null && hit.total_cents !== null && total === hit.total_cents;
      matches.push({
        stagingRecordId: r.id,
        existingTable: 'invoices',
        existingId: hit.id,
        matchReasons: sameTotal ? ['invoice_number', 'total'] : ['invoice_number'],
        score: sameTotal ? 95 : 85,
      });
    }
    return matches;
  }

  return matches;
}
