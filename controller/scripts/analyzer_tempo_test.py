#!/usr/bin/env python3
# Unit tests for the tempo octave correction (#1417). Pure stdlib — no numpy,
# no librosa, no audio, no network — so it runs anywhere.
# Run: `python3 scripts/analyzer_tempo_test.py` (exit 0 = pass), and via
# scripts/analyzer-python.test.ts as part of `npm test`.
#
# What is actually being pinned here:
#
#   * The bug. librosa's 120-centred prior returns 152 BPM for a 76 BPM ballad.
#     `doubled grid halves` is that exact case in synthetic form, and it is the
#     reason the module exists.
#   * The thing that could make the fix WORSE than the bug. A one-drop or
#     backbeat groove — beats 2 and 4 accented, which is most of soul, reggae,
#     funk and blues — separates its alternating beat sets at the TRUE tempo.
#     A naive strong/weak test halves all of it into nonsense. `backbeat is not
#     a doubling` and `refuses an implausibly slow halving` are the two guards
#     that stop that, and they matter more than the correction itself: a fix
#     that mangles the catalogue it was reported against is not a fix.
#   * That the beat GRID travels with the tempo. beats/bars feed bar-snapped
#     crossfades, so a corrected BPM stamped over an uncorrected grid just
#     relocates the bug into `bars`.

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze_worker as aw  # noqa: E402

failures = 0


def test(name, fn):
    global failures
    try:
        fn()
        print(f"  ✓ {name}")
    except Exception as err:  # noqa: BLE001 — a failed assert is a reported case
        failures += 1
        print(f"  ✗ {name}\n      {err}")


# 22050 Hz at hop 512 is ~43.07 frames/sec, so 76 BPM is a 34-frame period and
# its doubling is 17 — the real numbers from the issue, not round ones.
SLOW_PERIOD = 34
FRAMES = 1723  # ~40s, the ANALYZE_SECONDS window
BACKGROUND = 0.05


def envelope(period, amps, frames=FRAMES, background=BACKGROUND):
    """An onset envelope with pulses every `period` frames, cycling through
    `amps`, over a quiet background."""
    env = [background] * frames
    i = 0
    for frame in range(0, frames, period):
        env[frame] = amps[i % len(amps)]
        i += 1
    return env


def grid(period, frames=FRAMES):
    return list(range(0, frames, period))


# --- the reported bug -------------------------------------------------------

def doubled_grid_halves():
    # Onsets on a 76 BPM pulse; beat_track reported the 152 BPM grid, so half
    # its beats land between the real ones.
    env = envelope(SLOW_PERIOD, [1.0])
    fit = aw.tempo_octave_fit(env, grid(SLOW_PERIOD // 2))
    assert fit is not None, "no fit"
    assert fit["action"] == "halve", f"action={fit['action']} alt={fit['alt']} off={fit['off']}"
    bpm, beats, applied = aw.apply_tempo_octave(152.0, grid(SLOW_PERIOD // 2), fit)
    assert applied, "correction not applied"
    assert abs(bpm - 76.0) < 1e-9, bpm
    # The surviving grid is the real 76 BPM one, not every other frame of the
    # doubled one: consecutive beats a full slow period apart.
    assert beats[1] - beats[0] == SLOW_PERIOD, beats[:4]


def phase_offset_keeps_the_strong_set():
    # Same doubling, but the envelope's pulses line up with the ODD beats of the
    # reported grid — the correction has to keep those, not blindly take [::2].
    reported = grid(SLOW_PERIOD // 2)
    env = [BACKGROUND] * FRAMES
    for b in reported[1::2]:
        env[b] = 1.0
    fit = aw.tempo_octave_fit(env, reported)
    assert fit["action"] == "halve", fit
    assert fit["strongOffset"] == 1, fit
    _bpm, beats, _applied = aw.apply_tempo_octave(152.0, reported, fit)
    assert all(env[b] == 1.0 for b in beats), "kept the silent half of the grid"


def correct_grid_is_left_alone():
    env = envelope(SLOW_PERIOD, [1.0])
    fit = aw.tempo_octave_fit(env, grid(SLOW_PERIOD))
    assert fit["action"] == "keep", fit
    assert fit["confidence"] > 0.8, fit  # unambiguous in both directions
    bpm, beats, applied = aw.apply_tempo_octave(76.0, grid(SLOW_PERIOD), fit)
    assert not applied and bpm == 76.0 and beats == grid(SLOW_PERIOD)


def half_speed_reading_doubles():
    # Onsets on every 17-frame pulse (152 BPM) but the reported grid caught only
    # every other one — the mirror error, which the same tests have to catch.
    env = envelope(SLOW_PERIOD // 2, [1.0])
    fit = aw.tempo_octave_fit(env, grid(SLOW_PERIOD))
    assert fit["action"] == "double", fit
    bpm, beats, applied = aw.apply_tempo_octave(76.0, grid(SLOW_PERIOD), fit)
    assert applied and abs(bpm - 152.0) < 1e-9, bpm
    assert beats[1] - beats[0] == SLOW_PERIOD // 2, beats[:4]


# --- the guards that protect the catalogue ---------------------------------

def backbeat_is_not_a_doubling():
    # A one-drop: beats 2 and 4 carry the accent, so the alternating sets DO
    # separate (0.45 vs 1.0, under the 0.60 threshold) at the true tempo. The
    # quieter beats are still real onsets, far above the envelope's mean, which
    # is what tells them apart from the silence between a doubled grid's beats.
    env = envelope(SLOW_PERIOD, [1.0, 0.45])
    fit = aw.tempo_octave_fit(env, grid(SLOW_PERIOD))
    assert fit["alt"] is not None and fit["alt"] <= aw.OCTAVE_ALT_MAX, \
        f"test is not exercising the guard: alt={fit['alt']}"
    assert fit["action"] == "keep", f"halved a backbeat: {fit}"
    # And it is kept CONFIDENTLY — the doubling test cleanly says no, so the
    # backbeat's uneven accents must not read as ambiguity.
    assert fit["confidence"] > 0.8, fit


def refuses_an_implausibly_slow_halving():
    # Even where the tests do fire, halving below OCTAVE_HALVE_FLOOR is refused:
    # a ~50 BPM perceived pulse is far rarer than a misread accent pattern.
    env = envelope(SLOW_PERIOD, [1.0])
    fit = aw.tempo_octave_fit(env, grid(SLOW_PERIOD // 2))
    assert fit["action"] == "halve", fit
    bpm, beats, applied = aw.apply_tempo_octave(100.0, grid(SLOW_PERIOD // 2), fit)
    assert not applied, "halved to 50 BPM"
    assert bpm == 100.0 and beats == grid(SLOW_PERIOD // 2)


def refuses_an_implausibly_fast_doubling():
    env = envelope(SLOW_PERIOD // 2, [1.0])
    fit = aw.tempo_octave_fit(env, grid(SLOW_PERIOD))
    assert fit["action"] == "double", fit
    bpm, _beats, applied = aw.apply_tempo_octave(120.0, grid(SLOW_PERIOD), fit)
    assert not applied and bpm == 120.0, f"doubled to 240 BPM: {bpm}"


# --- unmeasurable inputs degrade to today's behaviour ----------------------

def too_little_grid_is_unmeasured():
    env = envelope(SLOW_PERIOD, [1.0])
    assert aw.tempo_octave_fit(env, [0, 34, 68]) is None, "judged 3 beats"
    assert aw.tempo_octave_fit(env, []) is None
    assert aw.tempo_octave_fit([], grid(SLOW_PERIOD)) is None
    assert aw.tempo_octave_fit(None, None) is None


def silent_envelope_is_unmeasured():
    assert aw.tempo_octave_fit([0.0] * FRAMES, grid(SLOW_PERIOD)) is None


def beats_past_the_envelope_are_dropped():
    # A grid longer than the envelope (a short decode) must not index out of it.
    env = envelope(SLOW_PERIOD, [1.0], frames=200)
    fit = aw.tempo_octave_fit(env, grid(SLOW_PERIOD, frames=FRAMES))
    assert fit is not None and fit["action"] in ("keep", "halve", "double")


class ArrayLike:
    """Minimal stand-in for a numpy array: iterable and sized, but raises on
    truthiness exactly as numpy does for more than one element. beat_track
    returns a real ndarray, so every entry point has to survive this — and
    `values or []` does not. Reproduced without importing numpy so this suite
    stays dependency-free (the box running it may not have numpy at all).
    """

    def __init__(self, items):
        self._items = list(items)

    def __iter__(self):
        return iter(self._items)

    def __len__(self):
        return len(self._items)

    def __bool__(self):
        raise ValueError(
            "The truth value of an array with more than one element is ambiguous"
        )


def numpy_style_inputs_are_judged_not_swallowed():
    # The regression that pure-list tests cannot see. `beat_frames or []` raises
    # on an ndarray; corrected_tempo catches it, logs, and keeps the reported
    # tempo — so the correction ships as a silent no-op on EVERY track while the
    # unit suite stays green. Caught only by running the real worker on real
    # audio, which is why this case is pinned here now.
    env = envelope(SLOW_PERIOD, [1.0])
    fit = aw.tempo_octave_fit(ArrayLike(env), ArrayLike(grid(SLOW_PERIOD // 2)))
    assert fit is not None and fit["action"] == "halve", fit
    bpm, _beats, applied = aw.apply_tempo_octave(
        152.0, ArrayLike(grid(SLOW_PERIOD // 2)), fit
    )
    assert applied and abs(bpm - 76.0) < 1e-9, bpm
    # And end to end through the wrapper, where the swallowing happened.
    bpm2, _b2, conf = aw.corrected_tempo(
        None, 22050, None, 152.0, ArrayLike(grid(SLOW_PERIOD // 2)),
        onset_env=ArrayLike(env),
    )
    assert abs(bpm2 - 76.0) < 1e-9, f"correction silently skipped: {bpm2}"
    assert conf is not None and conf > 0.8, conf


def negative_frames_do_not_shift_the_parity():
    # strongOffset is a PARITY over the fit's filtered beat list, so
    # apply_tempo_octave has to filter identically. A stray negative frame
    # dropped by one and not the other flips which half of a doubled grid is
    # "the strong one" — and the failure is invisible: a plausible BPM stamped
    # over the silent half of the grid.
    reported = grid(SLOW_PERIOD // 2)
    env = [BACKGROUND] * FRAMES
    for b in reported[0::2]:
        env[b] = 1.0
    fit = aw.tempo_octave_fit(env, [-5] + reported)
    assert fit["action"] == "halve", fit
    _bpm, beats, applied = aw.apply_tempo_octave(152.0, [-5] + reported, fit)
    assert applied
    assert all(env[b] == 1.0 for b in beats), f"kept the silent half: {beats[:4]}"


def unmeasured_fit_leaves_the_reading_alone():
    bpm, beats, conf = aw.corrected_tempo(None, 22050, None, 152.0, [0, 17, 34], onset_env=[])
    assert bpm == 152.0 and beats == [0, 17, 34] and conf is None, (bpm, conf)


# --- the wrapper's confidence contract -------------------------------------

def applied_correction_reports_its_confidence():
    env = envelope(SLOW_PERIOD, [1.0])
    bpm, _beats, conf = aw.corrected_tempo(
        None, 22050, None, 152.0, grid(SLOW_PERIOD // 2), onset_env=env
    )
    assert abs(bpm - 76.0) < 1e-9, bpm
    assert conf is not None and conf > 0.8, conf


def refused_correction_reports_zero_confidence():
    # We kept a reading the evidence argued against — the composite confidence
    # has to see that, which is the whole point of the field.
    env = envelope(SLOW_PERIOD, [1.0])
    bpm, _beats, conf = aw.corrected_tempo(
        None, 22050, None, 100.0, grid(SLOW_PERIOD // 2), onset_env=env
    )
    assert bpm == 100.0, bpm
    assert conf == 0.0, conf


def confidence_tracks_separation():
    clean = aw.tempo_octave_fit(envelope(SLOW_PERIOD, [1.0]), grid(SLOW_PERIOD // 2))
    murky = aw.tempo_octave_fit(envelope(SLOW_PERIOD, [1.0, 0.30]), grid(SLOW_PERIOD // 2))
    assert clean["action"] == murky["action"] == "halve", (clean, murky)
    assert clean["confidence"] > murky["confidence"], (clean, murky)
    assert 0.0 <= murky["confidence"] <= 1.0, murky


print("tempo octave correction (#1417)")
test("doubled grid halves", doubled_grid_halves)
test("phase offset keeps the strong set", phase_offset_keeps_the_strong_set)
test("correct grid is left alone", correct_grid_is_left_alone)
test("half-speed reading doubles", half_speed_reading_doubles)
test("backbeat is not a doubling", backbeat_is_not_a_doubling)
test("refuses an implausibly slow halving", refuses_an_implausibly_slow_halving)
test("refuses an implausibly fast doubling", refuses_an_implausibly_fast_doubling)
test("too little grid is unmeasured", too_little_grid_is_unmeasured)
test("silent envelope is unmeasured", silent_envelope_is_unmeasured)
test("beats past the envelope are dropped", beats_past_the_envelope_are_dropped)
test("numpy-style inputs are judged, not swallowed", numpy_style_inputs_are_judged_not_swallowed)
test("negative frames do not shift the parity", negative_frames_do_not_shift_the_parity)
test("unmeasured fit leaves the reading alone", unmeasured_fit_leaves_the_reading_alone)
test("applied correction reports its confidence", applied_correction_reports_its_confidence)
test("refused correction reports zero confidence", refused_correction_reports_zero_confidence)
test("confidence tracks separation", confidence_tracks_separation)

if failures:
    print(f"\n{failures} failure(s)")
    sys.exit(1)
print("\nall passed")
