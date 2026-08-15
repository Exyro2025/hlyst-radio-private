'use client';

// Genre lock — the quick "only this genre, for N minutes" control. A sibling
// of TakeoverCard (#930): where that card pins an EXISTING show, this one
// skips the show-builder detour entirely — pick genre(s) and a duration, and
// POST /schedule/genre-lock upserts one reserved show (GENRE_LOCK_SHOW_ID)
// with those genres + a hard filter, then pins it exactly like a takeover.
// The reserved show is a normal, visible show (it lists at /admin/shows,
// editable like any other), so this card never needs its own copy of the
// show's fields — the pinned show's NAME already carries the genre label
// ("🔒 Jazz, Soul"), because the route names it that way.
//
// Like TakeoverCard, this fetches for itself: GET /schedule is the read both
// cards share, and each POSTs/DELETEs the one mutation it owns.

import { useEffect, useState } from 'react';
import { Controller, useController } from 'react-hook-form';
import { useAdminAuth } from '../../../lib/adminAuth';
import { notify, errorMessage } from '../../../lib/notify';
import { fmtClock } from '../../../lib/format';
import type { StationLocale } from '../../../lib/types';
import { cn } from '../../../lib/cn';
import { useZodForm, applyServerFieldErrors } from '@/lib/form';
import { TextField } from '@/lib/form-fields';
import { Input } from '../../ui/input';
import { Card, Btn, Pill, Seg } from '../ui';
import GenreSuggest from '../GenreSuggest';
import {
  genreLockRequestSchema,
  GENRE_LOCK_SHOW_ID,
  GENRE_LOCK_GENRE_MAX,
  GENRE_LOCK_GENRES_MAX,
  OVERRIDE_MIN_MINUTES,
  OVERRIDE_MAX_MINUTES,
  type ScheduleOverride,
} from '@/lib/schemas.generated';

interface LockedShow {
  id: string;
  name: string;
}

const PRESETS = [
  { minutes: 60, label: '1h' },
  { minutes: 120, label: '2h' },
  { minutes: 180, label: '3h' },
];

export function GenreLockCard({ tz, locale }: { tz?: string; locale?: StationLocale }) {
  const { adminFetch, needsAuth, hydrated } = useAdminAuth();
  const [shows, setShows] = useState<LockedShow[]>([]);
  const [override, setOverride] = useState<ScheduleOverride | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [genreDraft, setGenreDraft] = useState('');

  const form = useZodForm(genreLockRequestSchema, { genres: [], minutes: 60 });
  // Array field — a raw Controller, like ShowEditor's own genresCtl, rather
  // than TextField/SwitchField (neither covers a chip list).
  const genresCtl = useController({ control: form.control, name: 'genres' });
  const genres: string[] = genresCtl.field.value ?? [];

  // Same 30s poll TakeoverCard runs, on the same endpoint — a lock made here,
  // in another tab, or lapsing on its own lands on screen without a reload.
  // Never touches the form: a poll mid-type must not clobber a half-built
  // genre list.
  useEffect(() => {
    if (!hydrated || needsAuth) return;
    let cancelled = false;
    const tick = async () => {
      setNow(Date.now());
      try {
        const r = await adminFetch('/schedule');
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as { shows?: LockedShow[]; override?: ScheduleOverride | null };
        setShows(
          Array.isArray(j.shows)
            ? j.shows.filter(s => s && typeof s.id === 'string' && s.id)
            : [],
        );
        setOverride(j.override ?? null);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hydrated, needsAuth]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only OUR concern: a live override that isn't the genre-lock show is
  // someone else's takeover (TakeoverCard already renders that state) — this
  // card stays on the picker so a fresh lock can still be pinned over it,
  // same "re-POST replaces" contract the override route documents.
  const live = override && override.expiresAt > now && override.showId === GENRE_LOCK_SHOW_ID ? override : null;
  const lockedShow = live ? shows.find(s => s.id === GENRE_LOCK_SHOW_ID) ?? null : null;
  const minutesLeft = live ? Math.max(1, Math.ceil((live.expiresAt - now) / 60_000)) : 0;
  // The route names the reserved show "🔒 <genres>" — strip the emoji back
  // off for display here since the card already has its own "on air" pill.
  const lockedLabel = lockedShow?.name.replace(/^🔒\s*/, '') ?? '';

  const addGenre = (g: string) => {
    const v = g.trim().slice(0, GENRE_LOCK_GENRE_MAX);
    if (!v || genres.length >= GENRE_LOCK_GENRES_MAX) return;
    if (genres.some(x => x.toLowerCase() === v.toLowerCase())) {
      setGenreDraft('');
      return;
    }
    genresCtl.field.onChange([...genres, v]);
    setGenreDraft('');
  };
  const removeGenre = (g: string) => genresCtl.field.onChange(genres.filter(x => x !== g));

  const lock = form.handleSubmit(async (values) => {
    setBusy(true);
    try {
      const r = await adminFetch('/schedule/genre-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        fieldErrors?: Record<string, string>;
        override?: ScheduleOverride;
        show?: LockedShow;
      };
      if (!r.ok) {
        applyServerFieldErrors(form, j.fieldErrors);
        throw new Error(j.error || `failed (${r.status})`);
      }
      setOverride(j.override ?? null);
      if (j.show) setShows(prev => [...prev.filter(s => s.id !== j.show!.id), j.show!]);
      // eslint-disable-next-line react-hooks/purity
      setNow(Date.now());
      notify.ok(`genre locked to ${values.genres.join(', ')} — the switch airs on the next track.`);
      form.reset({ genres: [], minutes: values.minutes });
    } catch (e) {
      notify.err(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  const cancel = async () => {
    setBusy(true);
    try {
      const r = await adminFetch('/schedule/override', { method: 'DELETE' });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || `failed (${r.status})`);
      setOverride(null);
      notify.ok('Genre lock cancelled — back to the weekly schedule.');
    } catch (e) {
      notify.err(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onAir = !!live;

  return (
    <Card
      title="Genre lock"
      sub={onAir ? undefined : 'only this genre, for a while'}
      className={cn(onAir && 'shadow-[0_0_0_2px_color-mix(in_oklab,var(--accent)_28%,transparent)]')}
      right={onAir ? <Pill tone="accent" dot>on air</Pill> : undefined}
    >
      {onAir ? (
        <div className="grid gap-2.5">
          <div className="grid gap-1 border border-[color-mix(in_oklab,var(--accent)_35%,transparent)] bg-[var(--accent-soft)] px-2.5 py-2">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 truncate text-[13px] font-bold text-ink">🔒 {lockedLabel}</span>
              <span className="mono-num ml-auto flex-none text-[10px] whitespace-nowrap text-muted">
                ends {fmtClock(live!.expiresAt, tz, locale)}
              </span>
            </div>
            <div className="text-[10px] text-muted">only this genre plays · {minutesLeft} min left</div>
          </div>
          <Btn sm className="w-full" disabled={busy} onClick={cancel}>
            {busy ? 'cancelling…' : 'Cancel lock'}
          </Btn>
        </div>
      ) : (
        <div className="grid gap-2.5">
          <div className="grid gap-1.5">
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {genres.map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => removeGenre(g)}
                    className="min-h-9 border border-ink bg-ink px-2 py-0.5 text-[12px] text-bg sm:min-h-0"
                    title="Remove this genre"
                  >
                    {g} ×
                  </button>
                ))}
              </div>
            )}
            <div className="flex min-w-0 gap-2">
              <Input
                type="text"
                value={genreDraft}
                maxLength={GENRE_LOCK_GENRE_MAX}
                onChange={e => setGenreDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGenre(genreDraft); } }}
                placeholder={genres.length ? 'add another genre' : 'e.g. Jazz'}
                disabled={genres.length >= GENRE_LOCK_GENRES_MAX}
                aria-label="Genre"
              />
              <Btn
                className="min-h-9 flex-none sm:min-h-0"
                onClick={() => addGenre(genreDraft)}
                disabled={!genreDraft.trim() || genres.length >= GENRE_LOCK_GENRES_MAX}
              >
                Add
              </Btn>
            </div>
            <GenreSuggest adminFetch={adminFetch} value={genreDraft} onSelect={addGenre} />
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Controller
              control={form.control}
              name="minutes"
              render={({ field }) => (
                <Seg
                  value={String(field.value)}
                  options={PRESETS.map(p => ({ id: String(p.minutes), label: p.label }))}
                  onChange={id => field.onChange(Number(id))}
                />
              )}
            />
            <TextField
              control={form.control}
              name="minutes"
              label="Lock minutes"
              numeric
              className="max-w-32"
              min={OVERRIDE_MIN_MINUTES}
              max={OVERRIDE_MAX_MINUTES}
            />
          </div>
          <Btn
            tone="accent"
            sm
            className="w-full"
            disabled={busy || genres.length === 0 || !form.formState.isValid}
            onClick={lock}
          >
            {busy ? 'locking…' : 'Lock it in →'}
          </Btn>
          <div className="text-[10px] text-muted">
            hard-filters to these genres · the switch airs on the next track · the schedule picks up again after
          </div>
        </div>
      )}
    </Card>
  );
}
