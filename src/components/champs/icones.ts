import {
  Type, AlignLeft, Hash, DollarSign, Phone, Mail, Calendar, ListChecks, CircleChevronDown, type LucideIcon,
} from 'lucide-react';
import type { TypeChamp } from '../../lib/champs/types';

export const ICONE_TYPE: Record<TypeChamp, LucideIcon> = {
  single_line: Type,
  multi_line: AlignLeft,
  number: Hash,
  monetary: DollarSign,
  phone: Phone,
  email: Mail,
  date: Calendar,
  dropdown_single: CircleChevronDown,
  dropdown_multi: ListChecks,
};

export const AIDE_TYPE: Record<TypeChamp, { fr: string; en: string }> = {
  single_line: { fr: 'Texte court : un nom, un titre, un code.', en: 'Short text: a name, a title, a code.' },
  multi_line: { fr: 'Texte long, sur plusieurs lignes.', en: 'Long text over several lines.' },
  number: { fr: 'Une quantité : superficie, nombre de fenêtres…', en: 'A quantity: area, number of windows…' },
  monetary: { fr: 'Un montant en dollars.', en: 'An amount of money.' },
  phone: { fr: 'Un numéro, normalisé automatiquement.', en: 'A number, normalized automatically.' },
  email: { fr: 'Une adresse courriel valide.', en: 'A valid email address.' },
  date: { fr: 'Une date, avec ou sans heure.', en: 'A date, with or without time.' },
  dropdown_single: { fr: 'Un choix dans une liste.', en: 'One choice from a list.' },
  dropdown_multi: { fr: 'Plusieurs choix dans une liste.', en: 'Several choices from a list.' },
};
