# web/scripts/verify-forms.py
#
# Drives the isolated verify stack (controller :7791, web :7793) through every
# form converted to react-hook-form. Not part of CI — web/ has no test suite and
# the merge gate is lint. This is the evidence for the PR.
#
# Usage: python3 web/scripts/verify-forms.py [form_name ...]
import base64
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
    really in the DOM. A dangling aria-describedby is worse than none."""
    assert locator.get_attribute("aria-invalid") == "true", "aria-invalid not set"
    described = locator.get_attribute("aria-describedby")
    assert described, "aria-describedby missing on an invalid control"
    for token in described.split():
        assert page.locator(f"#{token}").count() == 1, f"dangling id: {token}"


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
