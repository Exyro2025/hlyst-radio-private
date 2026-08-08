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


CHECKS = {}


def check(fn):
    CHECKS[fn.__name__] = fn
    return fn


@check
def takeover(page):
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
    #    Assert the value survives a refetch rather than sleeping 30s for it.
    page.get_by_role("button", name="Cancel takeover").click()
    page.wait_for_selector("text=Pin a show")
    minutes.fill("123")
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    page.wait_for_timeout(1500)
    assert minutes.input_value() == "123", "poll clobbered operator input"


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
