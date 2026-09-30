/**
 * Carte d'autorisation de Lumi — portage du composant du web
 * (src/components/lumi/CarteAutorisation.tsx).
 *
 * Une ligne « Lumi veut créer une soumission », l'essentiel dessous, l'état, le
 * détail sous un chevron (le VRAI document, le VRAI texto avec son
 * destinataire), puis trois choix : confirmer, toujours confirmer ce type
 * d'action, refuser. Une fois confirmée, la même carte devient le reçu :
 * « Devis Q-0043 créé », Ouvrir, Envoyer au client.
 *
 * Rien n'est créé avant la confirmation : la carte EST la demande. Le serveur
 * n'exécute l'écriture qu'au POST /api/lumi/execute qui suit le bouton.
 */
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ApercuDocumentLumi, FicheLumi, PropositionLumi } from '@/lib/api/lumi';
import { ouvrable, ouvrirFiche } from '@/lib/lumi/deepLinks';
import { TYPE_FICHE, fmtMontant, verbe } from '@/lib/lumi/libelles';
import { useThemeLumi, type PaletteLumi } from '@/lib/lumi/theme';

import { ChampsApercu, DocumentApercu, FusionApercu, MessageApercu } from './ApercusLumi';
import { IconeLumi } from './IconeLumi';

/** Une ligne de résumé sous le titre : « Marie Tremblay · 2 lignes · 494,39 $ taxes incluses ». */
function resume(p: PropositionLumi, fr: boolean): string {
  const a = p.apercu;
  if (a && (a.genre === 'quote' || a.genre === 'invoice')) {
    const n = a.lignes.length;
    return [
      a.client?.name,
      `${n} ${fr ? (n > 1 ? 'lignes' : 'ligne') : n > 1 ? 'lines' : 'line'}`,
      `${fmtMontant(a.total_cents)} ${a.taxes.length ? (fr ? 'taxes incluses' : 'incl. taxes') : fr ? 'sans taxes' : 'no taxes'}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (a && (a.genre === 'sms' || a.genre === 'email')) {
    return [a.to ? `${fr ? 'À' : 'To'} ${a.to}` : null, a.subject].filter(Boolean).join(' · ');
  }
  if (a && a.genre === 'fusion') {
    return `${a.garder?.name ?? '?'} ${fr ? '← absorbe' : '← absorbs'} ${a.absorber?.name ?? '?'}`;
  }
  const args = p.args as Record<string, unknown>;
  if (p.tool === 'remember_this' && typeof args.note === 'string') return args.note;
  if (p.tool === 'forget_note' && typeof args.key === 'string') return args.key;
  const t = [args.client_name, args.title, args.name].find((x) => typeof x === 'string' && x.trim()) as string | undefined;
  return t ?? '';
}

function Pastille({ statut, auto, fr, c }: { statut: PropositionLumi['statut']; auto?: boolean; fr: boolean; c: PaletteLumi }) {
  const [fond, encre, texte] =
    statut === 'en_attente'
      ? [c.attenteFond, c.attente, fr ? 'En attente' : 'Pending']
      : statut === 'confirmee'
        ? [c.succesFond, c.succes, auto ? (fr ? 'Confirmée auto' : 'Auto-confirmed') : fr ? 'Confirmée' : 'Confirmed']
        : statut === 'echouee'
          ? [c.dangerFond, c.danger, fr ? 'Échouée' : 'Failed']
          : [c.creux, c.texteTenu, fr ? 'Refusée' : 'Declined'];
  return (
    <View style={{ backgroundColor: fond, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
      <Text style={{ fontSize: 11, fontWeight: '500', color: encre }}>{texte}</Text>
    </View>
  );
}

/** Cible de tap d'au moins 44 px, partout. */
const TAP = { minHeight: 44, justifyContent: 'center' as const };

function Bouton({
  titre,
  onPress,
  variante,
  disabled,
  c,
}: {
  titre: string;
  onPress: () => void;
  variante: 'plein' | 'contour' | 'danger';
  disabled?: boolean;
  c: PaletteLumi;
}) {
  const plein = variante === 'plein';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={titre}
      accessibilityState={{ disabled: !!disabled }}
      style={{
        ...TAP,
        borderRadius: 10,
        paddingHorizontal: 14,
        backgroundColor: plein ? c.action : 'transparent',
        borderWidth: plein ? 0 : 1,
        borderColor: c.bordureForte,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text
        style={{
          fontSize: 12.5,
          fontWeight: plein ? '600' : '500',
          color: plein ? c.texteSurAction : variante === 'danger' ? c.danger : c.texteDoux,
        }}
      >
        {titre}
      </Text>
    </Pressable>
  );
}

/* ── Une ligne d'un groupe d'actions ───────────────────────────────────── */

function LigneGroupe({ p, fr, index, orgId }: { p: PropositionLumi; fr: boolean; index: number; orgId: string | null }) {
  const { c } = useThemeLumi();
  const [ouvert, setOuvert] = useState(false);
  const v = verbe(p.tool, p.capacite);
  const a = p.apercu ?? null;
  const document = a && (a.genre === 'quote' || a.genre === 'invoice') ? a : null;
  const message = a && (a.genre === 'sms' || a.genre === 'email') ? a : null;
  const fusion = a && a.genre === 'fusion' ? a : null;
  const sousTitre = resume(p, fr);
  const ok = p.statut === 'confirmee';

  return (
    <View style={{ borderTopWidth: index === 0 ? 0 : 1, borderTopColor: c.bordure }}>
      <Pressable
        onPress={() => setOuvert((x) => !x)}
        accessibilityRole="button"
        accessibilityState={{ expanded: ouvert }}
        accessibilityLabel={ok && p.fiche?.label ? p.fiche.label : fr ? v.fr : v.en}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, minHeight: 44 }}
      >
        <Text style={{ width: 14, fontSize: 11, fontWeight: '600', color: c.texteTenu, fontVariant: ['tabular-nums'] }}>{index + 1}</Text>
        <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: `${c.lumi}1F`, alignItems: 'center', justifyContent: 'center' }}>
          <IconeLumi nom={v.icone} couleur={c.lumi} taille={13} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 13, fontWeight: '500', color: c.texte }} numberOfLines={1}>
            {ok && p.fiche?.label ? p.fiche.label : fr ? v.fr : v.en}
          </Text>
          {!!sousTitre && (
            <Text style={{ fontSize: 12, color: c.texteTenu }} numberOfLines={1}>
              {sousTitre}
            </Text>
          )}
        </View>
        {p.statut !== 'en_attente' && <Pastille statut={p.statut} auto={p.auto} fr={fr} c={c} />}
        <IconeLumi nom={ouvert ? 'chevronHaut' : 'chevronBas'} couleur={c.texteTenu} taille={12} />
      </Pressable>
      {ouvert &&
        (document ? (
          <DocumentApercu doc={document} fr={fr} orgId={orgId} />
        ) : message ? (
          <MessageApercu a={message} fr={fr} />
        ) : fusion ? (
          <FusionApercu a={fusion} fr={fr} />
        ) : (
          <ChampsApercu args={p.args as Record<string, unknown>} />
        ))}
      {ok && p.fiche && ouvrable(p.fiche) && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
          <Bouton titre={fr ? 'Ouvrir' : 'Open'} onPress={() => ouvrirFiche(p.fiche!)} variante="contour" c={c} />
        </View>
      )}
    </View>
  );
}

/* ── La carte ──────────────────────────────────────────────────────────── */

export function CarteAutorisation({
  proposition,
  fr,
  busy,
  orgId,
  onDecision,
  onSuite,
  autorise,
  onAutoriser,
}: {
  proposition: PropositionLumi;
  fr: boolean;
  busy: boolean;
  orgId: string | null;
  onDecision: (d: 'confirm' | 'cancel') => void;
  /** Enchaîner en langage courant après le reçu (« Envoie la soumission Q-0043 à Marie »). */
  onSuite?: (texte: string) => void;
  /** Cet outil est déjà en « toujours confirmer » (préférence serveur, par utilisateur). */
  autorise: boolean;
  onAutoriser: (tool: string, actif: boolean) => void;
}) {
  const { c } = useThemeLumi();
  const [ouvert, setOuvert] = useState(false);
  const p = proposition;
  const v = verbe(p.tool, p.capacite);
  const a = p.apercu ?? null;
  const document = a && (a.genre === 'quote' || a.genre === 'invoice') ? (a as ApercuDocumentLumi) : null;
  const message = a && (a.genre === 'sms' || a.genre === 'email') ? a : null;
  const fusion = a && a.genre === 'fusion' ? a : null;
  const attente = p.statut === 'en_attente';
  const ok = p.statut === 'confirmee';
  const groupe = p.groupe && p.groupe.length > 1 ? p.groupe : null;
  const nFaites = groupe ? groupe.filter((g) => g.statut === 'confirmee').length : 0;

  // Un document ou une fusion en attente s'ouvre TOUT SEUL : on ne confirme pas
  // un montant qu'on n'a pas vu. (Même règle qu'au web.)
  const [forceOuvert] = useState(() => (!!document || !!fusion) && attente);
  const detailVisible = ouvert || forceOuvert;

  const titre = groupe
    ? attente
      ? fr
        ? `Lumi veut faire ${groupe.length} choses`
        : `Lumi wants to do ${groupe.length} things`
      : ok
        ? fr
          ? `${groupe.length} actions faites`
          : `${groupe.length} actions done`
        : p.statut === 'echouee'
          ? fr
            ? `${nFaites} sur ${groupe.length} faites, une a échoué`
            : `${nFaites} of ${groupe.length} done, one failed`
          : fr
            ? 'Actions refusées'
            : 'Actions declined'
    : attente
      ? `${fr ? 'Lumi veut' : 'Lumi wants to'} ${fr ? v.fr : v.en}`
      : ok
        ? p.tool === 'remember_this'
          ? fr
            ? 'Noté pour la prochaine fois'
            : 'Noted for next time'
          : p.tool === 'forget_note'
            ? fr
              ? 'Note oubliée'
              : 'Note forgotten'
            : p.fiche?.label
              ? `${p.fiche.label} ${fr ? (p.fiche.type === 'invoice' || p.fiche.type === 'task' ? 'créée' : 'créé') : 'created'}`
              : fr
                ? 'Action exécutée'
                : 'Action executed'
        : p.statut === 'echouee'
          ? fr
            ? 'Action échouée'
            : 'Action failed'
          : fr
            ? 'Action refusée'
            : 'Action declined';

  const sousTitre = groupe ? groupe.map((g) => (fr ? verbe(g.tool, g.capacite).fr : verbe(g.tool, g.capacite).en)).join(' · ') : resume(p, fr);

  const detailLabel = document
    ? document.genre === 'quote'
      ? fr
        ? 'Voir la soumission'
        : 'View the quote'
      : fr
        ? 'Voir la facture'
        : 'View the invoice'
    : message
      ? message.genre === 'sms'
        ? fr
          ? 'Voir le texto'
          : 'View the text'
        : fr
          ? 'Voir le courriel'
          : 'View the email'
      : fusion
        ? fr
          ? 'Voir les deux fiches'
          : 'View both records'
        : fr
          ? 'Voir les détails'
          : 'View details';

  const aUnDetail = !groupe && (!!document || !!message || !!fusion || Object.keys(p.args).length > 0);

  return (
    <View style={{ marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: c.bordureForte, backgroundColor: c.carte, overflow: 'hidden' }}>
      {/* Titre */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12 }}>
        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: `${c.lumi}1F`, alignItems: 'center', justifyContent: 'center' }}>
          <IconeLumi nom={v.icone} couleur={c.lumi} taille={16} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 13.5, fontWeight: '600', color: c.texte }}>{titre}</Text>
          {!!sousTitre && (
            <Text style={{ fontSize: 12.5, color: c.texteTenu, marginTop: 2 }} numberOfLines={2}>
              {sousTitre}
            </Text>
          )}
        </View>
        <Pastille statut={p.statut} auto={p.auto} fr={fr} c={c} />
      </View>

      {/* Les lignes d'un groupe */}
      {groupe && (
        <View style={{ borderTopWidth: 1, borderTopColor: c.bordure }}>
          {groupe.map((g, i) => (
            <LigneGroupe key={g.tool_use_id} p={g} fr={fr} index={i} orgId={orgId} />
          ))}
        </View>
      )}

      {/* Le détail d'une action seule */}
      {aUnDetail && (
        <View style={{ borderTopWidth: 1, borderTopColor: c.bordure }}>
          <Pressable
            onPress={() => setOuvert((x) => !x)}
            accessibilityRole="button"
            accessibilityLabel={detailLabel}
            accessibilityState={{ expanded: detailVisible }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 44, backgroundColor: c.creux }}
          >
            <Text style={{ flex: 1, fontSize: 12.5, color: c.texteDoux }}>{detailLabel}</Text>
            <IconeLumi nom={detailVisible ? 'chevronHaut' : 'chevronBas'} couleur={c.texteTenu} taille={13} />
          </Pressable>
          {detailVisible &&
            (document ? (
              <DocumentApercu doc={document} fr={fr} orgId={orgId} />
            ) : message ? (
              <MessageApercu a={message} fr={fr} />
            ) : fusion ? (
              <FusionApercu a={fusion} fr={fr} />
            ) : (
              <ChampsApercu args={p.args as Record<string, unknown>} />
            ))}
        </View>
      )}

      {/* Les choix */}
      <View style={{ borderTopWidth: 1, borderTopColor: c.bordure, backgroundColor: c.creux, paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}>
        {attente ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Bouton titre={fr ? 'Confirmer' : 'Confirm'} onPress={() => onDecision('confirm')} variante="plein" disabled={busy} c={c} />
              <Bouton titre={fr ? 'Refuser' : 'Decline'} onPress={() => onDecision('cancel')} variante="danger" disabled={busy} c={c} />
            </View>
            {!groupe && (
              <Bouton
                titre={fr ? `Toujours confirmer ${v.type}` : `Always confirm ${v.typeEn}`}
                onPress={() => {
                  onAutoriser(p.tool, true);
                  onDecision('confirm');
                }}
                variante="contour"
                disabled={busy}
                c={c}
              />
            )}
            <Text style={{ fontSize: 11.5, color: c.texteTenu }}>
              {groupe
                ? fr
                  ? `Les ${groupe.length} actions partent ensemble, dans l’ordre`
                  : `All ${groupe.length} actions run together, in order`
                : fr
                  ? 'Rien n’est fait avant que tu confirmes'
                  : 'Nothing happens until you confirm'}
            </Text>
          </>
        ) : ok ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.lumi }} />
              <Text style={{ fontSize: 12.5, color: c.texteDoux }}>{fr ? 'Fait' : 'Done'}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {!groupe && p.fiche && ouvrable(p.fiche) && (
                <Bouton titre={fr ? 'Ouvrir' : 'Open'} onPress={() => ouvrirFiche(p.fiche!)} variante="contour" c={c} />
              )}
              {!groupe && p.fiche && (p.fiche.type === 'quote' || p.fiche.type === 'invoice') && onSuite && document?.client?.name && (
                <Bouton
                  titre={fr ? `Envoyer à ${document.client.name.split(' ')[0]}` : `Send to ${document.client.name.split(' ')[0]}`}
                  onPress={() =>
                    onSuite(
                      fr
                        ? `Envoie ${p.fiche!.label.toLowerCase().startsWith('devis') ? 'la soumission' : 'la facture'} ${p.fiche!.label.split(' ').slice(1).join(' ')} à ${document.client!.name}`
                        : `Send ${p.fiche!.label} to ${document.client!.name}`,
                    )
                  }
                  variante="plein"
                  disabled={busy}
                  c={c}
                />
              )}
            </View>
            {autorise && (
              <Pressable onPress={() => onAutoriser(p.tool, false)} accessibilityRole="button" style={TAP}>
                <Text style={{ fontSize: 11.5, color: c.texteTenu, textDecorationLine: 'underline' }}>
                  {fr ? 'Redemander à chaque fois' : 'Ask every time again'}
                </Text>
              </Pressable>
            )}
          </>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <IconeLumi nom="annule" couleur={p.statut === 'echouee' ? c.danger : c.texteTenu} taille={13} />
            <Text style={{ flex: 1, fontSize: 12.5, color: p.statut === 'echouee' ? c.danger : c.texteTenu }}>
              {p.statut === 'echouee'
                ? fr
                  ? 'Ça n’a pas fonctionné, rien n’a été créé.'
                  : 'It failed, nothing was created.'
                : fr
                  ? 'Annulée, rien n’a été fait.'
                  : 'Cancelled, nothing was done.'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/* ── Fiches liées : puces sous la réponse ──────────────────────────────── */

export function FichesLiees({ fiches, fr }: { fiches: FicheLumi[]; fr: boolean }) {
  const { c } = useThemeLumi();
  // Une fiche sans écran mobile ne devient pas une puce morte.
  const liste = fiches.filter((f) => f && ouvrable(f));
  if (!liste.length) return null;
  return (
    <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {liste.map((f) => (
        <Pressable
          key={f.href + f.label}
          onPress={() => ouvrirFiche(f)}
          accessibilityRole="link"
          accessibilityLabel={`${fr ? TYPE_FICHE[f.type]?.[0] : TYPE_FICHE[f.type]?.[1]} ${f.label}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: c.bordure,
            backgroundColor: c.carte,
            paddingHorizontal: 10,
            minHeight: 44,
          }}
        >
          <Text style={{ fontSize: 10.5, letterSpacing: 0.8, color: c.texteTenu }}>
            {(fr ? TYPE_FICHE[f.type]?.[0] : TYPE_FICHE[f.type]?.[1])?.toUpperCase()}
          </Text>
          <Text style={{ fontSize: 12, color: c.texteDoux }}>{f.label}</Text>
          {typeof f.montant_cents === 'number' && f.type !== 'client' && (
            <Text style={{ fontSize: 12, color: c.texteTenu }}>· {fmtMontant(f.montant_cents)}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}
