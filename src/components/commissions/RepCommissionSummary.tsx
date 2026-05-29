import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../d2d/card';
import { Avatar } from '../d2d/avatar';
import { getRepAvatar } from '../../lib/constants/avatars';
import type { FsCommissionEntry } from '../../types';

interface Props {
  entries: FsCommissionEntry[];
  profileMap: Record<string, string>;
  /** Called when a rep row is clicked; admin can open a drilldown */
  onSelectRep?: (userId: string) => void;
}

interface RepRow {
  userId: string;
  name: string;
  deals: number;
  totalEarned: number;
  pending: number;
  paid: number;
}

function fmtMoney(n: number) {
  return '$' + Number(n || 0).toLocaleString('en-US');
}

/**
 * Per-rep summary table — used in the admin/owner overview tab to surface the
 * top performers and let the viewer drill into a specific rep.
 */
export default function RepCommissionSummary({ entries, profileMap, onSelectRep }: Props) {
  const byRep = new Map<string, RepRow>();
  for (const e of entries) {
    const row = byRep.get(e.user_id) ?? {
      userId: e.user_id,
      name: profileMap[e.user_id] ?? e.rep_name ?? e.user_id,
      deals: 0,
      totalEarned: 0,
      pending: 0,
      paid: 0,
    };
    row.deals += 1;
    row.totalEarned += Number(e.amount || 0);
    if (e.status === 'pending') row.pending += Number(e.amount || 0);
    if (e.status === 'paid') row.paid += Number(e.amount || 0);
    byRep.set(e.user_id, row);
  }
  const rows = Array.from(byRep.values()).sort((a, b) => b.totalEarned - a.totalEarned);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales reps</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Rep</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Deals</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Pending</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Paid</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Total earned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.userId}
                  className="border-b border-border-subtle last:border-b-0 table-row-hover cursor-pointer"
                  onClick={() => onSelectRep?.(r.userId)}
                >
                  <td className="px-5 py-2.5">
                    {onSelectRep ? (
                      <button className="flex items-center gap-2 hover:underline" onClick={(ev) => { ev.stopPropagation(); onSelectRep(r.userId); }}>
                        <Avatar name={r.name} src={getRepAvatar(r.name)} size="sm" className="!h-5 !w-5 !text-[8px]" />
                        <span className="text-sm font-medium text-text-primary">{r.name}</span>
                      </button>
                    ) : (
                      <Link to={`/reps/${r.userId}`} className="flex items-center gap-2 hover:underline">
                        <Avatar name={r.name} src={getRepAvatar(r.name)} size="sm" className="!h-5 !w-5 !text-[8px]" />
                        <span className="text-sm font-medium text-text-primary">{r.name}</span>
                      </Link>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right text-sm text-text-secondary">{r.deals}</td>
                  <td className="px-5 py-2.5 text-right text-sm text-warning">{fmtMoney(r.pending)}</td>
                  <td className="px-5 py-2.5 text-right text-sm text-success">{fmtMoney(r.paid)}</td>
                  <td className="px-5 py-2.5 text-right text-sm font-semibold text-text-primary">{fmtMoney(r.totalEarned)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-text-muted">
                    No sales reps with commissions yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
