"""Readable pass/fail summary of a Playwright JSON report:  npx playwright test --reporter=json | python3 summarize.py"""
import json, re, sys
d = json.load(sys.stdin); ok = bad = skipped = 0; failures = []
def walk(s):
    global ok, bad, skipped
    for sp in s.get("specs", []):
        for t in sp["tests"]:
            r = t["results"][-1] if t["results"] else {"status": "skipped"}
            if r["status"] == "passed": ok += 1
            elif r["status"] == "skipped": skipped += 1
            else:
                bad += 1
                err = [re.sub(r"\x1b\[[0-9;]*m", "", l).strip() for l in (r.get("error", {}).get("message") or "").splitlines() if l.strip()]
                failures.append((sp["file"], sp["title"], " | ".join(err[:7])[:520]))
    for c in s.get("suites", []): walk(c)
for s in d["suites"]: walk(s)
for f, t, e in failures: print(f"FAIL [{f}] {t[:90]}\n      {e}\n")
print(f"{ok} passed, {bad} failed, {skipped} skipped")
