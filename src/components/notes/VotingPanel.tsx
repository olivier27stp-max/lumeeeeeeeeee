/* Voting Panel — voting session for sticky notes on the canvas */

import React, { useState, useEffect, useCallback, memo } from 'react';
import { X, ThumbsUp, Timer, Eye, EyeOff, Trophy, Play, Square } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';

export interface Vote {
  itemId: string;
  userId: string;
  userName: string;
}

interface VotingPanelProps {
  active: boolean;
  votes: Vote[];
  maxVotes: number;
  anonymous: boolean;
  timerSeconds: number;
  timerRunning: boolean;
  currentUserId: string;
  language: string;
  onStart: (maxVotes: number, anonymous: boolean, timerSeconds: number) => void;
  onStop: () => void;
  onClose: () => void;
}

function VotingPanel({
  active, votes, maxVotes, anonymous, timerSeconds, timerRunning,
  currentUserId, language, onStart, onStop, onClose,
}: VotingPanelProps) {
  const { t } = useTranslation();
  const fr = language === 'fr';
  const [configMaxVotes, setConfigMaxVotes] = useState(3);
  const [configAnonymous, setConfigAnonymous] = useState(false);
  const [configTimer, setConfigTimer] = useState(120); // 2 minutes
  const [timeLeft, setTimeLeft] = useState(timerSeconds);

  const myVoteCount = votes.filter((v) => v.userId === currentUserId).length;

  useEffect(() => {
    setTimeLeft(timerSeconds);
  }, [timerSeconds]);

  useEffect(() => {
    if (!timerRunning || timeLeft <= 0) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          onStop();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timerRunning, timeLeft, onStop]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Get vote counts by item
  const voteCounts = votes.reduce<Record<string, number>>((acc, v) => {
    acc[v.itemId] = (acc[v.itemId] || 0) + 1;
    return acc;
  }, {});

  const topItems = Object.entries(voteCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="w-64 bg-surface border border-outline rounded-xl shadow-lg flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-outline">
        <div className="flex items-center gap-2">
          <ThumbsUp size={14} className="text-text-tertiary" />
          <span className="text-[12px] font-semibold text-text-primary">
            {t.noteCanvas.voting}
          </span>
          {active && (
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          )}
        </div>
        <button onClick={onClose} className="p-1 rounded-md text-text-tertiary hover:text-text-primary transition-colors">
          <X size={12} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {!active ? (
          /* Setup */
          <>
            <div>
              <label className="text-[11px] font-medium text-text-secondary mb-1 block">
                {t.noteCanvas.votesPerPerson}
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={configMaxVotes}
                onChange={(e) => setConfigMaxVotes(Number(e.target.value))}
                className="input-field text-[12px] py-1 w-full"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-text-secondary mb-1 block">
                <Timer size={10} className="inline mr-1" />
                {t.noteCanvas.durationSeconds}
              </label>
              <input
                type="number"
                min={30}
                max={600}
                step={30}
                value={configTimer}
                onChange={(e) => setConfigTimer(Number(e.target.value))}
                className="input-field text-[12px] py-1 w-full"
              />
            </div>

            <label className="flex items-center gap-2 text-[11px] text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={configAnonymous}
                onChange={(e) => setConfigAnonymous(e.target.checked)}
                className="accent-blue-500"
              />
              {configAnonymous ? <EyeOff size={12} /> : <Eye size={12} />}
              {t.noteCanvas.anonymousVoting}
            </label>

            <button
              onClick={() => onStart(configMaxVotes, configAnonymous, configTimer)}
              className="btn-primary w-full text-[12px] py-2 flex items-center justify-center gap-2"
            >
              <Play size={14} />
              {t.noteCanvas.startVoting}
            </button>
          </>
        ) : (
          /* Active session */
          <>
            {/* Timer */}
            <div className="text-center">
              <div className={cn(
                'text-2xl font-bold tabular-nums',
                timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-text-primary',
              )}>
                {formatTime(timeLeft)}
              </div>
              <p className="text-[10px] text-text-tertiary mt-0.5">
                {t.noteCanvas.clickStickyNotesToVote}
              </p>
            </div>

            {/* My votes */}
            <div className="bg-surface-secondary rounded-lg p-2 text-center">
              <span className="text-[11px] text-text-secondary">
                {t.noteCanvas.myVotes}: <strong>{myVoteCount}</strong> / {maxVotes}
              </span>
              <div className="flex justify-center gap-1 mt-1">
                {Array.from({ length: maxVotes }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'w-3 h-3 rounded-full border',
                      i < myVoteCount
                        ? 'bg-primary border-primary'
                        : 'bg-surface border-outline',
                    )}
                  />
                ))}
              </div>
            </div>

            {/* Top voted */}
            {topItems.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-text-tertiary mb-1 flex items-center gap-1">
                  <Trophy size={10} /> {t.noteCanvas.topVoted}
                </p>
                <div className="space-y-1">
                  {topItems.map(([itemId, count], idx) => (
                    <div
                      key={itemId}
                      className="flex items-center gap-2 text-[11px] bg-surface-secondary rounded px-2 py-1"
                    >
                      <span className="font-bold text-text-tertiary">{idx + 1}.</span>
                      <span className="flex-1 text-text-secondary truncate">
                        {itemId.slice(0, 8)}...
                      </span>
                      <span className="font-bold text-text-primary">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={onStop}
              className="w-full py-2 rounded-lg border border-red-300 text-red-500 text-[12px] font-medium hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
            >
              <Square size={12} />
              {t.noteCanvas.endVoting}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(VotingPanel);
