# web/scripts/verify-forms.py
#
# Drives the isolated verify stack (controller :7791, web :7793) through every
# form converted to react-hook-form. Not part of CI — web/ has no test suite and
# the merge gate is lint. This is the evidence for the PR.
#
# Usage: python3 web/scripts/verify-forms.py [form_name ...]
import base64
import json
import subprocess
import sys

from playwright.sync_api import sync_playwright

WEB = "http://localhost:7793"
API = "http://localhost:7791"
AUTH = base64.b64encode(b"test:test").decode()


def api(path):
    """Read state back through the controller, never through a toast."""
    out = subprocess.run(
        ["curl", "-s", "-u", "test:test", f"{API}{path}"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout


def api_write(method, path, body=None, ok_statuses=None):
    """POST/PUT/DELETE through the same curl mechanism as `api()` — for a
    check to seed or tear down its OWN fixtures rather than depending on a
    human to run curl separately outside the script.

    `check=True` on the subprocess only proves curl itself ran — it says
    nothing about the HTTP response. A seed that 4xx/5xx's used to sail
    through silently, dropping the calling check straight into a full-timeout
    hang (waiting on a fixture that was never actually created) with no
    evidence pointing at the real cause. This asks curl for the status code
    (`-w`) alongside the body and raises on anything outside 200-299, naming
    the method, path and status — so a broken seed fails at the seed, not 30s
    later at some unrelated `wait_for_selector`.

    A caller that genuinely expects a non-2xx (a best-effort delete-before-
    seed, where "nothing to delete yet" is a normal 404) passes the codes it
    accepts via `ok_statuses`, e.g. `ok_statuses=(200, 404)`.
    """
    cmd = [
        "curl", "-s", "-u", "test:test", "-X", method,
        "-w", "\n%{http_code}", f"{API}{path}",
    ]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    stdout, _, status = out.stdout.rpartition("\n")
    ok = set(ok_statuses) if ok_statuses is not None else range(200, 300)
    if int(status) not in ok:
        raise RuntimeError(
            f"api_write {method} {path} -> HTTP {status}: {stdout.strip()[:500]}"
        )
    return stdout


def new_page(pw):
    browser = pw.chromium.launch()
    ctx = browser.new_context()
    # Before load: signing in through the form races a delayed /admin/dash push.
    ctx.add_init_script(
        f"localStorage.setItem('subwave_admin_auth', '{AUTH}')"
    )
    return browser, ctx.new_page()


def assert_aria(page, locator):
    """Assertion 2's teeth: an invalid control must point at an id that is
    really in the DOM. A dangling aria-describedby is worse than none.

    Resolved via an attribute selector (`[id="..."]`), never a bare `#id` CSS
    selector: a legal DOM id can contain characters that are CSS-selector
    metacharacters (`festivals.0.name-error` has dots, which start a class
    selector), and `page.locator(f"#{token}")` then silently matches nothing
    even though the element is really there (verified directly:
    `page.set_content('<div id="foo.bar">')` then `page.locator("#foo.bar")`
    is a 0-count match on a page that unambiguously has that id). The a11y
    machinery that actually consumes this id at runtime — getElementById,
    aria-describedby resolution, the accessibility tree — does plain string
    matching, not CSS-selector parsing, so a dotted id is completely valid
    there; only the naive selector was wrong, and `[id="..."]` matches by
    exact attribute value with no such parsing.
    """
    assert locator.get_attribute("aria-invalid") == "true", "aria-invalid not set"
    described = locator.get_attribute("aria-describedby")
    assert described, "aria-describedby missing on an invalid control"
    for token in described.split():
        assert page.locator(f'[id="{token}"]').count() == 1, f"dangling id: {token}"


def assert_survives_poll(page, locator, expected, seconds=35):
    """Proves a form value survives a REAL poll tick — not that a couple of
    real seconds passed uneventfully.

    This exists because a naive version of this assertion cannot fail. A
    dispatched `window.dispatchEvent(new Event('focus'))` plus a short
    `wait_for_timeout` looks like it re-triggers the poll, but two things make
    it a no-op: (1) the poll effects here are bare `setInterval(tick, 30_000)`
    calls with no `focus`/`visibilitychange` listener at all — nothing is
    listening for that event — and (2) even a real listener wouldn't fire
    within a couple of real seconds against a 30s+ interval. A check that
    passes whether or not the poll ever runs proves nothing about the bug it
    exists to catch (a stray `values` prop re-seeding the form on every poll).

    The caller must install a fake clock (`page.clock.install()`) BEFORE
    `page.goto`, so every timer the page schedules — including the poll's
    `setInterval` — is one Playwright controls. This jumps the clock past the
    real interval so the tick's callback genuinely fires while `locator` still
    holds `expected`, then waits on REAL wall-clock time (fast-forwarding the
    virtual clock does not speed up the still-real network fetch inside that
    tick) for the refetch and re-render to land, and only then asserts the
    value is untouched.
    """
    page.clock.fast_forward(seconds * 1000)
    page.wait_for_timeout(1500)
    actual = locator.input_value()
    assert actual == expected, (
        f"poll clobbered operator input: expected {expected!r}, got {actual!r}"
    )


CHECKS = {}


def check(fn):
    CHECKS[fn.__name__] = fn
    return fn


@check
def takeover(page):
    # Installed BEFORE goto so every timer the page schedules on mount —
    # including TakeoverCard's 30s poll setInterval — is one this test
    # controls. Left in default (auto-ticking) mode: only the later
    # fast_forward jumps ahead of real time, everything up to that point
    # behaves exactly like an uninstalled clock would.
    page.clock.install()
    page.goto(f"{WEB}/admin/dash")
    page.wait_for_selector("text=Takeover")

    minutes = page.get_by_label("Takeover minutes")

    # 2. Validate — 5 is under OVERRIDE_MIN_MINUTES (15).
    minutes.fill("5")
    page.wait_for_selector("text=must be an integer between 15 and 720")
    assert_aria(page, minutes)

    # Save must be gated while invalid.
    pin = page.get_by_role("button", name="Pin to air")
    assert pin.is_disabled(), "Save enabled with an out-of-range window"

    # 3. Save — pick a real show, a valid window, confirm it persists.
    minutes.fill("60")
    page.get_by_label("Pin a show").click()
    page.locator("[role=menuitem], [role=option]").first.click()
    pin.click()
    page.wait_for_selector("text=on air")
    assert '"expiresAt"' in api("/schedule"), "override did not persist"

    # 4. Poll safety — the 30s tick must not clobber a half-typed window.
    #    fast_forward past the real interval so the tick genuinely fires
    #    (see assert_survives_poll's docstring for why a dispatched focus
    #    event and a short sleep cannot prove this).
    page.get_by_role("button", name="Cancel takeover").click()
    page.wait_for_selector("text=Pin a show")
    minutes.fill("123")
    assert_survives_poll(page, minutes, "123")


@check
def festivals(page):
    page.goto(f"{WEB}/admin/moods?tab=festivals")
    page.wait_for_selector("text=Festival calendar")

    page.get_by_role("button", name="Add festival").click()
    dialog = page.get_by_role("dialog")
    dialog.wait_for()

    name = dialog.get_by_label("Name")
    save = dialog.get_by_role("button", name="Add festival")

    # 2. Validate — a blank name. The row is appended blank already, but
    #    mode: 'onChange' only reacts to a real change event, so fill a
    #    value first and then clear it to force one.
    name.fill("x")
    name.fill("")
    page.wait_for_selector("text=must be 1-80 chars")

    # `name` is bound through TextField directly against the array path
    # (`festivals.${idx}.name`), so its id is genuinely dotted — prove that,
    # not just that assert_aria happens to pass. This is the harness fix's
    # actual teeth: the OLD bare `#id` selector must fail to resolve this
    # exact id (confirming the id really is dotted and really would have
    # been reported dangling under the old lookup — on this id it doesn't
    # even degrade to a silent 0-count miss, it's a straight CSS parse error,
    # since a digit right after the dot, e.g. `.14.name`, isn't a legal
    # unescaped class-name start either), and the NEW attribute-selector
    # lookup assert_aria now uses must resolve it cleanly.
    described = name.get_attribute("aria-describedby")
    assert described and "." in described, f"expected a dotted id, got {described!r}"
    try:
        old_result = f"{page.locator(f'#{described}').count()} matches"
    except Exception as e:  # noqa: BLE001 — deliberately broad, this IS the old bug
        old_result = f"raised {type(e).__name__}"
    assert old_result != "1 matches", (
        f"expected the old bare #id selector to fail on a dotted id, got {old_result}"
    )
    new_fixed = page.locator(f'[id="{described}"]').count()
    assert new_fixed == 1, f"expected the attribute selector to resolve the dotted id, got {new_fixed}"
    print(f"  (dotted id confirmed: {described!r} — old selector: {old_result}, new selector: 1 match)")

    assert_aria(page, name)
    assert save.is_disabled(), "Save enabled with a blank name"

    # 3. Save — a valid name (month/day/mood default to valid values), confirm
    #    it lands in /settings.
    name.fill("Verify Festival")
    save.click()
    dialog.wait_for(state="detached")
    assert '"Verify Festival"' in api("/settings"), "festival did not persist"


@check
def moods(page):
    # No page.clock.install() — MoodsPanel has no poll (one GET /settings on
    # mount, like FestivalsSection); assert_survives_poll doesn't apply here.
    page.goto(f"{WEB}/admin/moods?tab=vocab")
    page.wait_for_selector("text=Mood vocabulary")

    # Find which mood the early-morning slot currently points at (server
    # seed: 'morning'), so the rename below is guaranteed to orphan a real
    # reference rather than assuming a fixed seed name.
    settings_before = api("/settings")
    early_morning_mood = json.loads(settings_before)["values"]["moodSchedule"]["early-morning"]

    name_inputs = page.get_by_label("Mood id")
    target_idx = None
    for i in range(name_inputs.count()):
        if name_inputs.nth(i).input_value() == early_morning_mood:
            target_idx = i
            break
    assert target_idx is not None, f"could not find a vocab row named {early_morning_mood!r}"
    target = name_inputs.nth(target_idx)

    # 1. Client-side validation still runs first: TextField/SelectField wired
    #    through the arrayControl cast, real dotted ids (`moods.N.name`).
    save = page.get_by_role("button", name="Save vocabulary")
    target.fill("")
    page.wait_for_selector("text=must be 1-40 chars")
    assert_aria(page, target)
    assert save.is_disabled(), "Save enabled with a blank mood id"

    # 2. Rename (not delete) the mood the early-morning slot points at, to
    #    something not already in the vocabulary. Client-side validation
    #    passes (a valid, non-duplicate id) — the refusal below can only come
    #    from the server, proving this is really a round trip.
    renamed = f"{early_morning_mood}-orphantest"
    target.fill(renamed)
    page.wait_for_selector("text=must be 1-40 chars", state="detached")
    assert not save.is_disabled(), "Save stayed disabled on a valid rename"

    save.click()
    # 3. The controller's in-use removal guard (assertNoOrphanMoods) refuses:
    #    the early-morning moodSchedule slot still names the OLD mood id, and
    #    that check runs inside settings.update() over the FULL patch, not
    #    the route's shape-only pre-flight — so it throws a plain Error with
    #    no field path, not a fieldErrors entry. Confirmed by reading
    #    settings/validate.ts (assertNoOrphanMoods) and routes/settings/
    #    core.ts's POST handler (`res.status(400).json({ error: err.message
    #    })`, no fieldErrors passed through on that branch) — MoodsPanel's
    #    persistPatch still WIRES applyServerFieldErrors (real, and load-
    #    bearing for a shape-level failure, asserted in step 1's server-shape
    #    twin below), but this specific rule structurally can't land on one
    #    input, so the proof here is: the refusal surfaces somewhere the
    #    operator will see it (a toast), AND it does NOT falsely mark the
    #    renamed field invalid (no orphan-guard aria-invalid).
    toast = page.locator('[data-sonner-toast]:has-text("still used by")')
    toast.wait_for(timeout=6000)
    assert "early-morning" in toast.inner_text(), toast.inner_text()

    # The save must have been REJECTED, not silently accepted — confirm the
    # controller's stored vocabulary still has the OLD name, not the rename.
    settings_after = api("/settings")
    stored_names = [m["name"] for m in json.loads(settings_after)["values"]["moods"]]
    assert early_morning_mood in stored_names, "orphan-guard refusal did not actually block the save"
    assert renamed not in stored_names, "rename persisted despite the orphan-guard refusal"

    # And the refusal did NOT get attributed to the (perfectly valid) rename
    # input — no aria-invalid was set on it by this failure.
    assert target.get_attribute("aria-invalid") != "true", (
        "orphan-guard refusal incorrectly marked the input aria-invalid — "
        "it has no field to attach to, see the comment above"
    )

    # Revert the rename so the check is repeatable against the same seed.
    target.fill(early_morning_mood)
    page.wait_for_selector("text=must be 1-40 chars", state="detached")


@check
def moods_unsaved_vocab_gap(page):
    """Fix round 1 finding: the Moments dropdowns (and the schema context
    validating them) must be built from the PERSISTED mood vocabulary, not
    the live, possibly-unsaved content of the Vocabulary tab. The two cards
    are not symmetric server-side: saveSchedule/saveWeather never carry
    `moods` in their own patch, so settings.ts always judges them against
    what's actually stored (settings.ts:1205-1219) — an unsaved rename that
    the LIVE list would have allowed through client validation is a save the
    server structurally cannot accept. Drives the exact repro from the
    finding: rename a mood in Vocabulary without saving, switch to Moments,
    and confirm the stale rename is not even offered as a choice there.
    """
    page.goto(f"{WEB}/admin/moods?tab=vocab")
    page.wait_for_selector("text=Mood vocabulary")

    settings_before = json.loads(api("/settings"))
    midday_mood = settings_before["values"]["moodSchedule"]["midday"]

    name_inputs = page.get_by_label("Mood id")
    target_idx = None
    for i in range(name_inputs.count()):
        if name_inputs.nth(i).input_value() == midday_mood:
            target_idx = i
            break
    assert target_idx is not None, f"could not find a vocab row named {midday_mood!r}"
    target = name_inputs.nth(target_idx)

    # Rename without saving — client validation passes (valid, non-duplicate
    # id), and nothing is posted to the server.
    renamed = f"{midday_mood}-liveonly"
    target.fill(renamed)
    page.wait_for_selector("text=must be 1-40 chars", state="detached")

    # Switch tabs via the real tab control — a page.goto here would hard-
    # reload the page and discard the in-memory rename, which would not
    # reproduce the finding (confirmed the hard way in manual testing: an
    # earlier ad hoc script that used page.goto for a tab switch looked like
    # a data-loss bug and was actually just a bad test).
    page.get_by_role("tab", name="Moments").click()
    page.wait_for_selector("text=Time of day")

    midday_select = page.get_by_label("Midday", exact=False)
    midday_select.click()
    options_text = page.locator("[role=option]").all_inner_texts()
    page.keyboard.press("Escape")

    assert renamed not in options_text, (
        f"unsaved vocab rename {renamed!r} was offered as a Moments option — "
        f"the client/server vocabulary gap is open. Options were: {options_text}"
    )
    assert midday_mood in options_text, (
        f"the real persisted mood {midday_mood!r} should still be offered — got {options_text}"
    )

    # Revert the in-progress rename (never saved, so nothing to revert
    # server-side) so the check is repeatable.
    page.get_by_role("tab", name="Vocabulary").click()
    page.wait_for_selector("text=Mood vocabulary")
    page.get_by_label("Mood id").nth(target_idx).fill(midday_mood)
    page.wait_for_selector("text=must be 1-40 chars", state="detached")


SKILLS_FIXTURE_SLUG = "verify-dup-skill"


@check
def skills(page):
    """SkillEditModal (#1358 follow-on): a create whose slug already exists on
    disk is a SERVER-only rule (skillSlugSchema only checks shape) — traced
    routes/dj.ts's POST /dj/skills: it DOES answer with
    `fieldErrors: { name: … }` on both the reserved-slug and already-exists
    branches, unlike Task 4's persona-orphan guard, which threw a fieldless
    Error. So this modal is a genuine round trip: client-side validation
    passes (the slug is well-formed), and the refusal that lands is the
    server's, attributed to the right input via applyServerFieldErrors.

    Seeds and tears down its own fixture — a custom skill named
    "verify-dup-skill" — through api_write(), the same curl mechanism every
    other request in this file already uses. Every other check here is
    repeatable from a pristine state dir (moods_unsaved_vocab_gap explicitly
    reverts its own in-progress edit at the end); this one must be too, or it
    fails unreadably — no collision, so the "already exists" wait just times
    out — against a freshly booted stack that never got a manual curl seed.
    """
    # Best-effort delete first: clears a fixture left behind by a run that
    # crashed before its own teardown, so this run's collision is guaranteed
    # to be the seed made just below, not a stale leftover. 404 ("no such
    # custom skill") is the expected, normal outcome on a clean stack —
    # confirmed against routes/dj.ts's DELETE /dj/skills/:slug — so it's
    # named explicitly rather than opening api_write's check up to every
    # status.
    api_write("DELETE", f"/dj/skills/{SKILLS_FIXTURE_SLUG}", ok_statuses=(200, 404))
    api_write("POST", "/dj/skills", {
        "name": SKILLS_FIXTURE_SLUG,
        "label": "Verify Dup Skill",
        "brief": "Seeded by verify-forms.py's skills() check — collision fixture, torn down at the end of the same run.",
    })

    try:
        page.goto(f"{WEB}/admin/skills")
        page.get_by_role("button", name="New skill").click()

        dialog = page.get_by_role("dialog")
        dialog.wait_for()

        slug = dialog.get_by_label("SLUG")
        brief = dialog.get_by_label("The brief")
        create = dialog.get_by_role("button", name="Create", exact=True)

        slug.fill(SKILLS_FIXTURE_SLUG)   # valid shape, but already exists on disk
        brief.fill("Playwright dup-slug probe — should never actually save.")
        assert not create.is_disabled(), "Create stayed disabled on a well-formed, if colliding, slug"

        create.click()
        page.wait_for_selector('[role="dialog"] :text("already exists")')
        assert_aria(page, slug)

        # The dialog must still be open — a real refusal, not a swallowed error
        # that quietly closed the modal.
        assert dialog.is_visible(), "dialog closed despite the server refusal"

        # And the refusal really did attribute to THIS input, not just render an
        # aria-describedby pointing at unrelated text — the associated node's own
        # text must be the "already exists" message.
        described = slug.get_attribute("aria-describedby")
        error_id = [t for t in described.split() if t.endswith("-error")][0]
        assert "already exists" in page.locator(f'[id="{error_id}"]').inner_text()
    finally:
        # Runs whether the assertions above passed or raised — a failed run
        # must not leave the fixture behind to poison the NEXT run. 200 is
        # the normal case; 404 covers a run that failed before the seed
        # above ever landed.
        api_write("DELETE", f"/dj/skills/{SKILLS_FIXTURE_SLUG}", ok_statuses=(200, 404))


BLOCKRULE_LABEL = "Verify Blocklist Rule"


@check
def blockrules(page):
    """BlockRulesCard (#1300 FR 1, converted onto blockRuleSchema).

    Both halves run the SAME schema — validateBody(blockRuleSchema) at
    POST/PUT /library/blocklist/rules (confirmed by reading routes/library.ts)
    is byte-for-byte what the client's zodResolver runs — so there is no
    client-accepts/server-rejects gap to exercise here the way skills()'s
    duplicate-slug check does; the only refusal reachable from this build is
    the client-side one, gated on the Save button rather than a round trip.
    That refusal is proven here; the round trip is proven separately by
    actually saving and reading the result back.

    `values` (the chip input, and the playlist checkbox list — same field,
    two branches keyed on `field`) has no single labelable element, so its
    Field names itself via aria-labelledby/groupProps (fieldAria's group
    variant), not htmlFor. assert_aria is generic over the locator it's
    given; the point of this check's aria assertions is confirming that
    GROUP locator (found via the "-values-label" suffix on aria-labelledby,
    not a `for` attribute) is a real, single node with real ids behind it —
    not just that assert_aria passes on whatever the caller happened to hand
    it.

    Message assertions read off the invalid control's OWN aria-describedby
    (like skills()'s duplicate-slug check does), never a bare page-wide
    `text=...` match — Fix round 1's Minor 1: the message being unique in
    the app today isn't a property this check should depend on.

    GET /dj/playlists is mocked to return one fixture playlist regardless of
    whether this verify stack has real Navidrome connectivity (it usually
    doesn't) — the playlist branch's checkbox-list container only renders at
    all when `playlists.length > 0` (an empty list falls back to a plain
    "No Navidrome playlists found" hint with no group control to assert
    against), so without a real playlist to select, Fix round 1's dangling-
    aria-describedby bug in that branch would have nothing to catch it on.
    """
    def find_rule_id():
        data = json.loads(api("/library/blocklist"))
        for r in data.get("rules", []):
            if r["label"] == BLOCKRULE_LABEL:
                return r["id"]
        return None

    # Best-effort cleanup from a run that crashed before its own teardown —
    # same posture as skills()'s pre-seed delete.
    leftover = find_rule_id()
    if leftover:
        api_write("DELETE", f"/library/blocklist/rules/{leftover}", ok_statuses=(204, 404))

    def mock_playlists(route):
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"results": [
                {"id": "verify-playlist", "name": "Verify Playlist", "songCount": 3},
            ]}),
        )

    try:
        page.route("**/dj/playlists", mock_playlists)

        page.goto(f"{WEB}/admin/library?tab=blocked")
        page.wait_for_selector("text=Blocking rules")

        page.get_by_role("button", name="Add rule").click()
        dialog = page.get_by_role("dialog")
        dialog.wait_for()

        name = dialog.get_by_label("Name")
        # Scoped to the dialog: the page ALSO has a toolbar "Add rule" button
        # that opens this same dialog, and the footer's save button carries
        # the identical label while no rule is being edited.
        save = dialog.get_by_role("button", name="Add rule", exact=True)
        match_on = dialog.get_by_label("Match on")

        name.fill(BLOCKRULE_LABEL)

        # 1. Validate (tag mode) — a label with no values. The default field
        #    is 'tag' (EMPTY_RULE), whose chip input carries the "e.g.
        #    christmas" placeholder. `values` starts already empty, and
        #    mode: 'onChange' only reacts to a real change event (same
        #    caveat festivals() and moods() note) — so commit a chip and
        #    remove it again to force one, landing back on an empty,
        #    freshly-invalidated list.
        chip_input = dialog.get_by_placeholder("e.g. christmas", exact=True)
        chip_input.fill("temp")
        chip_input.press("Enter")
        dialog.get_by_role("button", name="remove temp").click()
        page.wait_for_selector('[aria-labelledby$="-values-label"][aria-invalid="true"]')
        assert save.is_disabled(), "Add rule enabled with an empty values list"

        values_group = dialog.locator('[aria-labelledby$="-values-label"]')
        assert values_group.count() == 1, f"expected exactly one values group, found {values_group.count()}"
        assert_aria(page, values_group)
        described = values_group.get_attribute("aria-describedby")
        error_id = [t for t in described.split() if t.endswith("-error")][0]
        assert "must have at least one entry" in page.locator(f'[id="{error_id}"]').inner_text()

        # 1b. Validate (playlist mode) — Fix round 1's finding: switching
        #     Match-on resets `values` to [] (see the field Controller's
        #     onValueChange, below), which makes an unticked playlist list
        #     the DEFAULT state on every switch into Playlist mode, not a
        #     rare edge case — and this branch previously spread
        #     aria-describedby with no FieldError behind it. No earlier
        #     check ever switched into Playlist mode to notice.
        match_on.click()
        page.get_by_role("option", name="Playlist").click()
        page.wait_for_selector('[aria-labelledby$="-values-label"][aria-invalid="true"]')
        assert save.is_disabled(), "Add rule enabled with no playlists selected"

        playlist_group = dialog.locator('[aria-labelledby$="-values-label"]')
        assert playlist_group.count() == 1, f"expected exactly one values group, found {playlist_group.count()}"
        assert_aria(page, playlist_group)
        described = playlist_group.get_attribute("aria-describedby")
        error_id = [t for t in described.split() if t.endswith("-error")][0]
        assert "must have at least one entry" in page.locator(f'[id="{error_id}"]').inner_text()

        # Tick the mocked playlist — the group must actually leave its
        # invalid state once `values` is non-empty again, not just report
        # invalid forever regardless of content.
        playlist_group.get_by_text("Verify Playlist").click()
        page.wait_for_selector('[aria-labelledby$="-values-label"][aria-invalid="true"]', state="detached")
        assert not save.is_disabled(), "Add rule stayed disabled with a playlist selected"

        # Switch back to `tag` before the real save below — this check's
        # persisted rule stays field='tag', same as before this fix round.
        # The switch resets `values` to [] again, which is exactly the
        # empty starting point step 2 below already expects.
        match_on.click()
        page.get_by_role("option", name="Any tag").click()
        page.wait_for_selector('[aria-labelledby$="-values-label"][aria-invalid="true"]')

        # 2. Save — a valid value clears the refusal, and the round trip
        #    really persists (not just a client-side state flip): confirmed
        #    against GET /library/blocklist afterward.
        chip_input.fill("verify-tag")
        chip_input.press("Enter")
        page.wait_for_selector('[aria-labelledby$="-values-label"][aria-invalid="true"]', state="detached")
        assert not save.is_disabled(), "Add rule stayed disabled on a valid rule"

        save.click()
        dialog.wait_for(state="detached")
        assert BLOCKRULE_LABEL in api("/library/blocklist"), "rule did not persist"
    finally:
        # Runs whether the assertions above passed or raised — a failed run
        # must not leave the fixture behind to poison the NEXT run.
        rid = find_rule_id()
        if rid:
            api_write("DELETE", f"/library/blocklist/rules/{rid}", ok_statuses=(204, 404))


SFX_FIXTURE_NAME = "verify-sfx-effect"


def _write_silent_wav(path, seconds=0.3, rate=8000):
    """A minimal, real (not just well-formed-header) mono WAV — importAudio
    transcodes it through ffmpeg when available, so the bytes have to survive
    an actual decode, not merely pass a header sniff."""
    import wave
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))


@check
def imaging(page):
    """SfxSection's create + import modals (Task 7, imaging/{Sfx,Beds,Jingles,
    Voices}Section).

    POST /sfx runs validateBody(sfxCreateSchema) (controller routes/sfx.ts) —
    the SAME schema the create modal's zodResolver runs (imported from
    lib/schemas.generated.ts) — so the duration-over-SFX_MAX_SEC refusal
    proven below is a genuine mirror of the server rule, not a UI-only
    constraint invented for this check.

    The real routes are `/sfx` (create) and `/sfx/upload` (import), never
    `/imaging/...` — confirmed by grepping ImagingPanel.tsx's adminFetch
    calls; `/imaging` is only the admin PAGE path (`/admin/imaging?tab=sfx`),
    never an API prefix.

    The persistence round trip is proven through the IMPORT modal, not a real
    generation — this verify stack's ElevenLabs key reports `generatorReady:
    true` but has 0 credits remaining (confirmed by actually attempting a
    create: POST /sfx answered 500 `quota_exceeded`), so a real create() call
    cannot succeed here and would be a flaky, costed round trip even on a
    stack that does have credit. Import needs no external API — a real WAV
    upload through /sfx/upload — and shares the same imagingImportSchema
    name/description fields.
    """
    def find_effect():
        data = json.loads(api("/sfx"))
        for s in data.get("sfx", []):
            if s["name"] == SFX_FIXTURE_NAME:
                return s
        return None

    # Best-effort cleanup from a run that crashed before its own teardown.
    if find_effect():
        api_write("DELETE", f"/sfx/{SFX_FIXTURE_NAME}", ok_statuses=(200, 400, 404))

    try:
        page.goto(f"{WEB}/admin/imaging?tab=sfx")
        page.wait_for_selector("text=Sound effects")

        # 1. Create modal — duration above SFX_MAX_SEC (10s) refuses on the
        #    duration field itself.
        page.get_by_role("button", name="+ Create").click()
        create_dialog = page.get_by_role("dialog")
        create_dialog.wait_for()

        name = create_dialog.get_by_label("Name")
        prompt = create_dialog.get_by_label("Generation prompt")
        duration = create_dialog.get_by_label("Duration · s")
        create_save = create_dialog.get_by_role("button", name="Create", exact=True)

        name.fill(SFX_FIXTURE_NAME)
        prompt.fill("Playwright duration-over-max probe — should never actually generate.")

        # Scoped to the duration field's own aria-describedby (not a bare
        # page-wide text= match — see blockrules()/skills()), proving the
        # message is really attributed to THIS input.
        duration.fill("999")
        page.wait_for_selector('[id$="-durationSec-error"]:text("is capped at 10s")')
        assert_aria(page, duration)
        assert create_save.is_disabled(), "Create enabled with an out-of-range duration"

        # A valid duration clears the refusal. FieldError (components/ui/
        # field.tsx) keeps its own (now-empty) id in the DOM even once valid
        # — only the input's aria-describedby stops naming it — so "the
        # message went away" is proven by the rendered TEXT detaching, same
        # pattern moods()/blockrules() use for their state="detached" waits,
        # plus the aria-invalid attribute assert_aria itself targets.
        duration.fill("1")
        page.wait_for_selector('text=is capped at 10s', state="detached")
        assert duration.get_attribute("aria-invalid") is None, "duration still marked invalid"
        assert not create_save.is_disabled(), "Create stayed disabled on a valid duration"

        # Close without submitting — see the docstring for why a real create()
        # is not exercised on this stack.
        page.get_by_role("button", name="Cancel").click()
        create_dialog.wait_for(state="detached")

        # 2. Import modal — a real file upload persists, proving the round
        #    trip end to end (not just a client-side state flip): confirmed
        #    against GET /sfx afterward, same as blockrules()/festivals()'s
        #    save step.
        wav_path = "/tmp/verify-sfx-fixture.wav"
        _write_silent_wav(wav_path)

        page.get_by_role("button", name="Import", exact=True).click()
        import_dialog = page.get_by_role("dialog")
        import_dialog.wait_for()

        import_dialog.get_by_label("Name").fill(SFX_FIXTURE_NAME)
        import_dialog.locator('input[aria-label="Import SFX audio file"]').set_input_files(wav_path)
        import_save = import_dialog.get_by_role("button", name="Import", exact=True)
        assert not import_save.is_disabled(), "Import stayed disabled with a name and a file chosen"

        import_save.click()
        import_dialog.wait_for(state="detached")
        assert find_effect(), "sound effect did not persist"
    finally:
        # Runs whether the assertions above passed or raised — a failed run
        # must not leave the fixture behind to poison the NEXT run.
        if find_effect():
            api_write("DELETE", f"/sfx/{SFX_FIXTURE_NAME}", ok_statuses=(200, 400, 404))


if __name__ == "__main__":
    names = sys.argv[1:] or list(CHECKS)
    with sync_playwright() as pw:
        for name in names:
            browser, page = new_page(pw)
            try:
                CHECKS[name](page)
                print(f"PASS {name}")
            finally:
                browser.close()
