import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '../components/d2d/card';
import { Avatar } from '../components/d2d/avatar';
import { Plus, X, Users, ChevronDown, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  listTeams as apiListTeams,
  createTeam as apiCreateTeam,
  updateTeam as apiUpdateTeam,
  softDeleteTeam as apiSoftDeleteTeam,
  type TeamRecord,
} from '../lib/teamsApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Rep {
  id: string; // memberships row id (or user_id as fallback)
  userId: string;
  name: string;
  teamId: string | null;
}

interface Team {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Fallback mock data (used when API errors)
// ---------------------------------------------------------------------------

const fallbackTeams: Team[] = [];

const fallbackReps: Rep[] = [];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function D2DSettingsTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTeamName, setNewTeamName] = useState('');
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [saving, setSaving] = useState(false);

  // ------------------------------------------
  // Fetch teams from DB
  // ------------------------------------------
  const fetchTeams = useCallback(async () => {
    try {
      const records: TeamRecord[] = await apiListTeams();
      setTeams(records.map((r) => ({ id: r.id, name: r.name })));
      return true;
    } catch (err) {
      console.error('[D2DSettingsTeams] Failed to fetch teams:', err);
      return false;
    }
  }, []);

  // ------------------------------------------
  // Fetch reps (org members) from DB
  // ------------------------------------------
  const fetchReps = useCallback(async () => {
    try {
      // Get current user to resolve org
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { data: membership } = await supabase
        .from('memberships')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (!membership?.org_id) return false;

      // Get all memberships for this org with their team assignment
      const { data: members, error } = await supabase
        .from('memberships')
        .select('id, user_id, role, team_id, status')
        .eq('org_id', membership.org_id)
        .eq('status', 'active');

      if (error) throw error;
      if (!members || members.length === 0) return true;

      // Get profile names
      const userIds = members.map((m: any) => m.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);

      const profileMap: Record<string, string> = {};
      (profiles || []).forEach((p: any) => {
        profileMap[p.id] = p.full_name || '';
      });

      const repList: Rep[] = members.map((m: any) => ({
        id: m.id || m.user_id,
        userId: m.user_id,
        name: profileMap[m.user_id] || m.role || 'Membre',
        teamId: m.team_id || null,
      }));

      setReps(repList);
      return true;
    } catch (err) {
      console.error('[D2DSettingsTeams] Failed to fetch reps:', err);
      return false;
    }
  }, []);

  // ------------------------------------------
  // Initial data load
  // ------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [teamsOk, repsOk] = await Promise.all([fetchTeams(), fetchReps()]);

      if (cancelled) return;

      // Fallback to mock data if both fail
      if (!teamsOk) setTeams(fallbackTeams);
      if (!repsOk) setReps(fallbackReps);

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [fetchTeams, fetchReps]);

  // ------------------------------------------
  // Create team
  // ------------------------------------------
  async function handleCreateTeam() {
    if (!newTeamName.trim() || saving) return;
    setSaving(true);
    try {
      const record = await apiCreateTeam({ name: newTeamName.trim() });
      setTeams((prev) => [...prev, { id: record.id, name: record.name }]);
      setNewTeamName('');
    } catch (err) {
      console.error('[D2DSettingsTeams] Failed to create team:', err);
      // Fallback: add locally
      const team: Team = { id: `t-${Date.now()}`, name: newTeamName.trim() };
      setTeams((prev) => [...prev, team]);
      setNewTeamName('');
    } finally {
      setSaving(false);
    }
  }

  // ------------------------------------------
  // Delete team — unassigns all reps
  // ------------------------------------------
  async function handleDeleteTeam(teamId: string) {
    if (saving) return;
    setSaving(true);
    try {
      await apiSoftDeleteTeam(teamId);
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
      setReps((prev) => prev.map((r) => (r.teamId === teamId ? { ...r, teamId: null } : r)));
    } catch (err) {
      console.error('[D2DSettingsTeams] Failed to delete team:', err);
      // Fallback: remove locally
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
      setReps((prev) => prev.map((r) => (r.teamId === teamId ? { ...r, teamId: null } : r)));
    } finally {
      setSaving(false);
    }
  }

  // ------------------------------------------
  // Rename team
  // ------------------------------------------
  async function handleRenameTeam(teamId: string) {
    if (!editingTeamName.trim() || saving) return;
    setSaving(true);
    try {
      const record = await apiUpdateTeam(teamId, { name: editingTeamName.trim() });
      setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, name: record.name } : t)));
    } catch (err) {
      console.error('[D2DSettingsTeams] Failed to rename team:', err);
      // Fallback: rename locally
      setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, name: editingTeamName.trim() } : t)));
    } finally {
      setEditingTeamId(null);
      setEditingTeamName('');
      setSaving(false);
    }
  }

  // ------------------------------------------
  // Assign / unassign rep
  // ------------------------------------------
  async function handleAssignRep(repId: string, teamId: string | null) {
    if (saving) return;

    // Optimistic update
    setReps((prev) => prev.map((r) => (r.id === repId ? { ...r, teamId } : r)));

    try {
      await supabase
        .from('memberships')
        .update({ team_id: teamId, updated_at: new Date().toISOString() })
        .eq('id', repId);
    } catch (err) {
      console.error('[D2DSettingsTeams] Failed to assign rep:', err);
      // Keep optimistic update — assignment is stored locally as fallback
    }
  }

  // ------------------------------------------
  // Helpers
  // ------------------------------------------
  function getRepsForTeam(teamId: string) {
    return reps.filter((r) => r.teamId === teamId);
  }

  const unassignedReps = reps.filter((r) => r.teamId === null);

  // ------------------------------------------
  // Loading state
  // ------------------------------------------
  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Équipes</h2>
          <p className="text-xs text-text-tertiary">
            Créez des équipes et assignez vos reps.
          </p>
        </div>
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-text-muted" />
          <span className="ml-2 text-[13px] text-text-muted">Chargement...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Équipes</h2>
        <p className="text-xs text-text-tertiary">
          Créez des équipes et assignez vos reps.
        </p>
      </div>

      {/* Create team */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-[13px] font-bold text-text-primary">Nouvelle équipe</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateTeam()}
              placeholder="Nom de l'équipe..."
              className="flex-1 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-[13px] text-text-primary placeholder-text-muted outline-none focus:border-outline-strong"
            />
            <button
              onClick={handleCreateTeam}
              disabled={!newTeamName.trim() || saving}
              className="flex items-center gap-1.5 rounded-lg bg-text-primary px-4 py-2 text-[13px] font-semibold text-surface transition-colors hover:opacity-90 disabled:opacity-40"
            >
              <Plus size={14} />
              Créer
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Teams list */}
      {teams.map((team) => {
        const teamReps = getRepsForTeam(team.id);
        const isEditing = editingTeamId === team.id;

        return (
          <Card key={team.id}>
            <CardContent className="p-4">
              {/* Team header */}
              <div className="flex items-center justify-between">
                {isEditing ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editingTeamName}
                      onChange={(e) => setEditingTeamName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRenameTeam(team.id)}
                      autoFocus
                      className="flex-1 rounded-lg border border-outline-strong bg-surface-elevated px-3 py-1.5 text-[13px] font-semibold text-text-primary outline-none"
                    />
                    <button
                      onClick={() => handleRenameTeam(team.id)}
                      disabled={saving}
                      className="rounded-lg bg-text-primary px-3 py-1.5 text-[11px] font-semibold text-surface"
                    >
                      OK
                    </button>
                    <button
                      onClick={() => setEditingTeamId(null)}
                      className="rounded-lg border border-border-subtle px-3 py-1.5 text-[11px] text-text-muted"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary">
                      <Users size={15} className="text-text-secondary" />
                    </div>
                    <div>
                      <p className="text-[14px] font-bold text-text-primary">{team.name}</p>
                      <p className="text-[11px] text-text-muted">{teamReps.length} rep{teamReps.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                )}

                {!isEditing && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingTeamId(team.id); setEditingTeamName(team.name); }}
                      className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary"
                    >
                      Renommer
                    </button>
                    <button
                      onClick={() => handleDeleteTeam(team.id)}
                      disabled={saving}
                      className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-red-400/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      Supprimer
                    </button>
                  </div>
                )}
              </div>

              {/* Team members */}
              {teamReps.length > 0 && (
                <div className="mt-3 space-y-1">
                  {teamReps.map((rep) => (
                    <div
                      key={rep.id}
                      className="flex items-center justify-between rounded-lg bg-surface-elevated px-3 py-2"
                    >
                      <div className="flex items-center gap-2.5">
                        <Avatar name={rep.name} size="sm" />
                        <span className="text-[13px] font-medium text-text-primary">{rep.name}</span>
                      </div>
                      <button
                        onClick={() => handleAssignRep(rep.id, null)}
                        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >
                        <X size={10} />
                        Retirer
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add rep dropdown */}
              {unassignedReps.length > 0 && (
                <div className="mt-3">
                  <RepAssignDropdown
                    unassignedReps={unassignedReps}
                    onAssign={(repId) => handleAssignRep(repId, team.id)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Unassigned reps */}
      {unassignedReps.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-[13px] font-bold text-text-primary">
              Reps non assignés
              <span className="ml-1.5 text-[11px] font-normal text-text-muted">({unassignedReps.length})</span>
            </p>
            <div className="space-y-1">
              {unassignedReps.map((rep) => (
                <div
                  key={rep.id}
                  className="flex items-center justify-between rounded-lg bg-surface-elevated px-3 py-2"
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar name={rep.name} size="sm" />
                    <span className="text-[13px] font-medium text-text-primary">{rep.name}</span>
                  </div>
                  {teams.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleAssignRep(rep.id, e.target.value);
                      }}
                      className="rounded-lg border border-border-subtle bg-surface px-2 py-1 text-[11px] text-text-secondary outline-none"
                    >
                      <option value="">Assigner à...</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {teams.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-subtle py-12 text-center">
          <Users size={32} className="text-text-muted/30" />
          <p className="mt-3 text-[13px] font-medium text-text-secondary">Aucune équipe</p>
          <p className="mt-0.5 text-[11px] text-text-muted">Créez votre première équipe ci-dessus.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rep assign dropdown — small inline component
// ---------------------------------------------------------------------------

function RepAssignDropdown({
  unassignedReps,
  onAssign,
}: {
  unassignedReps: Rep[];
  onAssign: (repId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-border-subtle px-3 py-1.5 text-[11px] font-medium text-text-muted transition-colors hover:border-outline-strong hover:text-text-primary"
      >
        <Plus size={12} />
        Ajouter un rep
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-border-subtle bg-surface-elevated py-1 shadow-lg">
          {unassignedReps.map((rep) => (
            <button
              key={rep.id}
              onClick={() => { onAssign(rep.id); setOpen(false); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-secondary transition-colors hover:bg-surface-hover"
            >
              <Avatar name={rep.name} size="sm" />
              {rep.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
