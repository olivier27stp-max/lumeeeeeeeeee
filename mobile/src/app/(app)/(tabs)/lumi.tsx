/**
 * Lumi — l'assistant IA de Lume, sur téléphone.
 *
 * MÊME agent que sur le web : même endpoint (`/api/lumi/*`), même prompt,
 * mêmes 66 outils, mêmes permissions, MÊME historique. Cet écran ne contient
 * aucune logique d'agent — il affiche un flux SSE et propose des boutons.
 *
 * Ce qui reste au serveur, et qui ne doit JAMAIS remonter ici : le plan
 * (includes_ai), le budget mensuel, la permission `external_agent.use`, la
 * décision d'exécuter une écriture. L'écran ne fait que demander.
 *
 * Interface : style ChatGPT mobile, avec les conventions de l'app (nativewind
 * pour la structure, palette `lib/lumi/theme` pour le clair/sombre, SF Symbols).
 */
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlocReflexion } from '@/components/lumi/BlocReflexion';
import { CarteAutorisation, FichesLiees } from '@/components/lumi/CarteAutorisation';
import { CarteRapport } from '@/components/lumi/CarteRapport';
import { FournisseurFiches, TexteLumi } from '@/components/lumi/TexteLumi';
import { HistoriqueDrawer } from '@/components/lumi/HistoriqueDrawer';
import {
  ErreurLumi,
  chargerConversationLumi,
  deciderPropositionLumi,
  definirAutorisationLumi,
  definirModeLumi,
  envoyerMessageLumi,
  executerActionLumi,
  listerAutorisationsLumi,
  listerConversationsLumi,
  lumiConfigure,
  modeLumi,
  quotaLumi,
  supprimerConversationLumi,
  type BudgetLumi,
  type ConversationLumi,
  type EvenementFlux,
  type MessageLumi,
  type ModeLumi,
  type OrigineMessageLumi,
  type PropositionLumi,
  type SuggestionLumi,
  type UsageLumi,
} from '@/lib/api/lumi';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { SOURCES_OUTILS } from '@/lib/lumi/deepLinks';
import { fmtDollars } from '@/lib/lumi/libelles';
import { ThemeLumiProvider, useThemeLumi } from '@/lib/lumi/theme';
import { MAX_SECONDES, useDictee } from '@/lib/lumi/useDictee';
import { useLectureVocale } from '@/lib/lumi/useLectureVocale';
import { useMembership } from '@/lib/membership-context';
import { IconeLumi } from '@/components/lumi/IconeLumi';

interface Item extends MessageLumi {
  id: number;
  enCours?: boolean;
  outilsActifs?: string[];
  debut?: number;
  duree?: number;
}

/** Brouillon gardé quand on quitte l'écran ou qu'on perd le réseau. */
const CLE_BROUILLON = 'lume-lumi-brouillon';
/** Un message du micro (« je n'ai rien entendu ») s'efface après ce délai. */
const DUREE_ERREUR_VOIX_MS = 6000;
/** Distance au bas en deçà de laquelle on considère que l'utilisateur suit le fil. */
const SEUIL_SUIVI_PX = 80;

const MODES: { id: ModeLumi; fr: string; en: string; dfr: string; den: string }[] = [
  { id: 'demander', fr: 'Demander à chaque fois', en: 'Ask every time', dfr: 'Chaque action attend ton clic.', den: 'Every action waits for your tap.' },
  {
    id: 'argent',
    fr: 'Confirmer l’argent et les envois',
    en: 'Confirm money and sends',
    dfr: 'Jobs, tâches, statuts et notes passent seuls. Devis, factures, paiements, textos et courriels demandent.',
    den: 'Jobs, tasks, statuses and notes go through. Quotes, invoices, payments, texts and emails still ask.',
  },
  { id: 'tout', fr: 'Tout faire sans demander', en: 'Do everything without asking', dfr: 'Rien ne demande. Un texto peut partir sans que tu le voies.', den: 'Nothing asks. A text can go out without you seeing it.' },
];

function EcranLumi() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const lang: 'fr' | 'en' = fr ? 'fr' : 'en';
  const { c, choix, setChoix } = useThemeLumi();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { session } = useAuth();
  const { current } = useMembership();
  const orgId = current?.orgId ?? null;

  const [conversations, setConversations] = useState<ConversationLumi[]>([]);
  const [chargementConvs, setChargementConvs] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [autorisations, setAutorisations] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ModeLumi>('argent');
  const [modeOuvert, setModeOuvert] = useState(false);
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);
  const [budget, setBudget] = useState<BudgetLumi | null>(null);
  const [usageConversation, setUsageConversation] = useState<UsageLumi | null>(null);
  const [erreur, setErreur] = useState<{ code: string; message: string } | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [suitLeFil, setSuitLeFil] = useState(true);
  const [clavierOuvert, setClavierOuvert] = useState(false);

  /** Compte interne (@lume-test.ca) : voit modèle et tokens. Un client ne voit que le coût. */
  const interne = /@lume-test\.ca$/i.test(session?.user?.email ?? '');

  const idRef = useRef(1);
  const nextId = () => idRef.current++;
  const scrollRef = useRef<ScrollView>(null);
  const suitRef = useRef(true);
  const conversationIdRef = useRef<string | null>(null);
  const enCoursRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /** Vrai si la dernière question a été dite au micro : la réponse est alors lue. */
  const dicteRef = useRef(false);
  const dicteEnAttenteRef = useRef(false);
  const voixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Ces valeurs sont lues dans des rappels asynchrones (flux SSE, minuteries)
     qui ne doivent PAS capturer un rendu périmé. On les recopie après le rendu
     plutôt que pendant : écrire un ref pendant le rendu casse le compilateur. */
  useEffect(() => {
    suitRef.current = suitLeFil;
  }, [suitLeFil]);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  useEffect(() => {
    enCoursRef.current = enCours;
  }, [enCours]);

  const voix = useLectureVocale(lang);

  /* ── Réseau ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const sub = NetInfo.addEventListener((s) => setHorsLigne(s.isConnected === false));
    return () => sub();
  }, []);

  /* ── Le clavier masque la barre d'onglets, comme dans ChatGPT ───────── */
  useEffect(() => {
    const ouvrir = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setClavierOuvert(true));
    const fermer = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setClavierOuvert(false));
    return () => {
      ouvrir.remove();
      fermer.remove();
    };
  }, []);
  useEffect(() => {
    navigation.setOptions({ tabBarStyle: clavierOuvert ? { display: 'none' } : undefined });
  }, [clavierOuvert, navigation]);

  /* ── Brouillon : on ne perd jamais ce qui est tapé ──────────────────── */
  useEffect(() => {
    AsyncStorage.getItem(CLE_BROUILLON)
      .then((v) => {
        if (v) setInput(v);
      })
      .catch(() => {});
  }, []);
  // Le brouillon s'écrit quand on QUITTE l'écran, pas à chaque frappe : avec
  // `input` en dépendance, l'effet se réabonnait à chaque lettre et écrivait
  // dans AsyncStorage à chaque touche.
  const inputRef = useRef('');
  useEffect(() => {
    inputRef.current = input;
  }, [input]);
  useFocusEffect(
    useCallback(
      () => () => {
        AsyncStorage.setItem(CLE_BROUILLON, inputRef.current).catch(() => {});
      },
      [],
    ),
  );

  /* ── Démarrage : budget, conversations, préférences ─────────────────── */
  const rechargerConversations = useCallback(() => {
    setChargementConvs(true);
    listerConversationsLumi()
      .then(setConversations)
      .catch(() => {
        /* hors ligne : on garde la liste déjà affichée */
      })
      .finally(() => setChargementConvs(false));
  }, []);

  useEffect(() => {
    if (!lumiConfigure()) {
      // Asynchrone volontairement : pousser l'état dans le corps même de
      // l'effet déclenche une cascade de rendus (react-hooks/set-state-in-effect).
      queueMicrotask(() => {
        setErreur({ code: 'lumi_not_configured', message: '' });
        setChargementConvs(false);
      });
      return;
    }
    quotaLumi()
      .then((b) => {
        setBudget(b);
        // Dire tout de suite POURQUOI Lumi est indisponible, sans attendre un envoi.
        if (b.configured === false) setErreur({ code: 'lumi_not_configured', message: '' });
        else if (!b.includes_ai) setErreur({ code: 'plan_sans_lumi', message: '' });
      })
      .catch(() => setBudget(null));
    // Différé : `rechargerConversations` commence par un setState, et l'appeler
    // dans le corps de l'effet déclenche une cascade de rendus.
    queueMicrotask(rechargerConversations);
    listerAutorisationsLumi()
      .then((t) => setAutorisations(new Set(t)))
      .catch(() => {});
    modeLumi()
      .then(setMode)
      .catch(() => {});
  }, [rechargerConversations]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(
    () => () => {
      if (voixTimerRef.current) clearTimeout(voixTimerRef.current);
    },
    [],
  );

  /* ── Défilement : on suit le bas, sauf si l'utilisateur a remonté ───── */
  useEffect(() => {
    if (suitRef.current) scrollRef.current?.scrollToEnd({ animated: true });
  }, [items, enCours]);

  function surDefilement(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const auBas = contentSize.height - (contentOffset.y + layoutMeasurement.height) < SEUIL_SUIVI_PX;
    if (auBas !== suitRef.current) setSuitLeFil(auBas);
  }

  /* ── Le réducteur du flux — identique au web ────────────────────────── */
  const appliquerEvenement = useCallback(
    (e: EvenementFlux) => {
      if (e.type === 'executed') {
        // Le reçu vise la carte (ou la ligne d'un groupe) qui vient d'être exécutée.
        setItems((prev) =>
          prev.map((m) => {
            const p = m.proposal;
            if (!p) return m;
            if (p.groupe?.some((g) => g.tool_use_id === e.tool_use_id)) {
              const groupe = p.groupe.map((g) =>
                g.tool_use_id === e.tool_use_id
                  ? { ...g, statut: e.ok ? ('confirmee' as const) : ('echouee' as const), fiche: e.fiche, ...(e.auto ? { auto: true } : {}) }
                  : g,
              );
              const statut = groupe.some((g) => g.statut === 'en_attente')
                ? ('en_attente' as const)
                : groupe.some((g) => g.statut === 'echouee')
                  ? ('echouee' as const)
                  : ('confirmee' as const);
              return { ...m, proposal: { ...p, groupe, statut, fiche: groupe[0].fiche ?? p.fiche } };
            }
            if (p.tool_use_id === e.tool_use_id) {
              return { ...m, proposal: { ...p, statut: e.ok ? ('confirmee' as const) : ('echouee' as const), fiche: e.fiche, ...(e.auto ? { auto: true } : {}) } };
            }
            return m;
          }),
        );
        if (e.ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }

      setItems((prev) => {
        const next = [...prev];
        let dernier = next[next.length - 1];
        if (!dernier || dernier.role !== 'assistant' || !dernier.enCours) {
          dernier = { id: nextId(), role: 'assistant', text: '', tools: [], enCours: true, outilsActifs: [], debut: Date.now() };
          next.push(dernier);
        } else {
          dernier = { ...dernier };
          next[next.length - 1] = dernier;
        }
        switch (e.type) {
          case 'text':
            dernier.text += e.delta;
            break;
          case 'tool':
            if (e.statut === 'debut') dernier.outilsActifs = [...(dernier.outilsActifs ?? []), e.name];
            else {
              dernier.outilsActifs = (dernier.outilsActifs ?? []).filter((n) => n !== e.name);
              if (e.statut === 'fin' && !dernier.tools.includes(e.name)) dernier.tools = [...dernier.tools, e.name];
            }
            break;
          case 'fiches': {
            const vues = new Set((dernier.fiches ?? []).map((f) => f.href));
            dernier.fiches = [...(dernier.fiches ?? []), ...e.fiches.filter((f) => !vues.has(f.href))].slice(0, 8);
            break;
          }
          case 'proposal':
            dernier.proposal = {
              tool_use_id: e.tool_use_id,
              tool: e.tool,
              args: e.args,
              capacite: e.capacite,
              statut: e.auto ? 'confirmee' : 'en_attente',
              apercu: e.apercu ?? null,
              ...(e.auto ? { auto: true } : {}),
              ...(e.groupe && e.groupe.length > 1
                ? {
                    groupe: e.groupe.map((g) => ({
                      tool_use_id: g.tool_use_id,
                      tool: g.tool,
                      args: g.args,
                      capacite: g.capacite,
                      statut: 'en_attente' as const,
                      apercu: g.apercu ?? null,
                    })),
                  }
                : {}),
            };
            // Le modèle propose parfois l'action sans un mot : on l'annonce.
            if (!dernier.text.trim()) {
              dernier.text = fr ? 'Voici ce que je propose. Confirme ci-dessous et je le fais.' : 'Here is what I propose. Confirm below and I will do it.';
            }
            break;
          case 'report':
            dernier.report = e.rapport;
            break;
          case 'usage': {
            // Un tour = un ou plusieurs appels au modèle : on additionne.
            const u = dernier.usage ?? { model: null, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cost_cents: 0, appels: 0 };
            dernier.usage = {
              model: e.model || u.model,
              input_tokens: u.input_tokens + (e.usage?.input_tokens ?? 0),
              output_tokens: u.output_tokens + (e.usage?.output_tokens ?? 0),
              cache_read_input_tokens: u.cache_read_input_tokens + (e.usage?.cache_read_input_tokens ?? 0),
              cost_cents: u.cost_cents + (e.cost_cents ?? 0),
              appels: u.appels + 1,
            };
            break;
          }
          case 'done':
            dernier.enCours = false;
            dernier.outilsActifs = [];
            dernier.duree = Date.now() - (dernier.debut ?? Date.now());
            break;
          case 'error':
            dernier.enCours = false;
            dernier.duree = Date.now() - (dernier.debut ?? Date.now());
            if (!dernier.text) {
              dernier.text =
                e.message === 'refusal'
                  ? fr
                    ? 'Je ne peux pas répondre à cette demande.'
                    : "I can't help with that request."
                  : fr
                    ? 'Désolé, je n’ai pas réussi à répondre. Réessaie.'
                    : 'Sorry, I could not answer. Please try again.';
            }
            break;
          default:
            break;
        }
        return next;
      });

      if (e.type === 'done') {
        if (dicteRef.current) {
          // Lire la réponse complète, seulement si la question a été dite au micro.
          setItems((prev) => {
            const dernier = [...prev].reverse().find((m) => m.role === 'assistant' && m.text);
            if (dernier?.text) voix.lire(dernier.text);
            return prev;
          });
        }
        setBudget(e.budget);
        if (!conversationIdRef.current) {
          setConversationId(e.conversation_id);
          rechargerConversations();
        }
      }
    },
    [fr, rechargerConversations, voix],
  );

  /* ── Lancer un tour ─────────────────────────────────────────────────── */
  const lancer = useCallback(
    async (action: (onEvent: (e: EvenementFlux) => void, signal: AbortSignal) => Promise<void>) => {
      setErreur(null);
      setEnCours(true);
      setSuitLeFil(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await action(appliquerEvenement, ctrl.signal);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const e = err as ErreurLumi;
        setErreur({ code: e.code || 'reseau', message: e.message || (fr ? 'Erreur de connexion.' : 'Connection error.') });
        if (e.budget) setBudget(e.budget);
        // Un message assistant vide ne doit pas rester à l'écran.
        setItems((prev) => prev.filter((m) => !(m.role === 'assistant' && m.enCours && !m.text)));
      } finally {
        setEnCours(false);
        setItems((prev) => prev.map((m) => (m.enCours ? { ...m, enCours: false, outilsActifs: [] } : m)));
      }
    },
    [appliquerEvenement, fr],
  );

  /* ── Micro (dictée) — rien ne part tout seul, comme sur le web ──────── */
  const dictee = useDictee({
    language: lang,
    onTranscript: (texte) => {
      setInput((base) => (base.trim() ? `${base.trim()} ${texte}` : texte));
      dicteEnAttenteRef.current = true;
    },
    onError: (message) => {
      setErreur({ code: 'voix', message });
      if (voixTimerRef.current) clearTimeout(voixTimerRef.current);
      voixTimerRef.current = setTimeout(() => setErreur((e) => (e?.code === 'voix' ? null : e)), DUREE_ERREUR_VOIX_MS);
    },
    onPermissionRefusee: () => {
      Alert.alert(
        fr ? 'Le micro est bloqué' : 'Microphone blocked',
        fr
          ? 'Lume a besoin du micro pour la dictée. Autorise-le dans les réglages du téléphone.'
          : 'Lume needs the microphone for dictation. Allow it in your phone settings.',
        [
          { text: fr ? 'Plus tard' : 'Later', style: 'cancel' },
          { text: fr ? 'Ouvrir les réglages' : 'Open settings', onPress: () => Linking.openSettings().catch(() => {}) },
        ],
      );
    },
  });

  const envoyer = useCallback(
    async (texte: string, opts: { dicte?: boolean; origine?: OrigineMessageLumi } = {}) => {
      const t = texte.trim();
      if (!t || enCoursRef.current || horsLigne) return;
      if (dictee.etat !== 'repos') dictee.annuler();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setInput('');
      AsyncStorage.removeItem(CLE_BROUILLON).catch(() => {});
      dicteRef.current = !!opts.dicte || dicteEnAttenteRef.current;
      const origine: OrigineMessageLumi = opts.origine ?? (dicteRef.current ? 'voix' : 'texte');
      dicteEnAttenteRef.current = false;
      voix.arreter();
      // Une carte encore en attente est annulée : on ne laisse pas deux demandes ouvertes.
      setItems((prev) => [
        ...prev.map((m) => (m.proposal?.statut === 'en_attente' ? { ...m, proposal: { ...m.proposal, statut: 'annulee' as const } } : m)),
        { id: nextId(), role: 'user' as const, text: t, tools: [] },
      ]);
      await lancer((onEvent, signal) => envoyerMessageLumi({ conversation_id: conversationIdRef.current, message: t, language: lang, origine }, onEvent, signal));
    },
    [dictee, horsLigne, lancer, lang, voix],
  );

  const ecoute = dictee.etat === 'ecoute';
  const transcrit = dictee.etat === 'transcription';
  const chrono = `${Math.floor(dictee.secondes / 60)}:${String(dictee.secondes % 60).padStart(2, '0')}`;

  function basculerMicro() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (ecoute) dictee.arreter();
    else if (dictee.etat === 'repos') void dictee.demarrer();
  }

  /* ── Conversations ──────────────────────────────────────────────────── */
  const ouvrirConversation = useCallback(
    async (id: string) => {
      setErreur(null);
      abortRef.current?.abort();
      try {
        const { messages, usage } = await chargerConversationLumi(id);
        setConversationId(id);
        setUsageConversation(usage ?? null);
        setItems(messages.map((m) => ({ ...m, id: nextId() })));
        setSuitLeFil(true);
      } catch {
        setErreur({ code: 'chargement', message: fr ? 'Impossible de charger cette conversation.' : 'Could not load this conversation.' });
      }
    },
    [fr],
  );

  function nouvelleConversation() {
    abortRef.current?.abort();
    voix.arreter();
    setUsageConversation(null);
    setConversationId(null);
    setItems([]);
    setErreur(null);
    setEnCours(false);
    setSuitLeFil(true);
  }

  async function supprimer(id: string) {
    try {
      await supprimerConversationLumi(id);
    } catch (e) {
      console.error('[lumi] suppression de conversation', e);
      Alert.alert(fr ? 'La conversation n’a pas pu être supprimée.' : 'The conversation could not be deleted.');
      return;
    }
    setConversations((prev) => prev.filter((x) => x.id !== id));
    if (conversationIdRef.current === id) nouvelleConversation();
  }

  /* ── Décisions et préférences ───────────────────────────────────────── */
  async function decider(p: PropositionLumi, decision: 'confirm' | 'cancel') {
    const conv = conversationIdRef.current;
    if (!conv || enCoursRef.current) return;
    void Haptics.impactAsync(decision === 'confirm' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    setItems((prev) =>
      prev.map((m) =>
        m.proposal?.tool_use_id === p.tool_use_id
          ? { ...m, proposal: { ...m.proposal, statut: decision === 'confirm' ? ('confirmee' as const) : ('annulee' as const) } }
          : m,
      ),
    );
    await lancer((onEvent, signal) => deciderPropositionLumi({ conversation_id: conv, tool_use_id: p.tool_use_id, decision, language: lang }, onEvent, signal));
  }

  async function autoriser(tool: string, actif: boolean) {
    // Optimiste : la carte réagit tout de suite ; le serveur fait foi ensuite.
    setAutorisations((prev) => {
      const s = new Set(prev);
      if (actif) s.add(tool);
      else s.delete(tool);
      return s;
    });
    try {
      setAutorisations(new Set(await definirAutorisationLumi(tool, actif)));
    } catch (e) {
      console.error('[lumi] autorisation non enregistrée', e);
      Alert.alert(fr ? 'Préférence non enregistrée.' : 'Preference not saved.');
    }
  }

  async function changerMode(m: ModeLumi) {
    setMode(m);
    setModeOuvert(false);
    try {
      setMode(await definirModeLumi(m));
    } catch (err) {
      // Le mode « tout » est réservé au propriétaire (serveur, code mode_reserve_proprietaire).
      const e = err as ErreurLumi;
      const reserve = /mode_reserve_proprietaire|owner/i.test(String(e?.code || e?.message || ''));
      Alert.alert(
        reserve
          ? fr
            ? 'Seul le propriétaire peut laisser Lumi agir sans demander.'
            : 'Only the owner can let Lumi act without asking.'
          : fr
            ? 'Mode non enregistré.'
            : 'Mode not saved.',
      );
      modeLumi().then(setMode).catch(() => {});
    }
  }

  /* ── Suggestions (étage 0 : une action nommée, 0 token) ─────────────── */
  const suggestions: SuggestionLumi[] = fr
    ? [
        { label: 'Quel est mon chiffre du mois ?', action: 'revenu-mois' },
        { label: 'Quelles factures sont en retard ?', action: 'retards' },
        { label: 'Prépare ma journée de demain', action: 'agenda', params: { periode: 'demain' } },
        { label: 'Qui sont mes meilleurs clients ?', action: 'top-clients', params: { limit: 5 } },
      ]
    : [
        { label: 'What is my revenue this month?', action: 'revenu-mois' },
        { label: 'Which invoices are overdue?', action: 'retards' },
        { label: 'Prepare my day tomorrow', action: 'agenda', params: { periode: 'demain' } },
        { label: 'Who are my best clients?', action: 'top-clients', params: { limit: 5 } },
      ];

  async function lancerAction(s: SuggestionLumi) {
    if (enCoursRef.current || horsLigne) return;
    if (dictee.etat !== 'repos') dictee.annuler();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');
    dicteRef.current = false;
    dicteEnAttenteRef.current = false;
    voix.arreter();
    setItems((prev) => [
      ...prev.map((m) => (m.proposal?.statut === 'en_attente' ? { ...m, proposal: { ...m.proposal, statut: 'annulee' as const } } : m)),
      { id: nextId(), role: 'user' as const, text: s.label, tools: [] },
    ]);
    const issue = { valeur: 'ok' as 'ok' | 'indisponible' };
    await lancer(async (onEvent, signal) => {
      issue.valeur = await executerActionLumi(
        { conversation_id: conversationIdRef.current, action: s.action, params: s.params, label: s.label, language: lang, origine: 'suggestion' },
        onEvent,
        signal,
      );
    });
    // Le serveur ne peut pas (rôle sans accès, outil en échec) : le texte part au modèle.
    if (issue.valeur === 'indisponible') {
      setItems((prev) => prev.slice(0, -1));
      await envoyer(s.label, { origine: 'suggestion' });
    }
  }

  /* ── Actions sur un message ─────────────────────────────────────────── */
  function copier(texte: string) {
    void Clipboard.setStringAsync(texte);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function reessayer(itemId: number) {
    const idx = items.findIndex((m) => m.id === itemId);
    const question = [...items.slice(0, idx)].reverse().find((m) => m.role === 'user');
    if (question?.text) void envoyer(question.text, { origine: 'repli' });
  }

  function menuMessage(m: Item) {
    Alert.alert(fr ? 'Ce message' : 'This message', undefined, [
      { text: fr ? 'Copier' : 'Copy', onPress: () => copier(m.text) },
      ...(enCours || horsLigne ? [] : [{ text: fr ? 'Réessayer' : 'Retry', onPress: () => reessayer(m.id) }]),
      { text: fr ? 'Annuler' : 'Cancel', style: 'cancel' as const },
    ]);
  }

  /* ── États globaux ──────────────────────────────────────────────────── */
  const bloque = !!budget && (!budget.includes_ai || budget.epuise || budget.configured === false);
  const peutEnvoyer = !!input.trim() && !enCours && !bloque && !horsLigne;
  const pctBudget = budget && budget.budget_cents > 0 ? Math.min(100, Math.round((budget.depense_cents / budget.budget_cents) * 100)) : 0;

  const messageErreur = (code: string, brut: string): string => {
    switch (code) {
      case 'ralenti':
        return fr ? 'Gros mois pour Lumi : il répond une fois par minute jusqu’au 1er. Réessaie dans un instant.' : 'Busy month for Lumi: one reply per minute until the 1st. Try again in a moment.';
      case 'http_429':
        return fr ? 'Lumi souffle deux minutes : beaucoup de demandes d’un coup. Réessaie tout à l’heure.' : 'Lumi is catching its breath: a lot of requests at once. Try again shortly.';
      case 'quota_epuise':
        return fr ? 'Le budget IA du mois est atteint. Lumi reprend le 1er du mois prochain.' : 'This month’s AI budget is reached. Lumi resumes on the 1st of next month.';
      case 'plan_sans_lumi':
        return fr ? 'Lumi est inclus dans le forfait Autopilot.' : 'Lumi is included in the Autopilot plan.';
      case 'lumi_not_configured':
        return fr ? 'Lumi n’est pas encore activé sur ce serveur.' : 'Lumi is not enabled on this server yet.';
      case 'timeout':
        return fr ? 'Lumi n’a pas répondu à temps.' : 'Lumi did not answer in time.';
      case 'flux_coupe':
        return fr ? 'La connexion a été coupée en cours de réponse.' : 'The connection dropped mid-answer.';
      case 'no_session':
        return fr ? 'Ta session a expiré. Reconnecte-toi.' : 'Your session expired. Please sign in again.';
      case 'reseau':
        return fr ? 'Pas de connexion au serveur.' : 'Could not reach the server.';
      default:
        return brut;
    }
  };
  /** Une erreur qu'un nouvel essai peut résoudre (≠ plan, quota, config). */
  const reessayable = !!erreur && ['reseau', 'timeout', 'flux_coupe', 'chargement', 'http_429'].includes(erreur.code);

  return (
    <View style={{ flex: 1, backgroundColor: c.fond, paddingTop: insets.top }}>
      {/* ── En-tête ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6 }}>
        <Pressable
          onPress={() => setHistoriqueOuvert(true)}
          accessibilityRole="button"
          accessibilityLabel={fr ? 'Historique des conversations' : 'Conversation history'}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <IconeLumi nom="historique" couleur={c.texte} taille={20} />
        </Pressable>

        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <IconeLumi nom="lumi" couleur={c.lumi} taille={16} />
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.texte }}>Lumi</Text>
          </View>
          {!!budget && budget.includes_ai && (
            <Text style={{ fontSize: 10.5, color: pctBudget >= 90 ? c.danger : c.texteTenu, fontVariant: ['tabular-nums'] }}>
              {fmtDollars(budget.depense_cents)} / {fmtDollars(budget.budget_cents)}
              {usageConversation && conversationId
                ? interne
                  ? ` · ${fmtDollars(usageConversation.cost_cents)}`
                  : ` · ${fr ? 'cette conversation' : 'this conversation'} ${fmtDollars(usageConversation.cost_cents)}`
                : ''}
            </Text>
          )}
        </View>

        <Pressable
          onPress={() => setModeOuvert(true)}
          accessibilityRole="button"
          accessibilityLabel={fr ? 'Mode de confirmation' : 'Confirmation mode'}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <IconeLumi nom="bouclier" couleur={c.texte} taille={18} />
        </Pressable>
        <Pressable
          onPress={nouvelleConversation}
          accessibilityRole="button"
          accessibilityLabel={fr ? 'Nouvelle conversation' : 'New conversation'}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <IconeLumi nom="nouvelle" couleur={c.texte} taille={19} />
        </Pressable>
      </View>

      {horsLigne && (
        <View style={{ backgroundColor: c.attenteFond, paddingHorizontal: 16, paddingVertical: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: '500', color: c.attente, textAlign: 'center' }}>
            {fr ? 'Hors ligne — Lumi a besoin du réseau. Ton brouillon est gardé.' : 'Offline — Lumi needs a connection. Your draft is kept.'}
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? (clavierOuvert ? insets.bottom : 0) : 0}
      >
        {/* ── Le fil ── */}
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={scrollRef}
            onScroll={surDefilement}
            scrollEventThrottle={64}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 16, flexGrow: 1 }}
          >
            {items.length === 0 && (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 24 }}>
                <Pressable
                  onPress={basculerMicro}
                  disabled={bloque || horsLigne}
                  accessibilityRole="button"
                  accessibilityLabel={fr ? 'Parler à Lumi' : 'Talk to Lumi'}
                  accessibilityState={{ disabled: bloque || horsLigne, selected: ecoute }}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: ecoute ? c.lumi : `${c.lumi}1F`,
                    opacity: bloque || horsLigne ? 0.4 : 1,
                  }}
                >
                  {transcrit ? (
                    <ActivityIndicator color={c.lumi} />
                  ) : (
                    <IconeLumi nom="onde" couleur={ecoute ? '#FFFFFF' : c.lumi} taille={24} />
                  )}
                </Pressable>
                {(ecoute || transcrit) && (
                  <Text accessibilityLiveRegion="polite" style={{ fontSize: 12, fontWeight: '500', color: c.lumi, marginTop: -8 }}>
                    {ecoute ? `${fr ? 'Je t’écoute' : 'Listening'} · ${chrono}` : fr ? 'Je transcris…' : 'Transcribing…'}
                  </Text>
                )}
                <Text style={{ fontSize: 18, fontWeight: '600', color: c.texte }}>Lumi</Text>
                <Text style={{ fontSize: 13, lineHeight: 19, color: c.texteTenu, textAlign: 'center', maxWidth: 320 }}>
                  {fr
                    ? 'Je connais tout ton espace de travail. Pose une question, ou demande-moi de préparer un devis, une facture, une job ou un message : tu confirmes avant chaque action.'
                    : 'I know your whole workspace. Ask anything, or have me draft a quote, invoice, job or message: you confirm before every action.'}
                </Text>
                {!bloque && !horsLigne && (
                  <View style={{ gap: 8, width: '100%', marginTop: 4 }}>
                    {suggestions.map((s) => (
                      <Pressable
                        key={s.label}
                        onPress={() => lancerAction(s)}
                        accessibilityRole="button"
                        accessibilityLabel={s.label}
                        style={{
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: c.bordure,
                          backgroundColor: c.carte,
                          paddingHorizontal: 16,
                          minHeight: 44,
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 13, color: c.texteDoux }}>{s.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}

            {items.map((m) => {
              if (m.role === 'user') {
                return (
                  <Pressable key={m.id} onLongPress={() => copier(m.text)} accessibilityRole="text" style={{ alignItems: 'flex-end' }}>
                    <View
                      style={{
                        maxWidth: '85%',
                        borderRadius: 18,
                        borderBottomRightRadius: 6,
                        backgroundColor: c.creux,
                        borderWidth: 1,
                        borderColor: c.bordure,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                      }}
                    >
                      <Text style={{ fontSize: 14.5, lineHeight: 21, color: c.texte }}>{m.text}</Text>
                    </View>
                  </Pressable>
                );
              }

              const actifs = m.outilsActifs ?? [];
              const reflechit = !!m.enCours && (!m.text || actifs.length > 0);
              const etapes = [...m.tools, ...actifs.filter((n) => !m.tools.includes(n))];
              const secondes = m.duree ? Math.max(1, Math.round(m.duree / 1000)) : null;
              const sources = Array.from(
                new Map(m.tools.filter((n) => SOURCES_OUTILS[n]).map((n) => [SOURCES_OUTILS[n].route, SOURCES_OUTILS[n]])).values(),
              );

              return (
                <Pressable key={m.id} onLongPress={() => !m.enCours && m.text && menuMessage(m)} accessibilityRole="text">
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        backgroundColor: `${c.lumi}1F`,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 2,
                      }}
                    >
                      <IconeLumi nom="lumi" couleur={c.lumi} taille={13} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      {(reflechit || etapes.length > 0) && (
                        <BlocReflexion
                          reflechit={reflechit}
                          etapes={etapes}
                          actifs={actifs}
                          secondes={secondes}
                          usage={m.usage}
                          interne={interne}
                          fr={fr}
                        />
                      )}
                      {!!m.text && (
                        <FournisseurFiches value={m.fiches ?? []}>
                          <TexteLumi texte={m.text} />
                        </FournisseurFiches>
                      )}
                      {!!m.report && <CarteRapport rapport={m.report} fr={fr} />}
                      {!!m.proposal && (
                        <CarteAutorisation
                          proposition={m.proposal}
                          fr={fr}
                          busy={enCours}
                          orgId={orgId}
                          onDecision={(d) => decider(m.proposal!, d)}
                          onSuite={(texte) => envoyer(texte, { origine: 'suggestion' })}
                          autorise={autorisations.has(m.proposal.tool)}
                          onAutoriser={autoriser}
                        />
                      )}
                      {!m.enCours && (m.fiches?.length ?? 0) > 0 && <FichesLiees fiches={m.fiches!} fr={fr} />}
                      {!m.enCours && !m.fiches?.length && sources.length > 0 && (
                        <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                          <Text style={{ fontSize: 12.5, color: c.texteTenu }}>{fr ? 'Sources' : 'Sources'}</Text>
                          {sources.map((s) => (
                            <Pressable
                              key={s.route}
                              onPress={() => router.push(s.route as never)}
                              accessibilityRole="link"
                              accessibilityLabel={fr ? s.fr : s.en}
                              style={{ minHeight: 44, justifyContent: 'center' }}
                            >
                              <Text style={{ fontSize: 12.5, color: c.texteDoux, textDecorationLine: 'underline' }}>{fr ? s.fr : s.en}</Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Revenir au bas du fil */}
          {!suitLeFil && items.length > 0 && (
            <Pressable
              onPress={() => {
                setSuitLeFil(true);
                scrollRef.current?.scrollToEnd({ animated: true });
              }}
              accessibilityRole="button"
              accessibilityLabel={fr ? 'Revenir au dernier message' : 'Jump to latest message'}
              style={{
                position: 'absolute',
                bottom: 12,
                alignSelf: 'center',
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: c.carte,
                borderWidth: 1,
                borderColor: c.bordure,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconeLumi nom="bas" couleur={c.texte} taille={16} />
            </Pressable>
          )}
        </View>

        {/* ── Erreur ── */}
        {!!erreur && (
          <View
            accessibilityRole="alert"
            style={{
              marginHorizontal: 16,
              marginBottom: 8,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: `${c.danger}55`,
              backgroundColor: c.dangerFond,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <IconeLumi nom="alerte" couleur={c.danger} taille={14} />
            <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: c.danger }}>{messageErreur(erreur.code, erreur.message)}</Text>
            {reessayable && (
              <Pressable
                onPress={() => {
                  const derniere = [...items].reverse().find((m) => m.role === 'user');
                  setErreur(null);
                  if (derniere?.text) void envoyer(derniere.text, { origine: 'repli' });
                }}
                accessibilityRole="button"
                accessibilityLabel={fr ? 'Réessayer' : 'Retry'}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: c.danger, textDecorationLine: 'underline' }}>{fr ? 'Réessayer' : 'Retry'}</Text>
              </Pressable>
            )}
            {erreur.code === 'plan_sans_lumi' && (
              <Pressable onPress={() => router.push('/(app)/payments-setup' as never)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: c.danger, textDecorationLine: 'underline' }}>{fr ? 'Voir les forfaits' : 'See plans'}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── Le composer ── */}
        <View style={{ paddingHorizontal: 12, paddingBottom: clavierOuvert ? 8 : Math.max(insets.bottom, 8) }}>
          <View style={{ borderRadius: 22, borderWidth: 1, borderColor: c.bordure, backgroundColor: c.carte, paddingHorizontal: 6, paddingTop: 6, paddingBottom: 6 }}>
            <TextInput
              value={input}
              onChangeText={setInput}
              editable={!bloque}
              multiline
              accessibilityLabel={fr ? 'Message à Lumi' : 'Message to Lumi'}
              placeholder={
                bloque
                  ? fr
                    ? 'Lumi est indisponible pour le moment.'
                    : 'Lumi is unavailable for now.'
                  : horsLigne
                    ? fr
                      ? 'Hors ligne — ton texte est gardé.'
                      : 'Offline — your text is kept.'
                    : fr
                      ? 'Pose-moi une question…'
                      : 'Ask me anything…'
              }
              placeholderTextColor={c.texteTenu}
              style={{ maxHeight: 120, minHeight: 36, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, fontSize: 15, lineHeight: 21, color: c.texte }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
              {/* Micro */}
              <Pressable
                onPress={basculerMicro}
                disabled={bloque || transcrit || enCours || horsLigne}
                accessibilityRole="button"
                accessibilityLabel={ecoute ? (fr ? 'Arrêter l’enregistrement' : 'Stop recording') : fr ? 'Parler à Lumi' : 'Talk to Lumi'}
                accessibilityState={{ selected: ecoute, disabled: bloque || transcrit || enCours || horsLigne }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: 44,
                  minWidth: 44,
                  paddingHorizontal: 10,
                  borderRadius: 22,
                  justifyContent: 'center',
                  backgroundColor: ecoute ? c.danger : `${c.lumi}1F`,
                  opacity: bloque || transcrit || enCours || horsLigne ? 0.45 : 1,
                }}
              >
                {transcrit ? (
                  <ActivityIndicator size="small" color={c.lumi} />
                ) : (
                  <IconeLumi nom={ecoute ? 'stop' : 'micro'} couleur={ecoute ? '#FFFFFF' : c.lumi} taille={16} />
                )}
                {ecoute && (
                  <Text accessibilityLiveRegion="polite" style={{ fontSize: 12, fontWeight: '600', color: '#FFFFFF', fontVariant: ['tabular-nums'] }}>
                    {chrono}
                  </Text>
                )}
              </Pressable>

              {/* Lecture des réponses */}
              <Pressable
                onPress={() => (voix.parle ? voix.arreter() : voix.setActif(!voix.actif))}
                accessibilityRole="button"
                accessibilityState={{ selected: voix.actif }}
                accessibilityLabel={voix.actif ? (fr ? 'Ne plus lire les réponses' : 'Stop reading replies aloud') : fr ? 'Lire les réponses à voix haute' : 'Read replies aloud'}
                style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: voix.parle ? c.lumi : 'transparent' }}
              >
                <IconeLumi nom={voix.actif ? 'sonOn' : 'sonOff'} couleur={voix.parle ? '#FFFFFF' : voix.actif ? c.texteDoux : c.texteTenu} taille={16} />
              </Pressable>

              <View style={{ flex: 1 }} />

              {/* Envoyer, ou stop pendant le flux */}
              <Pressable
                onPress={() => {
                  if (enCours) {
                    abortRef.current?.abort();
                    setEnCours(false);
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  } else {
                    void envoyer(input);
                  }
                }}
                disabled={!enCours && !peutEnvoyer}
                accessibilityRole="button"
                accessibilityLabel={enCours ? (fr ? 'Arrêter la réponse' : 'Stop the reply') : fr ? 'Envoyer' : 'Send'}
                accessibilityState={{ disabled: !enCours && !peutEnvoyer }}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: c.action,
                  opacity: !enCours && !peutEnvoyer ? 0.35 : 1,
                }}
              >
                <IconeLumi nom={enCours ? 'stop' : 'haut'} couleur={c.texteSurAction} taille={16} />
              </Pressable>
            </View>
          </View>

          <Text style={{ fontSize: 10.5, color: c.texteTenu, textAlign: 'center', marginTop: 6 }}>
            {ecoute
              ? fr
                ? `Parle ; le texte apparaît dans la zone et tu l’envoies toi-même. ${MAX_SECONDES} s max.`
                : `Speak; the text lands in the box and you send it yourself. ${MAX_SECONDES}s max.`
              : fr
                ? 'Lumi ne crée et n’envoie rien sans ta confirmation. Vérifie les montants avant d’agir.'
                : 'Lumi never creates or sends anything without your confirmation. Check amounts before acting.'}
          </Text>
        </View>
      </KeyboardAvoidingView>

      {/* ── Le tiroir des conversations ── */}
      <HistoriqueDrawer
        visible={historiqueOuvert}
        conversations={conversations}
        conversationId={conversationId}
        chargement={chargementConvs}
        fr={fr}
        horsLigne={horsLigne}
        onFermer={() => setHistoriqueOuvert(false)}
        onOuvrir={(id) => void ouvrirConversation(id)}
        onSupprimer={(id) => void supprimer(id)}
        onNouvelle={nouvelleConversation}
      />

      {/* ── Mode de confirmation + thème ── */}
      {modeOuvert && (
        <Pressable
          onPress={() => setModeOuvert(false)}
          accessibilityRole="button"
          accessibilityLabel={fr ? 'Fermer' : 'Close'}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={() => {}}
            style={{ backgroundColor: c.fond, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: insets.bottom + 16, gap: 4 }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: c.texte, marginBottom: 4 }}>
              {fr ? 'Ce que Lumi fait sans te demander' : 'What Lumi does without asking'}
            </Text>
            {MODES.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => changerMode(m.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: mode === m.id }}
                accessibilityLabel={fr ? m.fr : m.en}
                style={{ borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, backgroundColor: mode === m.id ? c.creux : 'transparent' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '500', color: c.texte }}>{fr ? m.fr : m.en}</Text>
                <Text style={{ fontSize: 12, lineHeight: 17, color: c.texteTenu, marginTop: 2 }}>{fr ? m.dfr : m.den}</Text>
              </Pressable>
            ))}

            <View style={{ height: 1, backgroundColor: c.bordure, marginVertical: 10 }} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: c.texte, marginBottom: 4 }}>{fr ? 'Apparence' : 'Appearance'}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(
                [
                  { id: 'auto' as const, fr: 'Comme le téléphone', en: 'Match phone' },
                  { id: 'clair' as const, fr: 'Clair', en: 'Light' },
                  { id: 'sombre' as const, fr: 'Sombre', en: 'Dark' },
                ]
              ).map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => setChoix(t.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: choix === t.id }}
                  accessibilityLabel={fr ? t.fr : t.en}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: choix === t.id ? c.action : c.bordure,
                    backgroundColor: choix === t.id ? c.creux : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: choix === t.id ? '600' : '400', color: c.texte, textAlign: 'center' }}>{fr ? t.fr : t.en}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

export default function LumiScreen() {
  return (
    <ThemeLumiProvider>
      <EcranLumi />
    </ThemeLumiProvider>
  );
}
