#!/usr/bin/env python3
"""Pure-stdlib regression test for the analyser pace curve (#1434)."""

import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze_worker as aw  # noqa: E402


fake_numpy = types.ModuleType("numpy")
fake_numpy.max = max
fake_numpy.mean = lambda values: sum(values) / len(values)
sys.modules["numpy"] = fake_numpy

class ArrayLike:
    """Enough ndarray shape for the production onset-strength boundary."""

    def __init__(self, values):
        self.values = list(values)

    @property
    def size(self):
        return len(self.values)

    def __iter__(self):
        return iter(self.values)

    def __len__(self):
        return len(self.values)

    def __getitem__(self, key):
        out = self.values[key]
        return ArrayLike(out) if isinstance(key, slice) else out


fake_librosa = types.SimpleNamespace(
    onset=types.SimpleNamespace(
        onset_strength=lambda **_kwargs: ArrayLike([1.0, 3.0, 2.0, 4.0])
    )
)

# Exercise estimate_pace through its real librosa boundary. This failed when a
# shared helper converted the ndarray to a list while the window loop still
# assumed every slice exposed ndarray.size.
curve = aw.estimate_pace(
    [0.0],
    512,
    fake_librosa,
    window_s=1.0,
)

assert curve == [
    {"startMs": 0, "endMs": 1000, "value": 0.25},
    {"startMs": 1000, "endMs": 2000, "value": 0.75},
    {"startMs": 2000, "endMs": 3000, "value": 0.5},
    {"startMs": 3000, "endMs": 4000, "value": 1.0},
], curve

print("analyzer pace: shared list envelope preserves the curve")
