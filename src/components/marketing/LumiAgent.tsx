/* LumiAgent — agent conversationnel « vendeur » public sur la page d'accueil.
   - Ouvert d'emblée à l'arrivée ; la page marketing se compacte tant qu'il
     est ouvert (classe `lumi-open` sur <html>), et revient à sa taille normale
     quand on le ferme (×).
   - Fermé, il laisse une bulle flottante (vidéo de Lumi) en bas à droite pour
     rouvrir le chat.
   - Répond via la route publique /api/public/sales-chat (Gemini côté serveur,
     borné + rate-limité). Aucune donnée CRM, aucun token de session envoyé. */

import { useEffect, useRef, useState } from 'react';

const LUMI_CLOSED_KEY = 'lume-lumi-closed';
import { X, Send } from 'lucide-react';

type Msg = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = [
  'Combien ça coûte, Lume ?',
  'Est-ce que ça gère mes factures et devis ?',
  'Ça remplace quoi dans mon entreprise ?',
];

const ACCUEIL: Msg = {
  role: 'assistant',
  content:
    "Salut ! 👋 Moi c'est Lumi, l'assistant de Lume. Tu veux savoir si Lume est fait pour ton entreprise ? Pose-moi tes questions — prix, fonctions, ce que ça remplace.",
};

export default function LumiAgent() {
  // Ouvert par défaut ; si le visiteur l'a fermé, il reste fermé au prochain
  // chargement (localStorage). Le bouton flottant et l'événement `lumi:open`
  // le rouvrent et effacent ce choix.
  const [open, setOpenState] = useState<boolean>(() => {
    try { return localStorage.getItem(LUMI_CLOSED_KEY) !== '1'; } catch { return true; }
  });
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try { if (v) localStorage.removeItem(LUMI_CLOSED_KEY); else localStorage.setItem(LUMI_CLOSED_KEY, '1'); } catch { /* stockage indisponible */ }
  };
  const [messages, setMessages] = useState<Msg[]>([ACCUEIL]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Compacte la page marketing UNIQUEMENT tant que Lumi est ouvert.
  useEffect(() => {
    const root = document.documentElement;
    if (open) root.classList.add('lumi-open');
    else root.classList.remove('lumi-open');
    return () => root.classList.remove('lumi-open');
  }, [open]);

  // Un bouton ailleurs sur la page peut ouvrir le panneau :
  // window.dispatchEvent(new Event('lumi:open')).
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('lumi:open', onOpen);
    return () => window.removeEventListener('lumi:open', onOpen);
  }, []);

  // Auto-scroll vers le dernier message.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function envoyer(texte: string) {
    const q = texte.trim();
    if (!q || loading) return;
    setInput('');
    const suite = [...messages, { role: 'user' as const, content: q }];
    setMessages(suite);
    setLoading(true);
    try {
      const res = await fetch('/api/public/sales-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // On n'envoie que l'historique du chat — jamais de token de session.
        body: JSON.stringify({
          messages: suite.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      const reponse =
        (res.ok && typeof data.reply === 'string' && data.reply.trim()) ||
        (res.status === 429
          ? "Oups, beaucoup de questions d'un coup ! Réessaie dans un petit moment. 🙂"
          : "Désolé, j'ai eu un pépin. Réessaie dans un instant — ou écris-nous directement, on est là.");
      setMessages((m) => [...m, { role: 'assistant', content: reponse }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: "Connexion perdue. Réessaie dans un instant. 🙂" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const showSuggestions = messages.length <= 1 && !loading;

  return (
    <>
      {/* Bulle flottante — visible seulement quand le chat est fermé */}
      {!open && (
        <button
          type="button"
          aria-label="Parler à Lumi"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[60] w-16 h-16 rounded-full overflow-hidden shadow-lg ring-2 ring-white hover:scale-105 transition-transform bg-[#e8f0ff]"
        >
          <video
            className="w-full h-full object-cover"
            src="/agent/lumi.mp4"
            poster="/agent/lumi-poster.png"
            autoPlay
            loop
            muted
            playsInline
          />
        </button>
      )}

      {/* Panneau de chat — latéral DROIT, pleine hauteur (façon Piper) */}
      {open && (
        <div className="fixed top-0 right-0 bottom-0 z-[60] w-full sm:w-[400px] flex flex-col bg-white border-l border-gray-200 shadow-2xl overflow-hidden">
          {/* En-tête */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.18)]" />
            <span className="font-bold text-[15px] text-gray-900">Lumi</span>
            <span className="text-xs text-gray-400">· Assistant Lume</span>
            <button
              type="button"
              aria-label="Fermer"
              onClick={() => setOpen(false)}
              className="ml-auto text-gray-400 hover:text-gray-700"
            >
              <X size={18} />
            </button>
          </div>

          {/* Zone héro avec Lumi animé */}
          <div className="px-4 pt-3 pb-4 bg-gradient-to-br from-[#e8f0ff] to-[#f3ecff] text-center">
            <video
              className="w-[120px] h-[120px] object-cover rounded-2xl mx-auto"
              src="/agent/lumi.mp4"
              poster="/agent/lumi-poster.png"
              autoPlay
              loop
              muted
              playsInline
            />
          </div>

          {/* Conversation */}
          <div ref={bodyRef} className="flex-1 overflow-auto px-4 py-3 space-y-3 bg-[#fafbfc]">
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'assistant'
                    ? 'bg-white border border-[#eef0f2] rounded-2xl rounded-tl-sm px-3.5 py-3 text-[13.5px] leading-relaxed text-gray-700 max-w-[92%] shadow-sm'
                    : 'ml-auto bg-gray-900 text-white rounded-2xl rounded-tr-sm px-3.5 py-3 text-[13.5px] leading-relaxed max-w-[92%]'
                }
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="bg-white border border-[#eef0f2] rounded-2xl rounded-tl-sm px-3.5 py-3 max-w-[60%] shadow-sm">
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
                </span>
              </div>
            )}
          </div>

          {/* Questions suggérées */}
          {showSuggestions && (
            <div className="px-4 py-2.5 border-t border-gray-100">
              <div className="text-[11px] text-gray-400 mb-1.5">Pose-moi des questions comme :</div>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => envoyer(s)}
                  className="block w-full text-left text-[13px] text-gray-700 hover:text-gray-900 py-2 border-b border-gray-100 last:border-0"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Saisie */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              envoyer(input);
            }}
            className="flex items-center gap-2 px-3.5 py-3 border-t border-gray-100"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pose ta question à Lumi…"
              aria-label="Pose ta question à Lumi"
              className="flex-1 h-10 rounded-full border border-gray-200 bg-gray-50 px-4 text-[13px] outline-none focus:border-gray-400 focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Envoyer"
              className="w-9 h-9 rounded-full bg-gray-900 text-white flex items-center justify-center shrink-0 disabled:opacity-40"
            >
              <Send size={15} />
            </button>
          </form>
          <div className="text-[10px] text-gray-400 text-center px-3.5 pb-3">
            Lumi est une IA et peut se tromper.
          </div>
        </div>
      )}
    </>
  );
}
