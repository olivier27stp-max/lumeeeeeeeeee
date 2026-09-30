/**
 * Le tiroir des conversations — l'équivalent mobile du menu « Historique » du
 * web. Même liste, même source (`GET /api/lumi/conversations`), donc une
 * conversation commencée au bureau se retrouve ici, et l'inverse.
 *
 * Sur téléphone, un menu déroulant ne marche pas : c'est un tiroir qui arrive
 * par la gauche, comme le reste des surfaces modales de l'app.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ConversationLumi } from '@/lib/api/lumi';
import { useThemeLumi } from '@/lib/lumi/theme';
import { IconeLumi } from './IconeLumi';

export function HistoriqueDrawer({
  visible,
  conversations,
  conversationId,
  chargement,
  fr,
  horsLigne,
  onFermer,
  onOuvrir,
  onSupprimer,
  onNouvelle,
}: {
  visible: boolean;
  conversations: ConversationLumi[];
  conversationId: string | null;
  chargement: boolean;
  fr: boolean;
  horsLigne: boolean;
  onFermer: () => void;
  onOuvrir: (id: string) => void;
  onSupprimer: (id: string) => void;
  onNouvelle: () => void;
}) {
  const { c } = useThemeLumi();
  const insets = useSafeAreaInsets();
  /* « hier », « 3 j »… se calculent par rapport à un instant figé à l'ouverture :
     lire l'horloge pendant le rendu rend le composant impur (react-hooks/purity). */
  const [maintenant, setMaintenant] = useState(0);
  useEffect(() => {
    // Hors du corps de l'effet : un setState synchrone y déclenche une cascade
    // de rendus (react-hooks/set-state-in-effect).
    if (!visible) return;
    const id = setTimeout(() => setMaintenant(Date.now()), 0);
    return () => clearTimeout(id);
  }, [visible]);

  function demanderSuppression(conv: ConversationLumi) {
    Alert.alert(
      fr ? 'Supprimer cette conversation ?' : 'Delete this conversation?',
      conv.title || (fr ? 'Sans titre' : 'Untitled'),
      [
        { text: fr ? 'Annuler' : 'Cancel', style: 'cancel' },
        { text: fr ? 'Supprimer' : 'Delete', style: 'destructive', onPress: () => onSupprimer(conv.id) },
      ],
    );
  }

  function dateCourte(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const jours = maintenant ? Math.floor((maintenant - d.getTime()) / 86400000) : 7;
    if (jours <= 0) return d.toLocaleTimeString(fr ? 'fr-CA' : 'en-CA', { hour: 'numeric', minute: '2-digit' });
    if (jours === 1) return fr ? 'hier' : 'yesterday';
    if (jours < 7) return `${jours} ${fr ? 'j' : 'd'}`;
    return d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short' });
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onFermer}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ width: '84%', maxWidth: 340, backgroundColor: c.fond, paddingTop: insets.top + 8, paddingBottom: insets.bottom }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10 }}>
            <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: c.texte }}>{fr ? 'Conversations' : 'Conversations'}</Text>
            <Pressable
              onPress={onFermer}
              accessibilityRole="button"
              accessibilityLabel={fr ? 'Fermer l’historique' : 'Close history'}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <IconeLumi nom="fermer" couleur={c.texteDoux} taille={16} />
            </Pressable>
          </View>

          <Pressable
            onPress={() => {
              onNouvelle();
              onFermer();
            }}
            accessibilityRole="button"
            accessibilityLabel={fr ? 'Nouvelle conversation' : 'New conversation'}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginHorizontal: 12,
              marginBottom: 8,
              paddingHorizontal: 12,
              minHeight: 44,
              borderRadius: 12,
              backgroundColor: c.creux,
            }}
          >
            <IconeLumi nom="nouvelle" couleur={c.texte} taille={15} />
            <Text style={{ fontSize: 14, fontWeight: '500', color: c.texte }}>{fr ? 'Nouvelle conversation' : 'New conversation'}</Text>
          </Pressable>

          {horsLigne && (
            <Text style={{ paddingHorizontal: 16, paddingBottom: 8, fontSize: 12, color: c.texteTenu }}>
              {fr ? 'Hors ligne — liste en cache, lecture seule.' : 'Offline — cached list, read only.'}
            </Text>
          )}

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}>
            {chargement && conversations.length === 0 && (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator color={c.texteTenu} />
              </View>
            )}
            {!chargement && conversations.length === 0 && (
              <Text style={{ paddingHorizontal: 4, paddingVertical: 12, fontSize: 13, color: c.texteTenu }}>
                {fr ? 'Aucune conversation encore.' : 'No conversations yet.'}
              </Text>
            )}
            {conversations.map((conv) => {
              const actif = conv.id === conversationId;
              return (
                <View key={conv.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable
                    onPress={() => {
                      onOuvrir(conv.id);
                      onFermer();
                    }}
                    onLongPress={() => !horsLigne && demanderSuppression(conv)}
                    disabled={horsLigne}
                    accessibilityRole="button"
                    accessibilityLabel={conv.title || (fr ? 'Sans titre' : 'Untitled')}
                    accessibilityState={{ selected: actif }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      minHeight: 44,
                      justifyContent: 'center',
                      backgroundColor: actif ? c.creux : 'transparent',
                      opacity: horsLigne ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 13.5, fontWeight: actif ? '600' : '400', color: actif ? c.texte : c.texteDoux }} numberOfLines={1}>
                      {conv.title || (fr ? 'Sans titre' : 'Untitled')}
                    </Text>
                    <Text style={{ fontSize: 11, color: c.texteTenu }}>{dateCourte(conv.updated_at)}</Text>
                  </Pressable>
                  {!horsLigne && (
                    <Pressable
                      onPress={() => demanderSuppression(conv)}
                      accessibilityRole="button"
                      accessibilityLabel={fr ? `Supprimer ${conv.title || 'la conversation'}` : `Delete ${conv.title || 'conversation'}`}
                      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <IconeLumi nom="poubelle" couleur={c.texteTenu} taille={14} />
                    </Pressable>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* Voile : un tap dehors ferme. */}
        <Pressable
          onPress={onFermer}
          accessibilityRole="button"
          accessibilityLabel={fr ? 'Fermer' : 'Close'}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }}
        />
      </View>
    </Modal>
  );
}
