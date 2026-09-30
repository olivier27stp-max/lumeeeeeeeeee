/**
 * Les aperçus d'une action proposée par Lumi — portage des composants
 * `DocumentApercu` / `MessageApercu` / `FusionApercu` / `ChampsApercu` du web
 * (src/components/lumi/CarteAutorisation.tsx).
 *
 * L'enjeu : avant de confirmer, l'utilisateur doit voir EXACTEMENT ce qui va
 * être créé ou envoyé — le vrai document, le vrai texto, le vrai destinataire.
 * Rien n'est résumé ni arrondi.
 *
 * Le document (devis/facture) garde volontairement ses couleurs de papier
 * (fond gris, feuille blanche, encre noire), en clair comme en sombre : c'est
 * un aperçu d'un PDF qui sera blanc, exactement comme sur le web.
 */
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import type { ApercuDocumentLumi, ApercuFusionLumi, ApercuMessageLumi, FicheClientApercuLumi } from '@/lib/api/lumi';
import { getCompany } from '@/lib/api/org';
import { fmtDate, fmtMontant } from '@/lib/lumi/libelles';
import { useThemeLumi } from '@/lib/lumi/theme';

/* ── Le document : mêmes valeurs que la page publique du web ───────────── */

interface Compagnie {
  nom: string | null;
  courriel: string | null;
  telephone: string | null;
  adresse: string | null;
}

/** Une seule lecture par session : l'en-tête du document ne change pas en cours de route. */
const compagnieCache = new Map<string, Promise<Compagnie>>();
function chargerCompagnie(orgId: string): Promise<Compagnie> {
  let p = compagnieCache.get(orgId);
  if (!p) {
    p = getCompany(orgId)
      .then((c) => ({
        nom: c?.company_name ?? null,
        courriel: c?.email ?? null,
        telephone: c?.phone ?? null,
        adresse: [c?.street1, c?.street2, c?.city, c?.province, c?.postal_code].filter(Boolean).join(', ') || null,
      }))
      .catch(() => ({ nom: null, courriel: null, telephone: null, adresse: null }));
    compagnieCache.set(orgId, p);
  }
  return p;
}

const ENCRE = '#111111';
const ENCRE_DOUCE = '#666666';
const ENCRE_TENUE = '#999999';
const PAPIER = '#FFFFFF';
const TABLE = '#F0F0F0';
const TRAIT = '#EEEEEE';

function Etiquette({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '600', color: '#AAAAAA', letterSpacing: 0.8, marginBottom: 6 }}>
      {String(children).toUpperCase()}
    </Text>
  );
}

export function DocumentApercu({ doc, fr, orgId }: { doc: ApercuDocumentLumi; fr: boolean; orgId: string | null }) {
  const [co, setCo] = useState<Compagnie | null>(null);
  useEffect(() => {
    if (!orgId) return;
    let vivant = true;
    chargerCompagnie(orgId).then((c) => {
      if (vivant) setCo(c);
    });
    return () => {
      vivant = false;
    };
  }, [orgId]);

  const devis = doc.genre === 'quote';
  const aujourdhui = new Date();
  const valide = doc.valid_days ? new Date(aujourdhui.getTime() + doc.valid_days * 86400000) : null;

  return (
    <View style={{ backgroundColor: TABLE, padding: 10 }}>
      <View style={{ backgroundColor: PAPIER, borderRadius: 10, borderWidth: 1, borderColor: '#E5E5E5', overflow: 'hidden' }}>
        {/* En-tête : compagnie à gauche, SOUMISSION à droite */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 13, fontWeight: '800', letterSpacing: 1.4, color: ENCRE, marginBottom: 8 }}>
              {(co?.nom || 'LUME').toUpperCase()}
            </Text>
            {!!co?.adresse && <Text style={{ fontSize: 11, color: '#888888' }}>{co.adresse}</Text>}
            {!!co?.telephone && <Text style={{ fontSize: 11, color: '#888888' }}>{co.telephone}</Text>}
            {!!co?.courriel && <Text style={{ fontSize: 11, color: '#888888' }}>{co.courriel}</Text>}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 19, fontWeight: '700', color: ENCRE, letterSpacing: -0.4 }}>
              {devis ? (fr ? 'SOUMISSION' : 'QUOTE') : fr ? 'FACTURE' : 'INVOICE'}
            </Text>
            <Text style={{ fontSize: 12, color: '#888888', marginTop: 2, fontWeight: '500' }}>{fr ? 'Brouillon' : 'Draft'}</Text>
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: TRAIT }} />

        {/* Préparé pour / Détails */}
        <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 14 }}>
          <View>
            <Etiquette>{fr ? 'Préparé pour' : 'Prepared for'}</Etiquette>
            {doc.client ? (
              <>
                <Text style={{ fontSize: 14, fontWeight: '600', color: ENCRE }}>{doc.client.name}</Text>
                {!!doc.client.company && doc.client.company !== doc.client.name && (
                  <Text style={{ fontSize: 12, color: ENCRE_DOUCE, marginTop: 2 }}>{doc.client.company}</Text>
                )}
                {!!doc.client.email && <Text style={{ fontSize: 12, color: '#888888', marginTop: 2 }}>{doc.client.email}</Text>}
                {!!doc.client.phone && <Text style={{ fontSize: 12, color: '#888888', marginTop: 2 }}>{doc.client.phone}</Text>}
              </>
            ) : (
              <Text style={{ fontSize: 13, color: '#AAAAAA' }}>--</Text>
            )}
          </View>
          <View>
            <Etiquette>{fr ? 'Détails' : 'Details'}</Etiquette>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ fontSize: 12, color: '#888888' }}>Date</Text>
              <Text style={{ fontSize: 12, color: '#333333', fontWeight: '500' }}>{fmtDate(aujourdhui, fr)}</Text>
            </View>
            {!!valide && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Text style={{ fontSize: 12, color: '#888888' }}>{fr ? 'Valide jusqu’au' : 'Valid until'}</Text>
                <Text style={{ fontSize: 12, color: '#333333', fontWeight: '500' }}>{fmtDate(valide, fr)}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Text style={{ fontSize: 12, color: '#888888' }}>{fr ? 'Statut' : 'Status'}</Text>
              <Text style={{ fontSize: 12, color: '#333333', fontWeight: '500' }}>{fr ? 'À créer' : 'To be created'}</Text>
            </View>
          </View>
        </View>

        {!!doc.title && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#333333' }}>{doc.title}</Text>
          </View>
        )}
        <View style={{ height: 1, backgroundColor: TRAIT }} />

        {/* Lignes */}
        <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E5E5E5', paddingBottom: 8 }}>
            <Text style={{ flex: 1, fontSize: 10, fontWeight: '600', color: '#888888', letterSpacing: 0.5 }}>DESCRIPTION</Text>
            <Text style={{ width: 34, fontSize: 10, fontWeight: '600', color: '#888888', textAlign: 'center', letterSpacing: 0.5 }}>{fr ? 'QTÉ' : 'QTY'}</Text>
            <Text style={{ width: 74, fontSize: 10, fontWeight: '600', color: '#888888', textAlign: 'right', letterSpacing: 0.5 }}>TOTAL</Text>
          </View>
          {doc.lignes.map((l, i) => (
            <View key={i} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F0F0F0', paddingVertical: 10 }}>
              <View style={{ flex: 1, paddingRight: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '500', color: '#222222' }}>{l.name}</Text>
                {!!l.description && <Text style={{ fontSize: 11, color: ENCRE_TENUE, marginTop: 2, lineHeight: 15 }}>{l.description}</Text>}
                <Text style={{ fontSize: 11, color: ENCRE_TENUE, marginTop: 2, fontVariant: ['tabular-nums'] }}>
                  {fmtMontant(l.unit_price_cents)} {fr ? 'chacun' : 'each'}
                </Text>
              </View>
              <Text style={{ width: 34, fontSize: 13, color: '#555555', textAlign: 'center', fontVariant: ['tabular-nums'] }}>{l.quantity}</Text>
              <Text style={{ width: 74, fontSize: 13, color: ENCRE, fontWeight: '500', textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                {fmtMontant(l.total_cents)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totaux */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <View style={{ alignSelf: 'flex-end', minWidth: 210, gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, color: '#888888' }}>{fr ? 'Sous-total' : 'Subtotal'}</Text>
              <Text style={{ fontSize: 13, color: '#333333', fontWeight: '500', fontVariant: ['tabular-nums'] }}>{fmtMontant(doc.subtotal_cents)}</Text>
            </View>
            {doc.taxes.map((t, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, color: '#888888' }}>
                  {t.label} ({t.rate} %)
                </Text>
                <Text style={{ fontSize: 13, color: '#333333', fontWeight: '500', fontVariant: ['tabular-nums'] }}>{fmtMontant(t.amount_cents)}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#E5E5E5', paddingTop: 8, marginTop: 2 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: ENCRE }}>Total</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: ENCRE, fontVariant: ['tabular-nums'] }}>{fmtMontant(doc.total_cents)}</Text>
            </View>
          </View>
        </View>

        {!!doc.notes && (
          <>
            <View style={{ height: 1, backgroundColor: TRAIT }} />
            <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
              <Etiquette>Notes</Etiquette>
              <Text style={{ fontSize: 12.5, color: '#555555' }}>{doc.notes}</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/* ── Le message : le texto ou le courriel exact, et son destinataire ───── */

export function MessageApercu({ a, fr }: { a: ApercuMessageLumi; fr: boolean }) {
  const { c } = useThemeLumi();
  return (
    <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
      {!!a.to && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ fontSize: 13, color: c.texteTenu }}>{fr ? 'À' : 'To'}</Text>
          <Text style={{ fontSize: 13, color: c.texte, fontWeight: '500', flex: 1 }}>{a.to}</Text>
        </View>
      )}
      {!!a.subject && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <Text style={{ fontSize: 13, color: c.texteTenu }}>{fr ? 'Objet' : 'Subject'}</Text>
          <Text style={{ fontSize: 13, color: c.texte, fontWeight: '500', flex: 1 }}>{a.subject}</Text>
        </View>
      )}
      <View style={{ marginTop: 10, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: c.bordureForte }}>
        <Text style={{ fontSize: 13, lineHeight: 19, color: c.texteDoux }}>{a.body}</Text>
      </View>
    </View>
  );
}

/* ── La fusion : les deux fiches, côte à côte ──────────────────────────── */

function FicheFusion({ f, titre, teinte, bordure }: { f: FicheClientApercuLumi | null; titre: string; teinte: string; bordure: string }) {
  const { c } = useThemeLumi();
  return (
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: bordure, backgroundColor: teinte, paddingHorizontal: 12, paddingVertical: 10 }}>
      <Text style={{ fontSize: 10.5, fontWeight: '600', letterSpacing: 1, color: c.texteTenu, marginBottom: 6 }}>{titre.toUpperCase()}</Text>
      {f ? (
        <>
          <Text style={{ fontSize: 13, fontWeight: '600', color: c.texte }}>{f.name}</Text>
          {!!f.company && f.company !== f.name && <Text style={{ fontSize: 12.5, color: c.texteDoux }}>{f.company}</Text>}
          {!!f.email && <Text style={{ fontSize: 12.5, color: c.texteDoux }}>{f.email}</Text>}
          {!!f.phone && <Text style={{ fontSize: 12.5, color: c.texteDoux }}>{f.phone}</Text>}
          {!!f.address && <Text style={{ fontSize: 12.5, color: c.texteTenu }}>{f.address}</Text>}
          <Text style={{ fontSize: 12, color: c.texteTenu, marginTop: 6 }}>
            {f.jobs} jobs · {f.quotes} devis · {f.invoices} factures{f.since ? ` · depuis ${f.since}` : ''}
          </Text>
        </>
      ) : (
        <Text style={{ fontSize: 12.5, color: c.texteTenu }}>--</Text>
      )}
    </View>
  );
}

export function FusionApercu({ a, fr }: { a: ApercuFusionLumi; fr: boolean }) {
  const { c } = useThemeLumi();
  return (
    <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}>
      <FicheFusion f={a.garder} titre={fr ? 'On garde' : 'Kept'} teinte={`${c.lumi}14`} bordure={`${c.lumi}80`} />
      <FicheFusion f={a.absorber} titre={fr ? 'On fusionne dedans (archivée)' : 'Merged in (archived)'} teinte={c.creux} bordure={c.bordure} />
      <Text style={{ fontSize: 12, lineHeight: 17, color: c.texteTenu }}>
        {fr
          ? 'Tout l’historique de la seconde (jobs, devis, factures, messages…) passe sur la première. Ses champs vides sont complétés. Ce n’est pas réversible.'
          : 'Everything attached to the second record moves to the first. Its empty fields get filled. This cannot be undone.'}
      </Text>
    </View>
  );
}

/* ── Sans aperçu composé : la liste des champs (jobs, tâches, clients…) ─ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ChampsApercu({ args }: { args: Record<string, unknown> }) {
  const { c } = useThemeLumi();
  // Les identifiants techniques ne s'affichent jamais : ils servent aux outils.
  const entrees = Object.entries(args).filter(
    ([k, v]) => v !== null && v !== undefined && v !== '' && !/(^|_)id$/.test(k) && !(typeof v === 'string' && UUID.test(v)),
  );
  if (!entrees.length) return null;
  return (
    <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 4 }}>
      {entrees.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', gap: 10 }}>
          <Text style={{ fontSize: 12.5, color: c.texteTenu, minWidth: 92 }}>{k.replace(/_/g, ' ')}</Text>
          <Text style={{ fontSize: 12.5, color: c.texte, flex: 1 }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</Text>
        </View>
      ))}
    </View>
  );
}
