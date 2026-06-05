import { X } from 'lucide-react';
import type { AcpAccount, AcpUsageData, AcpUsageWindow } from '../lib/protocol';

const CORAL = '#c96442';

function fmtResets(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Resets now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `Resets in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Resets in ${h}h`;
  return `Resets in ${Math.floor(h / 24)}d`;
}
const planLabel = (t?: string) => (t ? `Claude ${t.charAt(0).toUpperCase()}${t.slice(1)}` : '—');
const authLabel = (m?: string) => (!m ? '—' : m === 'claude.ai' ? 'Claude AI' : m);

function UsageBar({ label, win }: { label: string; win?: AcpUsageWindow | null }) {
  if (!win) return null;
  const pct = Math.max(0, Math.min(100, Math.round(win.utilization)));
  return (
    <div className="mt-3">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums">{pct}%</span></div>
      <div className="mt-1 h-1.5 rounded-full bg-base-300 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CORAL }} />
      </div>
      <div className="text-[11px] text-base-content/40 mt-0.5">{fmtResets(win.resets_at)}</div>
    </div>
  );
}

function AccountRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-base-200 last:border-0">
      <span className="text-base-content/50 shrink-0">{k}</span>
      <span className="font-medium text-right truncate">{v}</span>
    </div>
  );
}

export interface UsageDetail { account: AcpAccount | null; usage: AcpUsageData | null }

export default function UsageModal({ detail, onClose }: { detail: UsageDetail | null; onClose: () => void }) {
  const acc = detail?.account;
  const usage = detail?.usage;
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-md">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">Account &amp; Usage</h3>
          <button className="btn btn-sm btn-ghost btn-circle" onClick={onClose}><X size={16} /></button>
        </div>
        {!detail ? (
          <div className="py-12 flex justify-center"><span className="loading loading-spinner" /></div>
        ) : (
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wider text-base-content/40 font-semibold mb-1">Account</div>
            <AccountRow k="Auth method" v={authLabel(acc?.authMethod)} />
            <AccountRow k="Email" v={acc?.email ?? '—'} />
            <AccountRow k="Organization" v={acc?.orgName ?? '—'} />
            <AccountRow k="Plan" v={planLabel(acc?.subscriptionType)} />

            <div className="text-[11px] uppercase tracking-wider text-base-content/40 font-semibold mt-5">Usage</div>
            {usage ? (
              <>
                <UsageBar label="Session (5hr)" win={usage.five_hour} />
                <UsageBar label="Weekly (7 day)" win={usage.seven_day} />
                <UsageBar label="Weekly Opus" win={usage.seven_day_opus} />
                <UsageBar label="Weekly Sonnet" win={usage.seven_day_sonnet} />
                {usage.extra_usage && usage.extra_usage.used_credits > 0 && (
                  <div className="mt-3 text-sm flex justify-between">
                    <span>Extra usage</span>
                    <span>{usage.extra_usage.used_credits} {usage.extra_usage.currency}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-base-content/50 mt-2">Usage data unavailable.</div>
            )}
            <a className="mt-5 inline-block text-sm" style={{ color: CORAL }} href="https://claude.ai/settings/usage" target="_blank" rel="noreferrer">
              Manage usage on claude.ai
            </a>
          </div>
        )}
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}
