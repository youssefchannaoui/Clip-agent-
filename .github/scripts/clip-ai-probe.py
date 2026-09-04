#!/usr/bin/env python3
"""Ask the RUNNING worker's own clip AI what each named shape actually writes.

Every entry in `CLIP_STYLES` is a sentence handed to qwen3:1.7b, and the one
thing no test in this repo can tell you is what a 1.7B model DOES with it.
The shapes shipped in v3.122.0 proven only by unit test, with "press a chip on
a live clip and tell me what it writes" left on Youssef -- which was the wrong
place for it, because this can be asked from a workflow instead. It is
re-runnable, so the same question can be re-asked after any prompt change.

WHERE THIS RUNS. Inside the worker container on the Hetzner box, launched by
deploy-worker.yml immediately after the step that proves which version the
container holds -- so an answer below is known to come from that version's
prompt, rather than from whatever happened to be deployed.

WHAT NEVER LEAVES THE BOX. `WORKER_SHARED_SECRET` is read from the container's
own environment and used to sign the request here; the request itself goes to
127.0.0.1. Only the model's answer travels back into the run log. `PARAMS` is
substituted on the RUNNER as a JSON literal rather than interpolated into a
shell command, so a dispatch input can never become a command on the box.

A DULL TITLE IS NOT A FAILED RUN. Taste is the finding, not a fault, so a
weak answer exits zero and is simply printed. Two things DO fail the run:
the box refusing the call at all, and a shape overriding the recitation
reference -- that one is a rule, not an opinion.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request

# Replaced on the runner with the dispatch inputs, as a JSON object literal.
PARAMS = {}

SECRET = os.environ.get("WORKER_SHARED_SECRET", "")
ENDPOINT = "http://127.0.0.1:" + (os.environ.get("PORT") or "8080") + "/ai/title"

# Exactly the ids the studio's chips can send (index.html, paintClipTools):
# a title takes four shapes, a description three, and "" is the unshaped
# baseline -- without it a shape that changes nothing looks like a shape that
# works.
TITLE_SHAPES = ["", "promise", "question", "subject", "shorter"]
DESCRIPTION_SHAPES = ["", "shorter", "promise", "hashtags"]

LABELS = {
    "": "(no shape)",
    "promise": "Promise / Warmer",
    "question": "Question",
    "subject": "Subject: payoff",
    "shorter": "Shorter",
    "hashtags": "+ Hashtags",
}

# A recitation the matcher has already resolved, in the shape the app stores
# on a clip. The reference is a FACT derived from these rows, so it must come
# back unchanged whatever shape is asked for.
RECITATION_ROWS = [
    {"surah": 39, "ayah": 71, "surahName": "Az-Zumar",
     "translation": "And those who disbelieved will be driven to Hell in groups"},
    {"surah": 39, "ayah": 72, "surahName": "Az-Zumar", "translation": ""},
    {"surah": 39, "ayah": 73, "surahName": "Az-Zumar", "translation": ""},
]


def ask(body: dict) -> dict:
    """One signed request to the worker beside us, as the app makes it."""
    raw = json.dumps(body).encode("utf-8")
    stamp = str(int(time.time() * 1000))
    message = ("%s\nPOST\n/ai/title\n%s" % (stamp, raw.decode("utf-8"))).encode("utf-8")
    request = urllib.request.Request(ENDPOINT, data=raw, method="POST", headers={
        "content-type": "application/json",
        "x-deenclipped-timestamp": stamp,
        "x-deenclipped-signature": hmac.new(SECRET.encode(), message, hashlib.sha256).hexdigest(),
    })
    with urllib.request.urlopen(request, timeout=240) as response:
        return json.loads(response.read() or b"{}")


def answer_for(style, extra=None):
    """(answer, source) for one shape, or ("", reason) when the box refused."""
    body = {
        "kind": PARAMS.get("kind") or "title",
        "text": PARAMS.get("text") or "",
        "title": PARAMS.get("title") or "",
        "lectureTitle": PARAMS.get("lectureTitle") or "",
    }
    if style:
        body["style"] = style
    body.update(extra or {})
    started = time.time()
    try:
        result = ask(body)
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = json.loads(exc.read() or b"{}").get("error", "")
        except (ValueError, OSError):
            pass
        return "", "HTTP %s %s" % (exc.code, detail)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return "", str(exc)
    took = time.time() - started
    return str(result.get("title") or ""), "%s, %.1fs" % (result.get("source") or "model", took)


def main() -> int:
    if not SECRET:
        print("::error::WORKER_SHARED_SECRET is not in the container's environment.")
        return 1
    if not (PARAMS.get("text") or PARAMS.get("title")):
        print("::error::The probe was given no transcript and no current title.")
        return 1

    kind = PARAMS.get("kind") or "title"
    shapes = DESCRIPTION_SHAPES if kind == "description" else TITLE_SHAPES

    print("Asking the running worker for a %s, once per shape." % kind)
    print("Transcript: %s" % (PARAMS.get("text") or "")[:160])
    if PARAMS.get("lectureTitle"):
        print("Lecture title: %s" % PARAMS["lectureTitle"])
    print("")

    refused = 0
    for style in shapes:
        answer, note = answer_for(style)
        if answer:
            print("%-18s %s" % (LABELS.get(style, style), answer))
            print("%-18s   [%s]" % ("", note))
        else:
            refused += 1
            print("%-18s REFUSED: %s" % (LABELS.get(style, style), note))
        print("")

    # THE RULE, not a matter of taste: a shape chip on a recitation must still
    # return the verse reference. The override reads "not instruction" and
    # deliberately NOT "not style", so this is the assertion that keeps it
    # that way against the real service rather than against a fixture.
    print("--- the recitation rule ---")
    plain, _ = answer_for("", {"ayahs": RECITATION_ROWS})
    shaped, note = answer_for("question", {"ayahs": RECITATION_ROWS})
    print("no shape        %s" % (plain or "(nothing)"))
    print("Question chip   %s   [%s]" % (shaped or "(nothing)", note))
    if not plain.startswith("Surah Az-Zumar 71-73"):
        print("::error::The recitation reference is not being derived: got %r" % plain)
        return 1
    if shaped != plain:
        print("::error::A shape overrode the recitation reference. It must not: %r" % shaped)
        return 1
    print("Held: the shape did not override the reference.")

    if refused == len(shapes):
        print("::error::The box refused every call -- this proves nothing about the shapes.")
        return 1
    if refused:
        print("::warning::%d of %d shapes were refused." % (refused, len(shapes)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
