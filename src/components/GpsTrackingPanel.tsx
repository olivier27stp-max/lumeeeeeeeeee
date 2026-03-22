import React, { useState } from 'react';
import {
  MapPin, Navigation, Wifi, WifiOff, AlertTriangle,
  Play, Square, Shield, ShieldAlert, Eye, EyeOff,
  Signal, SignalLow,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useGpsTracking } from '../hooks/useGpsTracking';

interface GpsTrackingPanelProps {
  teamId?: string | null;
  requireGps?: boolean;
  className?: string;
}

export default function GpsTrackingPanel({ teamId, requireGps = false, className }: GpsTrackingPanelProps) {
  const {
    available, permission, session, watching, lastPosition, error,
    tabHidden, pointCount,
    startTracking, stopTracking, requestPermission,
  } = useGpsTracking();
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const handleStart = async () => {
    setStarting(true);
    try {
      if (permission !== 'granted') {
        const result = await requestPermission();
        if (result === 'denied') return;
      }
      await startTracking(teamId);
    } catch {}
    finally { setStarting(false); }
  };

  const handleStop = async () => {
    setStopping(true);
    try { await stopTracking(); }
    catch {}
    finally { setStopping(false); }
  };

  // Status display
  const isActive = watching && session;
  const isIdle = isActive && lastPosition && (lastPosition.speed_mps ?? 0) < 0.5;
  const accuracyLabel = lastPosition
    ? lastPosition.accuracy_m < 10 ? 'Excellent' : lastPosition.accuracy_m < 30 ? 'Good' : lastPosition.accuracy_m < 100 ? 'Fair' : 'Poor'
    : null;
  const lastUpdate = lastPosition
    ? new Date(lastPosition.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className={cn('rounded-2xl border border-outline-subtle bg-white p-4 space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            'p-1.5 rounded-lg',
            isActive ? 'bg-emerald-100 text-emerald-600' : 'bg-neutral-100 text-neutral-500'
          )}>
            <Navigation size={14} />
          </div>
          <div>
            <p className="text-sm font-bold text-text-primary">GPS Tracking</p>
            <p className="text-[10px] text-text-tertiary">
              {isActive ? (isIdle ? 'Idle' : 'Active') : watching ? 'Starting...' : 'Off'}
            </p>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-1.5">
          {tabHidden && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700 flex items-center gap-1">
              <EyeOff size={9} /> Tab hidden
            </span>
          )}
          {isActive && (
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[9px] font-bold animate-pulse',
              isIdle ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            )}>
              {isIdle ? 'Idle' : 'Tracking'}
            </span>
          )}
        </div>
      </div>

      {/* Permission warning */}
      {!available && (
        <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger flex items-center gap-2">
          <AlertTriangle size={13} />
          GPS is not available in this browser.
        </div>
      )}
      {permission === 'denied' && (
        <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger flex items-center gap-2">
          <ShieldAlert size={13} />
          GPS permission denied. Please enable location access in your browser settings.
        </div>
      )}
      {requireGps && !isActive && permission !== 'denied' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
          <Shield size={13} />
          GPS tracking is required to start your shift.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {/* Live stats */}
      {isActive && lastPosition && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-surface-secondary p-2 text-center">
            <p className="text-[10px] text-text-tertiary font-medium">Accuracy</p>
            <div className="flex items-center justify-center gap-1 mt-0.5">
              {lastPosition.accuracy_m < 30 ? <Signal size={10} className="text-emerald-500" /> : <SignalLow size={10} className="text-amber-500" />}
              <p className="text-xs font-bold text-text-primary">{Math.round(lastPosition.accuracy_m)}m</p>
            </div>
            <p className="text-[9px] text-text-tertiary">{accuracyLabel}</p>
          </div>
          <div className="rounded-lg bg-surface-secondary p-2 text-center">
            <p className="text-[10px] text-text-tertiary font-medium">Points</p>
            <p className="text-xs font-bold text-text-primary mt-0.5">{pointCount}</p>
            <p className="text-[9px] text-text-tertiary">recorded</p>
          </div>
          <div className="rounded-lg bg-surface-secondary p-2 text-center">
            <p className="text-[10px] text-text-tertiary font-medium">Last update</p>
            <p className="text-xs font-bold text-text-primary mt-0.5">{lastUpdate}</p>
            <p className="text-[9px] text-text-tertiary">
              {(lastPosition.speed_mps ?? 0) > 0.5
                ? `${((lastPosition.speed_mps || 0) * 3.6).toFixed(0)} km/h`
                : 'Stationary'}
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {!isActive ? (
          <button
            type="button"
            onClick={handleStart}
            disabled={starting || !available || permission === 'denied'}
            className="flex-1 glass-button-primary inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Play size={13} />
            {starting ? 'Starting...' : 'Start GPS Tracking'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStop}
            disabled={stopping}
            className="flex-1 glass-button inline-flex items-center justify-center gap-2 border-danger/30 text-danger hover:bg-danger/5"
          >
            <Square size={13} />
            {stopping ? 'Stopping...' : 'Stop Tracking'}
          </button>
        )}
      </div>
    </div>
  );
}
