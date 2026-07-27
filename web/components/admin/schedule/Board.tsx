'use client';

// The board — a kanban-style 7-column × 24-hour view of the week, all seven
// days always open. Shows are cards whose height equals their duration; silent
// runs are hatched slots. Direct manipulation everywhere: click a silent slot
// (or drop a shelf chip on it) to book a show over those hours, click a card to
// load its order into the Write-an-order line, click a card's × to take the run
// off the air. Every write is a local edit — Save the week persists.
//
// Two geometry rules earn their keep (#1204):
//
//  * The seven columns divide whatever width the board is given from `sm` up
//    (`sm:w-full` + `sm:min-w-0`) instead of holding a 188px floor. At that
//    floor the board's intrinsic width was 1428px against ~1072px of admin
//    content on a 1280 laptop, so a quarter of the week sat off-screen and the
//    hour gutter — which had been released from `sticky` at `sm` on the
//    assumption the board fits there — scrolled away with it, leaving an
//    unlabelled field of hatched rectangles. Columns that shrink mean no
//    horizontal scroll at all on a laptop, and the gutter now stays pinned at
//    every width for the narrow windows where scroll survives.
//  * The hour unit is a CSS variable (`--hour-px`) set from the density
//    preference, so the gutter's static `h-[var(--hour-px)]` and each card's
//    computed `calc()` height can never drift apart.

import type { DragEvent } from 'react';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useDynamicStyle } from '../../../hooks/useDynamicStyle';
import { cn } from '../../../lib/cn';
import type { BoardDensity } from '../../../lib/adminView';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { ScrollArea, ScrollBar } from '../../ui/scroll-area';
import { Seg } from '../ui';
import { ColorChip, Mu } from './bits';
import type { Block, Schedule, ScheduleShow } from './lib';
import { DAYS, HOURS, dayBlocks, hh } from './lib';

const DND_TYPE = 'text/x-subwave-show';

function readDraggedShow(e: DragEvent): string {
  return e.dataTransfer.getData(DND_TYPE) || e.dataTransfer.getData('text/plain');
}

export interface BoardProps {
  schedule: Schedule;
  shows: ScheduleShow[];
  folded: Record<number, boolean>;
  onToggleFold: (day: number) => void;
  todayKey: number;
  colorOf: (id: string | null | undefined) => string;
  hoursOf: (id: string) => number;
  onPick: (b: Block) => void;
  onRemove: (b: Block) => void;
  onDropShow: (b: Block, showId: string) => void;
  /** The armed show — the shelf chip acting as a brush, or null. */
  armedShowId: string | null;
  /** Arm/disarm a shelf chip (the same id twice disarms). */
  onArmShow: (id: string) => void;
  /** Bulk writes behind a day header / an hour in the gutter. Only reachable
   *  with a show armed; both toggle off when the target already runs it. */
  onFillDay: (day: number) => void;
  onFillHour: (hour: number) => void;
  density: BoardDensity;
  hourPx: number;
  onDensity: (d: BoardDensity) => void;
}

export default function Board({
  schedule, shows, folded, onToggleFold, todayKey,
  colorOf, hoursOf, onPick, onRemove, onDropShow,
  armedShowId, onArmShow, onFillDay, onFillHour,
  density, hourPx, onDensity,
}: BoardProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  useDynamicStyle(gridRef, { '--hour-px': `${hourPx}px` });
  const armedName = shows.find(s => s.id === armedShowId)?.name ?? null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-2 px-5 sm:px-[30px]">
        <Mu className="min-w-0 flex-1 tracking-[0.08em]">
          {armedName
            ? `${armedName} is armed — click any hour to book it, a day header for the whole day, or an hour in the gutter for that hour all week`
            : 'Click a silent hour (or drag a show onto it) to book a show — click a card to edit its order, its × to take it off the air'}
        </Mu>
        <span className="ml-auto flex flex-none items-center gap-2">
          <Mu className="hidden text-[8.5px] sm:inline">Rows</Mu>
          <Seg
            value={density}
            onChange={v => onDensity(v === 'compact' ? 'compact' : 'comfortable')}
            options={[
              { id: 'comfortable', title: 'Comfortable rows — the full hour range on every card', label: 'Roomy' },
              { id: 'compact', title: 'Compact rows — a shorter board that clears the fold', label: 'Compact' },
            ]}
          />
        </span>
      </div>

      {/* The shelf — one draggable chip per show, a single scrolling tray so
          any number of shows stays one line tall. A chip is also a brush:
          click to arm it, then fill hours, days or a whole hour-of-the-week
          from the board without returning here. */}
      <div className="mx-5 mb-3.5 border border-ink bg-[var(--page-bg)] sm:mx-[30px]">
        <ScrollArea>
          <div className="flex w-max min-w-full items-center gap-2 px-3 py-2.5">
            <span className="eyebrow mr-1 flex-none text-ink">The shelf</span>
        {shows.length === 0 && (
          <Mu className="text-[9px] normal-case">
            No shows yet —{' '}
            <Link href="/admin/shows" className="text-vermilion underline">
              define one on the Shows page
            </Link>{' '}
            to start scheduling.
          </Mu>
        )}
        {shows.map(s => {
          const armed = s.id === armedShowId;
          return (
            <button
              key={s.id}
              type="button"
              draggable
              aria-pressed={armed}
              onDragStart={e => {
                e.dataTransfer.setData(DND_TYPE, s.id);
                e.dataTransfer.setData('text/plain', s.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onArmShow(s.id)}
              title={armed
                ? `“${s.name}” is armed — click hours on the board to book it, or click here to put the brush down`
                : `Click to arm “${s.name}” as a brush, or drag it onto the board`}
              className={cn(
                'flex min-h-9 flex-none cursor-grab items-center gap-1.5 border px-2.5 py-1.5 active:cursor-grabbing sm:min-h-0',
                armed
                  ? 'border-ink bg-[var(--ink-soft)] outline-2 -outline-offset-2 outline-[var(--accent)]'
                  : 'border-separator-strong bg-[var(--card-bg)] hover:border-ink',
              )}
            >
              <ColorChip color={colorOf(s.id)} />
              <span className="text-[11.5px] font-semibold whitespace-nowrap text-ink">{s.name}</span>
              <Mu className="text-[8px]">{hoursOf(s.id)}h</Mu>
            </button>
          );
        })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* On a phone the week is a horizontal strip and Radix only reveals its
          scrollbar on hover, so name the gesture — and the span — outright.
          From sm up the columns divide the available width, so there is
          nothing to swipe. */}
      <Mu className="mb-1.5 flex items-center gap-1.5 px-5 tracking-[0.08em] sm:hidden">
        <span aria-hidden="true">◂</span>
        Swipe the board — Mon through Sun
        <span aria-hidden="true">▸</span>
      </Mu>

      <ScrollArea>
        <div ref={gridRef} className="flex w-max min-w-full items-start gap-2.5 pb-1.5 sm:w-full">
          {/* Hour gutter — pt clears the 38px column headers (+border+padding).
              Pinned at every width: on a phone the week is a scrolling strip,
              and in a narrow desktop window the columns bottom out and the
              board scrolls too. Either way the hour a card sits on has to stay
              readable, which is exactly what releasing this at `sm` broke. */}
          <div className="sticky left-0 z-10 w-[42px] flex-none bg-[var(--card-bg)] pt-[43px]">
            {HOURS.map(h => (
              // aria-disabled, not disabled: Firefox drops the tooltip (and
              // focus) on a disabled control, and the title is the only
              // in-place explanation of what arming a show unlocks here.
              <button
                key={h}
                type="button"
                aria-disabled={!armedShowId}
                onClick={armedShowId ? () => onFillHour(h) : undefined}
                title={armedName
                  ? `Put “${armedName}” on ${hh(h)}:00 every day (again to clear it)`
                  : `${hh(h)}:00 — arm a show on the shelf to fill this hour all week`}
                className={cn(
                  'flex h-[var(--hour-px)] w-full items-start justify-end border-0 bg-transparent pr-[7px] font-mono text-[9px] font-bold text-muted opacity-80',
                  armedShowId
                    ? 'cursor-pointer hover:text-vermilion hover:opacity-100'
                    : 'cursor-default',
                )}
              >
                {hh(h)}
              </button>
            ))}
          </div>

          {DAYS.map(d =>
            folded[d.key] ? (
              <FoldedRail
                key={d.key}
                label={d.label}
                name={d.name}
                count={dayBlocks(schedule, d.key).filter(b => b.showId).length}
                onClick={() => onToggleFold(d.key)}
              />
            ) : (
              <DayColumn
                key={d.key}
                label={d.label}
                name={d.name}
                today={d.key === todayKey}
                blocks={dayBlocks(schedule, d.key)}
                colorOf={colorOf}
                shows={shows}
                density={density}
                armedShowId={armedShowId}
                armedName={armedName}
                onToggleFold={() => onToggleFold(d.key)}
                onFillDay={() => onFillDay(d.key)}
                onPick={onPick}
                onRemove={onRemove}
                onDropShow={onDropShow}
              />
            ),
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <Mu className="mt-1 block px-5 tracking-[0.08em] sm:px-[30px]">
        Hatched hours are silent — click one to book a show, or leave the station to run itself
      </Mu>
    </section>
  );
}

function DayColumn({
  label, name, today, blocks, colorOf, shows, density, armedShowId, armedName,
  onToggleFold, onFillDay, onPick, onRemove, onDropShow,
}: {
  label: string;
  name: string;
  today: boolean;
  blocks: Block[];
  colorOf: (id: string | null | undefined) => string;
  shows: ScheduleShow[];
  density: BoardDensity;
  armedShowId: string | null;
  armedName: string | null;
  onToggleFold: () => void;
  onFillDay: () => void;
  onPick: (b: Block) => void;
  onRemove: (b: Block) => void;
  onDropShow: (b: Block, showId: string) => void;
}) {
  const showById = (id: string | null) => shows.find(s => s.id === id) ?? null;
  const booked = blocks.reduce((a, b) => a + (b.showId ? b.span : 0), 0);
  return (
    // A phone still gets a fixed-width scrolling strip narrow enough that the
    // next day peeks past the right edge; from sm up `min-w-0` lets the seven
    // columns divide the board's width instead of forcing it past the screen.
    <div className="flex min-w-[164px] flex-1 flex-col border border-ink bg-[var(--page-bg)] sm:min-w-0">
      {/* The header fills the day with the armed brush — the bulk gesture the
          paint-brush grid had. Fold moved to the footer, where the column was
          already printing the word. aria-disabled rather than disabled so the
          explanatory title still shows in Firefox (see the hour gutter). */}
      <button
        type="button"
        aria-disabled={!armedShowId}
        onClick={armedShowId ? onFillDay : undefined}
        title={armedName
          ? `Put “${armedName}” on all of ${name} (again to clear it)`
          : `${name} — arm a show on the shelf to fill the whole day in one click`}
        className={cn(
          'flex h-[38px] items-center gap-2 border-0 border-b border-solid border-b-ink bg-transparent px-2.5',
          armedShowId ? 'cursor-pointer hover:bg-[var(--ink-soft)]' : 'cursor-default',
        )}
      >
        <span
          aria-hidden="true"
          className={cn('size-[7px] rounded-full', today ? 'bg-[var(--accent)]' : 'bg-ink')}
        />
        <span className="font-mono text-[11px] font-bold tracking-[0.16em] text-ink">{label}</span>
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center border border-ink bg-[var(--card-bg)] px-1 font-mono text-[9px] font-bold text-ink">
          {blocks.filter(b => b.showId).length}
        </span>
      </button>
      <div className="flex flex-col gap-1 p-[5px]">
        {blocks.map(b =>
          b.showId ? (
            <BoardCard
              key={`${b.start}`}
              block={b}
              name={showById(b.showId)?.name ?? 'unknown show'}
              color={colorOf(b.showId)}
              density={density}
              onPick={onPick}
              onRemove={onRemove}
              onDropShow={onDropShow}
            />
          ) : (
            <DropSlot
              key={`${b.start}`}
              block={b}
              shows={shows}
              colorOf={colorOf}
              armedShowId={armedShowId}
              armedName={armedName}
              onDropShow={onDropShow}
            />
          ),
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-separator-strong px-2.5 py-2">
        <Mu className="text-[8px]">{booked} h booked</Mu>
        {/* min-h-9 on a phone: fold used to be the 38px header, and an 8px
            text label alone is no tap target. */}
        <button
          type="button"
          onClick={onToggleFold}
          title={`Fold ${name} out of the way`}
          className="ml-auto min-h-9 cursor-pointer border-0 bg-transparent p-0 font-mono text-[8px] tracking-[0.16em] text-muted uppercase hover:text-ink sm:min-h-0"
        >
          Fold
        </button>
      </div>
    </div>
  );
}

// A folded day — a slim vertical rail; click to reopen the column.
function FoldedRail({
  label, name, count, onClick,
}: {
  label: string;
  name: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Open ${name}`}
      className="flex w-12 flex-none cursor-pointer flex-col items-center gap-3 self-stretch border border-ink bg-[var(--card-bg)] py-2.5 hover:bg-[var(--page-bg)]"
    >
      <span className="flex h-5 min-w-5 items-center justify-center border border-ink bg-[var(--card-bg)] px-1 font-mono text-[9px] font-bold text-ink">
        {count}
      </span>
      <span className="font-mono text-[11px] font-bold tracking-[0.18em] text-ink uppercase [writing-mode:vertical-rl]">
        {label}
      </span>
    </button>
  );
}

// One scheduled run as a card — height encodes duration (one `--hour-px` unit
// per hour). Clicking the card loads its order into the Write-an-order line;
// the × in the corner takes the run off the air (a local edit either way).
//
// A one-hour card has ~24px of content box at the roomy unit and less when
// compact, which is not two lines of type — it was slicing the show's name
// through the middle. Anything that short prints the name alone and leaves the
// hour range to the tooltip, which carried it all along.
function BoardCard({
  block, name, color, density, onPick, onRemove, onDropShow,
}: {
  block: Block;
  name: string;
  color: string;
  density: BoardDensity;
  onPick: (b: Block) => void;
  onRemove: (b: Block) => void;
  onDropShow: (b: Block, showId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useDynamicStyle(ref, {
    height: `calc(var(--hour-px) * ${block.span} - 4px)`,
    background: color,
  });
  // Two lines need both hour units; compact only has the room from three up.
  const showRange = density === 'comfortable' ? block.span > 1 : block.span > 2;
  return (
    <div
      ref={ref}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault();
        setOver(false);
        const id = readDraggedShow(e);
        if (id) onDropShow(block, id);
      }}
      className={cn(
        'group relative overflow-hidden text-[#f6f2ea]',
        'hover:outline-2 hover:-outline-offset-1 hover:outline-ink',
        over && 'outline-2 -outline-offset-1 outline-ink',
      )}
    >
      <button
        type="button"
        onClick={() => onPick(block)}
        title={`${name} · ${hh(block.start)} – ${hh(block.start + block.span)} — click to edit this order`}
        className={cn(
          'flex size-full cursor-pointer flex-col overflow-hidden border-0 bg-transparent px-2 text-left text-inherit',
          showRange ? 'justify-between py-1.5' : 'justify-center py-0.5',
        )}
      >
        <span className="max-w-full overflow-hidden pr-4 font-mono text-[10.5px] leading-[1.2] font-bold tracking-[0.03em] text-ellipsis whitespace-nowrap uppercase">
          {name}
        </span>
        {showRange && (
          <span className="font-mono text-[9px] tracking-[0.06em] whitespace-nowrap opacity-70">
            {hh(block.start)} – {hh(block.start + block.span)}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onRemove(block)}
        aria-label={`Take “${name}” off the air`}
        title={`Take “${name}” off the air`}
        className="absolute top-[3px] right-[3px] flex size-[17px] cursor-pointer items-center justify-center border-0 bg-transparent p-0 font-mono text-[13px] leading-none font-bold text-inherit opacity-0 group-hover:opacity-100 hover:bg-[rgba(0,0,0,0.35)] focus-visible:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

// One silent run as a hatched slot — a drop target, and a click target. With a
// show armed on the shelf the click books it straight away; with nothing armed
// it opens a picker of shows to book over those hours (the same write either
// way, and the same write a drop performs).
function DropSlot({
  block, shows, colorOf, armedShowId, armedName, onDropShow,
}: {
  block: Block;
  shows: ScheduleShow[];
  colorOf: (id: string | null | undefined) => string;
  armedShowId: string | null;
  armedName: string | null;
  onDropShow: (b: Block, showId: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [over, setOver] = useState(false);
  useDynamicStyle(ref, { height: `calc(var(--hour-px) * ${block.span} - 4px)` });
  const span = `${hh(block.start)} – ${hh(block.start + block.span)}`;

  const slot = (
    <button
      ref={ref}
      type="button"
      onClick={armedShowId ? () => onDropShow(block, armedShowId) : undefined}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault();
        setOver(false);
        const id = readDraggedShow(e);
        if (id) onDropShow(block, id);
      }}
      title={armedName
        ? `Silent ${span} — click to put “${armedName}” here`
        : `Silent ${span} — click to book a show here, or drop one in`}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center overflow-hidden border border-dashed bg-[repeating-linear-gradient(45deg,transparent_0_5px,var(--ink-soft)_5px_10px)] px-1.5 font-mono text-[9px] tracking-[0.12em] text-ellipsis whitespace-nowrap uppercase',
        over
          ? 'border-ink text-ink'
          : 'border-[color-mix(in_oklab,var(--ink)_32%,transparent)] text-muted hover:border-ink hover:text-ink',
      )}
    >
      {armedName ? `+ ${armedName}` : '+ Add a show'}
    </button>
  );

  // Armed, the slot writes on click — there is no menu to open.
  if (armedShowId) return slot;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={shows.length === 0}>
        {slot}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-[10rem] overflow-y-auto">
        <DropdownMenuGroup>
          {shows.map(s => (
            <DropdownMenuItem key={s.id} onClick={() => onDropShow(block, s.id)}>
              <ColorChip color={colorOf(s.id)} />
              {s.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
