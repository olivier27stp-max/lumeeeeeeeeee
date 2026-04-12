import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Palette, Plus, Trash2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createTeam, listTeams, softDeleteTeam, updateTeam } from '../lib/teamsApi';
import { useTranslation } from '../i18n';

interface TeamsManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TeamDraft {
  name: string;
  color_hex: string;
}

const DEFAULT_TEAM_COLOR = '#3B82F6';

function normalizeColorHex(raw: string) {
  const value = raw.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  return DEFAULT_TEAM_COLOR;
}

export default function TeamsManagerModal({ isOpen, onClose }: TeamsManagerModalProps) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamColor, setNewTeamColor] = useState(DEFAULT_TEAM_COLOR);
  const [drafts, setDrafts] = useState<Record<string, TeamDraft>>({});

  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: listTeams,
    enabled: isOpen,
  });

  const teams = teamsQuery.data || [];

  useEffect(() => {
    if (!isOpen) return;
    const nextDrafts: Record<string, TeamDraft> = {};
    for (const team of teams) {
      nextDrafts[team.id] = {
        name: team.name,
        color_hex: normalizeColorHex(team.color_hex),
      };
    }
    setDrafts(nextDrafts);
  }, [isOpen, teams]);

  const createMutation = useMutation({
    mutationFn: createTeam,
    onSuccess: async () => {
      setNewTeamName('');
      setNewTeamColor(DEFAULT_TEAM_COLOR);
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      toast.success(t.modals.teamCreated);
    },
    onError: (error: any) => {
      toast.error(error?.message || t.modals.couldNotCreateTeam);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ teamId, payload }: { teamId: string; payload: { name: string; color_hex: string } }) =>
      updateTeam(teamId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      await queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
      await queryClient.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] });
      toast.success(t.modals.teamUpdated);
    },
    onError: (error: any) => {
      toast.error(error?.message || t.modals.couldNotUpdateTeam);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: softDeleteTeam,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      await queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
      await queryClient.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] });
      toast.success(t.modals.teamDeleted);
    },
    onError: (error: any) => {
      toast.error(error?.message || t.modals.couldNotDeleteTeam);
    },
  });

  const isBusy = useMemo(
    () => createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
    [createMutation.isPending, deleteMutation.isPending, updateMutation.isPending]
  );

  async function handleCreateTeam() {
    const name = newTeamName.trim();
    if (!name) {
      toast.error(t.modals.teamNameRequired);
      return;
    }
    await createMutation.mutateAsync({
      name,
      color_hex: normalizeColorHex(newTeamColor),
    });
  }

  async function handleSaveTeam(teamId: string) {
    const draft = drafts[teamId];
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error(t.modals.teamNameRequired);
      return;
    }
    await updateMutation.mutateAsync({
      teamId,
      payload: {
        name,
        color_hex: normalizeColorHex(draft.color_hex),
      },
    });
  }

  async function handleDeleteTeam(teamId: string, teamName: string) {
    if (!window.confirm(t.modals.deleteTeamConfirm.replace('{name}', teamName))) return;
    await deleteMutation.mutateAsync(teamId);
  }

  return (
    <AnimatePresence>
      {isOpen ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            className="glass w-full max-w-3xl rounded-2xl border border-border shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-text-primary">{t.modals.teamsManager}</h2>
                <p className="text-xs text-text-secondary">{t.modals.teamsManagerDesc}</p>
              </div>
              <button type="button" onClick={onClose} className="glass-button !p-2">
                <X size={15} />
              </button>
            </div>

            <div className="space-y-5 px-5 py-4">
              <section className="rounded-xl border border-border bg-surface-card/70 p-3">
                <h3 className="mb-3 text-sm font-semibold text-text-primary">{t.modals.addTeam}</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_170px_auto]">
                  <input
                    value={newTeamName}
                    onChange={(event) => setNewTeamName(event.target.value)}
                    placeholder={t.modals.teamName}
                    className="glass-input w-full"
                  />
                  <label className="glass-input flex items-center gap-2">
                    <Palette size={14} className="text-text-tertiary" />
                    <input
                      type="color"
                      value={normalizeColorHex(newTeamColor)}
                      onChange={(event) => setNewTeamColor(event.target.value)}
                      className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                    />
                    <span className="text-xs font-medium text-text-secondary">{normalizeColorHex(newTeamColor)}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleCreateTeam()}
                    disabled={isBusy}
                    className="glass-button-primary inline-flex items-center justify-center gap-2"
                  >
                    <Plus size={14} />
                    {t.modals.addTeam}
                  </button>
                </div>
              </section>

              <section className="rounded-xl border border-border bg-surface-card/70 p-3">
                <h3 className="mb-3 text-sm font-semibold text-text-primary">{t.modals.existingTeams}</h3>

                {teamsQuery.isLoading ? <p className="text-sm text-text-secondary">{t.modals.loadingTeams}</p> : null}
                {teamsQuery.isError ? <p className="text-sm text-danger">{t.modals.couldNotLoadTeams}</p> : null}

                <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {teams.map((team) => {
                    const draft = drafts[team.id] || { name: team.name, color_hex: normalizeColorHex(team.color_hex) };
                    return (
                      <div key={team.id} className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-surface-card p-2 md:grid-cols-[1fr_170px_auto_auto]">
                        <input
                          value={draft.name}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [team.id]: { ...draft, name: event.target.value },
                            }))
                          }
                          className="glass-input w-full"
                        />
                        <label className="glass-input flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: normalizeColorHex(draft.color_hex) }} />
                          <input
                            type="color"
                            value={normalizeColorHex(draft.color_hex)}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [team.id]: { ...draft, color_hex: event.target.value },
                              }))
                            }
                            className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                          />
                          <span className="text-xs font-medium text-text-secondary">{normalizeColorHex(draft.color_hex)}</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => void handleSaveTeam(team.id)}
                          disabled={isBusy}
                          className="glass-button !px-3"
                        >
                          {t.common.save}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteTeam(team.id, team.name)}
                          disabled={isBusy}
                          className="glass-button !px-3 text-danger hover:!bg-danger-light"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}

                  {!teamsQuery.isLoading && teams.length === 0 ? (
                    <p className="text-sm text-text-secondary">{t.modals.noTeamsYet}</p>
                  ) : null}
                </div>
              </section>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
