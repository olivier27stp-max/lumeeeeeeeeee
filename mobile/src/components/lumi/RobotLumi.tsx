/**
 * Le p'tit robot de Lumi — le MÊME que sur le web, image ET vidéo.
 *
 * Les deux fichiers viennent de `public/agent/` du dépôt web, récupérés dans
 * l'historique git (commit 3dd3f0ca, « agent vendeur Lumi sur la page
 * d'accueil publique »). ⚠️ Ils ont été **supprimés par accident** du web
 * dans le commit a21a6533 (un portage SES sans rapport) : c'est pour ça que
 * `/agent/lumi-poster.png` renvoie 404 en prod et que l'avatar de Lumi est
 * une image cassée sur le web — masquée par son `alt=""`, donc invisible.
 * À remettre côté web aussi.
 *
 * Deux rendus, choisis selon l'endroit :
 *  • `anime` → la VRAIE vidéo (lumi-robot.mp4, 5 s en boucle, muette), donc
 *    le robot bouge exactement comme sur le web. Réservé au grand robot de
 *    l'écran d'accueil : un lecteur vidéo par message coûterait cher pour un
 *    avatar de 26 px, et la page Lumi du web y met elle aussi l'image fixe.
 *  • sinon → l'image fixe (lumi-robot.png), le « poster » de cette vidéo.
 *
 * Si la personne a demandé de réduire les animations, la vidéo ne joue pas :
 * on montre l'image fixe à la place.
 */
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import React from 'react';
import { View } from 'react-native';

import { useAnimationsReduites } from './AnimationsLumi';

const POSTER = require('@/assets/images/lumi-robot.png');
const FILM = require('@/assets/images/lumi-robot.mp4');

function RobotFixe({ taille, rond }: { taille: number; rond: boolean }) {
  return (
    <Image
      source={POSTER}
      style={{ width: taille, height: taille, borderRadius: rond ? taille / 2 : 0 }}
      contentFit="cover"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

function RobotFilm({ taille, rond }: { taille: number; rond: boolean }) {
  const lecteur = useVideoPlayer(FILM, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <View
      style={{ width: taille, height: taille, borderRadius: rond ? taille / 2 : 0, overflow: 'hidden' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <VideoView
        player={lecteur}
        style={{ width: taille, height: taille }}
        contentFit="cover"
        nativeControls={false}
        // Le robot n'est pas un film qu'on regarde : pas de plein écran, pas d'image dans l'image.
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
      />
    </View>
  );
}

export function RobotLumi({ taille = 24, rond = true, anime = false }: { taille?: number; rond?: boolean; anime?: boolean }) {
  const reduit = useAnimationsReduites();
  if (anime && !reduit) return <RobotFilm taille={taille} rond={rond} />;
  return <RobotFixe taille={taille} rond={rond} />;
}
