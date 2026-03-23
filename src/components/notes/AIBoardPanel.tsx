/* AI Board Panel — AI-powered features for the whiteboard canvas
   - Cluster/group sticky notes by theme
   - Generate mind map from notes
   - Summarize board content
   - Generate action items
   Uses Ollama (local) for inference.
*/

import React, { useState, useCallback, memo } from 'react';
import {
  X, Sparkles, Network, FileText, ListChecks,
  Loader2, Layers, Brain, Wand2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../i18n';

export interface AIBoardAction {
  id: string;
  label: string;
  labelFr: string;
  icon: React.ElementType;
  description: string;
  descriptionFr: string;
}

const AI_ACTIONS: AIBoardAction[] = [
  {
    id: 'cluster',
    label: 'Cluster Notes',
    labelFr: 'Regrouper les notes',
    icon: Layers,
    description: 'Group sticky notes by theme and reposition them into clusters',
    descriptionFr: 'Regrouper les post-its par theme et les repositionner',
  },
  {
    id: 'mindmap',
    label: 'Generate Mind Map',
    labelFr: 'Generer un mind map',
    icon: Network,
    description: 'Create a mind map structure from your notes',
    descriptionFr: 'Creer une structure de mind map a partir des notes',
  },
  {
    id: 'summary',
    label: 'Summarize Board',
    labelFr: 'Resumer le board',
    icon: FileText,
    description: 'Generate a summary of all board content',
    descriptionFr: 'Generer un resume de tout le contenu du board',
  },
  {
    id: 'actions',
    label: 'Extract Action Items',
    labelFr: 'Extraire les actions',
    icon: ListChecks,
    description: 'Find action items and tasks from board content',
    descriptionFr: 'Trouver les actions et taches dans le contenu du board',
  },
  {
    id: 'expand',
    label: 'Expand Ideas',
    labelFr: 'Developper les idees',
    icon: Brain,
    description: 'AI generates related ideas from existing notes',
    descriptionFr: 'L\'IA genere des idees supplementaires a partir des notes existantes',
  },
  {
    id: 'rewrite',
    label: 'Improve Text',
    labelFr: 'Ameliorer le texte',
    icon: Wand2,
    description: 'Rewrite and improve the selected note text',
    descriptionFr: 'Reecrire et ameliorer le texte de la note selectionnee',
  },
];

interface AIBoardPanelProps {
  language: string;
  loading: boolean;
  result: string | null;
  onAction: (actionId: string) => void;
  onClose: () => void;
  onApplyResult: () => void;
}

function AIBoardPanel({ language, loading, result, onAction, onClose, onApplyResult }: AIBoardPanelProps) {
  const fr = language === 'fr';

  return (
    <div className="w-72 bg-surface border border-outline rounded-xl shadow-lg flex flex-col max-h-[520px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-outline">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-purple-500" />
          <span className="text-[12px] font-semibold text-text-primary">
            {t.noteCanvas.boardAi}
          </span>
        </div>
        <button onClick={onClose} className="p-1 rounded-md text-text-tertiary hover:text-text-primary transition-colors">
          <X size={12} />
        </button>
      </div>

      {/* Actions */}
      <div className="p-2 space-y-1 overflow-y-auto flex-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 size={24} className="text-purple-500 animate-spin" />
            <p className="text-[12px] text-text-secondary">
              {fr ? 'L\'IA analyse le board...' : 'AI is analyzing the board...'}
            </p>
          </div>
        ) : result ? (
          /* Result display */
          <div className="space-y-2">
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 max-h-[300px] overflow-y-auto">
              <p className="text-[12px] text-text-primary whitespace-pre-wrap leading-relaxed">
                {result}
              </p>
            </div>
            <div className="flex gap-1">
              <button
                onClick={onApplyResult}
                className="flex-1 btn-primary text-[11px] py-1.5 flex items-center justify-center gap-1"
              >
                <Sparkles size={11} />
                {t.billing.apply}
              </button>
              <button
                onClick={() => onAction('_clear')}
                className="px-3 py-1.5 rounded-lg border border-outline text-[11px] text-text-secondary hover:bg-surface-secondary transition-colors"
              >
                {t.noteCanvas.dismiss}
              </button>
            </div>
          </div>
        ) : (
          /* Action list */
          AI_ACTIONS.map((action) => (
            <button
              key={action.id}
              onClick={() => onAction(action.id)}
              className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-surface-secondary transition-colors text-left group"
            >
              <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 group-hover:bg-purple-200 dark:group-hover:bg-purple-900/50 transition-colors mt-0.5">
                <action.icon size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-text-primary">
                  {fr ? action.labelFr : action.label}
                </p>
                <p className="text-[10px] text-text-tertiary leading-snug mt-0.5">
                  {fr ? action.descriptionFr : action.description}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default memo(AIBoardPanel);
