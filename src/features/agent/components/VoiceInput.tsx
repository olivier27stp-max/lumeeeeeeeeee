import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { Mic, MicOff } from 'lucide-react';
import { useTranslation } from '../i18n';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  language: 'en' | 'fr';
  disabled?: boolean;
}

// Check browser support once at module level (not in render)
const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

export default function VoiceInput({ onTranscript, language, disabled = false }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  // Store latest callback in ref to avoid stale closures
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Cleanup on unmount — stop any active recognition
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* already stopped */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ok */ }
        recognitionRef.current = null;
      }
      setIsListening(false);
      return;
    }

    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = t.agent.enca;
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript && typeof transcript === 'string' && transcript.trim()) {
        // Use ref to avoid stale closure
        onTranscriptRef.current(transcript);
      }
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onerror = (e: any) => {
      setIsListening(false);
      recognitionRef.current = null;
      const errType = e?.error || 'unknown';
      if (errType === 'not-allowed') {
        setError(t.agent.micDenied);
      } else if (errType === 'no-speech') {
        setError(t.agent.noSpeechDetected);
      } else {
        setError(t.agent.micError);
      }
      setTimeout(() => setError(null), 3000);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
      recognitionRef.current = null;
    }
  }, [isListening, language]);

  // Don't render if browser doesn't support Speech Recognition
  if (!SpeechRecognitionAPI) return null;

  return (
    <div className="relative">
      {error && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-[10px] text-red-600 dark:text-red-300 font-medium">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={toggleListening}
        disabled={disabled}
        aria-label={language === 'fr' ? (isListening ? 'Arrêter la dictée' : 'Dictée vocale') : (isListening ? 'Stop listening' : 'Voice input')}
        className={`p-1.5 rounded-lg transition-all disabled:opacity-30 disabled:pointer-events-none ${
          isListening
            ? 'text-red-500 bg-red-50 dark:bg-red-900/20'
            : error
              ? 'text-red-400 hover:text-red-500'
              : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary'
      }`}
    >
      {isListening ? (
        <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1, repeat: Infinity }}>
          <MicOff size={16} />
        </motion.div>
      ) : (
        <Mic size={16} />
      )}
    </button>
    </div>
  );
}
