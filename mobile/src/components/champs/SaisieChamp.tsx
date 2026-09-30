import DateTimePicker from '@react-native-community/datetimepicker';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { Input } from '@/components/ui/Input';
import { useThemeLumi } from '@/lib/lumi/theme';
import { ChampPerso, ValeurChamp, optionsActives } from '@/lib/api/customFields';
import { useTranslation } from '@/lib/i18n';

/** Cents → « 12,50 » pour l'affichage ; le serveur ne parle qu'en cents. */
export function centsVersTexte(v: ValeurChamp): string {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? (n / 100).toFixed(2) : '';
}

export function texteVersCents(txt: string): number | null {
  const n = Number(txt.replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Saisie numérique (nombre, montant) avec un TAMPON DE TEXTE local.
 *
 * Sans lui, convertir à chaque frappe réaffiche « 12.00 » dès qu'on a tapé
 * « 12 » — impossible d'écrire « 12,50 ». Le texte reste donc tel que l'usager
 * le tape ; la conversion n'a lieu qu'à la sortie du champ.
 */
function SaisieNombre({
  champ,
  valeur,
  onChange,
  onValider,
  versValeur,
  versTexte,
  placeholder,
}: {
  champ: ChampPerso;
  valeur: ValeurChamp;
  onChange: (v: ValeurChamp) => void;
  onValider?: (v: ValeurChamp) => void;
  versValeur: (txt: string) => number | null;
  versTexte: (v: ValeurChamp) => string;
  placeholder: string;
}) {
  const [tampon, setTampon] = useState<string | null>(null);
  const affiche = tampon ?? versTexte(valeur);
  return (
    <Input
      value={affiche}
      onChangeText={(txt) => {
        setTampon(txt);
        onChange(txt.trim() === '' ? null : versValeur(txt));
      }}
      placeholder={placeholder}
      keyboardType="decimal-pad"
      aria-label={champ.label}
      onBlur={() => {
        const v = tampon === null ? valeur : tampon.trim() === '' ? null : versValeur(tampon);
        setTampon(null); // on repasse à l'affichage normalisé
        onValider?.(v);
      }}
    />
  );
}

/**
 * La saisie d'UN champ personnalisé, pour les 12 types. Contrôlé : il ne sait
 * rien d'où va la valeur.
 *
 * Deux rappels distincts, et la nuance compte :
 *   onChange  — à chaque frappe. Sert à l'affichage.
 *   onValider — quand la valeur est arrêtée (sortie du champ, choix d'une
 *               option, date choisie). C'est là qu'une fiche enregistre ;
 *               un formulaire de création, lui, n'en fait rien de plus.
 *
 * Partagé par CustomFieldsCard (fiche, enregistre) et useChampsCreation
 * (formulaire, garde en mémoire) : un seul rendu à maintenir, donc pas de
 * dérive possible entre les deux.
 */
export function SaisieChamp({
  champ,
  valeur,
  onChange,
  onValider,
}: {
  champ: ChampPerso;
  valeur: ValeurChamp;
  onChange: (v: ValeurChamp) => void;
  onValider?: (v: ValeurChamp) => void;
}) {
  const { t } = useTranslation();
  const c = t.mobileComp;
  // Le crochet est posé sur la couleur d'action, qui s'inverse en mode sombre :
  // le blanc codé en dur y deviendrait invisible.
  const { c: theme } = useThemeLumi();
  const [dateOuverte, setDateOuverte] = useState(false);
  const options = optionsActives(champ);

  /** Pose la valeur ET la déclare arrêtée — pour les choix (un clic suffit). */
  const poser = (v: ValeurChamp) => {
    onChange(v);
    onValider?.(v);
  };

  switch (champ.field_type) {
    case 'checkbox':
      return (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !!valeur }}
          accessibilityLabel={champ.label}
          onPress={() => poser(!valeur)}
          className="flex-row items-center gap-2"
        >
          <View
            className={`h-6 w-6 items-center justify-center rounded-md border ${valeur ? 'border-brand bg-brand' : 'border-surface-border'}`}
          >
            {valeur ? <SymbolView name="checkmark" tintColor={theme.texteSurAction} size={13} /> : null}
          </View>
          <Text className="text-ink-muted">{valeur ? c.yes : c.no}</Text>
        </Pressable>
      );

    case 'dropdown_single':
      return (
        <View className="flex-row flex-wrap gap-2">
          {options.map((opt) => {
            const choisi = valeur === opt.id;
            return (
              <Pressable
                key={opt.id}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                onPress={() => poser(choisi ? null : opt.id)}
                className={`rounded-full border px-3 py-1.5 ${choisi ? 'border-ink bg-ink' : 'border-surface-border'}`}
              >
                <Text className={`text-xs font-semibold ${choisi ? 'text-onAction' : 'text-ink'}`}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      );

    case 'dropdown_multi': {
      const choisies = Array.isArray(valeur) ? valeur : [];
      return (
        <View className="flex-row flex-wrap gap-2">
          {options.map((opt) => {
            const choisi = choisies.includes(opt.id);
            return (
              <Pressable
                key={opt.id}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                onPress={() => poser(choisi ? choisies.filter((x) => x !== opt.id) : [...choisies, opt.id])}
                className={`rounded-full border px-3 py-1.5 ${choisi ? 'border-ink bg-ink' : 'border-surface-border'}`}
              >
                <Text className={`text-xs font-semibold ${choisi ? 'text-onAction' : 'text-ink'}`}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      );
    }

    case 'date': {
      const texte = typeof valeur === 'string' && valeur ? valeur : '';
      const d = texte ? new Date(texte) : new Date();
      return (
        <View className="gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={champ.label}
            onPress={() => setDateOuverte((o) => !o)}
            className="rounded-xl border border-surface-border px-3 py-3"
          >
            <Text className={texte ? 'text-ink' : 'text-ink-subtle'}>{texte || c.datePlaceholder}</Text>
          </Pressable>
          {dateOuverte ? (
            <DateTimePicker
              value={Number.isNaN(d.getTime()) ? new Date() : d}
              mode={champ.config?.include_time ? 'datetime' : 'date'}
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(_e, choisie) => {
                if (Platform.OS !== 'ios') setDateOuverte(false);
                if (!choisie) return;
                poser(champ.config?.include_time ? choisie.toISOString() : choisie.toISOString().slice(0, 10));
              }}
            />
          ) : null}
        </View>
      );
    }

    case 'file':
      // Téléverser demande le bucket privé custom-field-files et une URL
      // signée : géré au bureau. Ici on montre la valeur sans prétendre
      // pouvoir la changer.
      return (
        <Text className="text-sm text-ink-muted">
          {typeof valeur === 'string' && valeur ? valeur.split('/').pop() : c.cfFichierBureau}
        </Text>
      );

    case 'monetary':
      return (
        <SaisieNombre
          champ={champ}
          valeur={valeur}
          onChange={onChange}
          onValider={onValider}
          versValeur={texteVersCents}
          versTexte={centsVersTexte}
          placeholder={champ.placeholder ?? '0,00'}
        />
      );

    case 'number':
      return (
        <SaisieNombre
          champ={champ}
          valeur={valeur}
          onChange={onChange}
          onValider={onValider}
          versValeur={(txt) => {
            const n = Number(txt.replace(',', '.'));
            return Number.isFinite(n) ? n : null;
          }}
          versTexte={(v) => (v != null ? String(v) : '')}
          placeholder={champ.placeholder ?? ''}
        />
      );

    case 'multi_line':
      return (
        <Input
          value={typeof valeur === 'string' ? valeur : ''}
          onChangeText={(txt) => onChange(txt)}
          placeholder={champ.placeholder ?? ''}
          multiline
          numberOfLines={4}
          aria-label={champ.label}
          onBlur={() => onValider?.(valeur)}
        />
      );

    default:
      return (
        <Input
          value={typeof valeur === 'string' ? valeur : valeur != null ? String(valeur) : ''}
          onChangeText={(txt) => onChange(txt === '' ? null : txt)}
          placeholder={champ.placeholder ?? ''}
          keyboardType={
            champ.field_type === 'phone' ? 'phone-pad' : champ.field_type === 'email' ? 'email-address' : 'default'
          }
          autoCapitalize={['email', 'url'].includes(champ.field_type) ? 'none' : 'sentences'}
          aria-label={champ.label}
          onBlur={() => onValider?.(valeur)}
        />
      );
  }
}
