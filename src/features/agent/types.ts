/* Mr Lume Agent — Frontend Types (trimmed after cleanup)
 * Only minimal shared types remain; rich agent protocol types
 * were removed with the backend. */

export interface AgentSession {
  id: string;
  org_id: string;
  title: string | null;
  status: 'active' | 'completed' | 'cancelled';
  message_count: number;
  created_at: string;
}
