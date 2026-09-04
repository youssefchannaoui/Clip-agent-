"""The star must write a DIFFERENT title, and say so when it cannot.

MEASURED ON THE BOX, 4 Sept 2026, through `.github/scripts/clip-ai-probe.py`
against the running v3.122.0 worker. Given a clip transcript and the current
title "The door that never closes", qwen3:1.7b answered:

    (no shape)         The door that never closes
    Promise / Warmer   The door that never closes
    Question           The door that never closes
    Subject: payoff    The door that never closes: The promise of turning around
    Shorter            The door that never closes

Four of five shapes handed the current title back word for word -- a Question
chip returning something that is not a question, a Shorter chip returning the
same length. The shapes shipped in v3.122.0 proven by unit test, and the unit
tests could not see this because they assert the PROMPT, and the prompt was
fine. Only the real model showed it.

Two changes, and both are needed. The rule is restated in the BEFORE-YOU-ANSWER
line -- this file's own record says that is the only place a rule reliably
lands on this model -- AND enforced in code, because a 1.7B model does not
reliably obey a negative instruction, which is the oldest lesson here about
this model.
"""
import importlib.util
import io
import json
import os
import pathlib
import sys
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))


class FakeOllama:
    """Answers /api/generate with a scripted queue, keeping every prompt sent."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.prompts = []

    def __call__(self, request, timeout=None):
        body = json.loads(request.data.decode("utf-8"))
        self.prompts.append(body["prompt"])
        reply = self.answers.pop(0) if self.answers else ""
        payload = json.dumps({"response": reply}).encode("utf-8")

        class Response(io.BytesIO):
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *exc):
                return False

        return Response(payload)


class RetitleEchoTests(unittest.TestCase):
    CURRENT = "The door that never closes"
    TEXT = "The door does not close because you walked through it yesterday."

    def setUp(self):
        import service
        self.service = service
        self.env = mock.patch.dict(os.environ, {"OLLAMA_URL": "http://127.0.0.1:11434"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def ask(self, *answers, **payload):
        fake = FakeOllama(*answers)
        body = {"kind": "title", "text": self.TEXT, "title": self.CURRENT}
        body.update(payload)
        with mock.patch.object(self.service.urllib.request, "urlopen", fake):
            return self.service.retitle_clip(body), fake

    def test_an_echo_of_the_current_title_is_asked_again(self):
        out, fake = self.ask(self.CURRENT, "Why your mistakes have not closed the door")
        self.assertEqual(out["title"], "Why your mistakes have not closed the door")
        self.assertEqual(out["source"], "ai")
        self.assertEqual(len(fake.prompts), 2, "it should have asked a second time")
        # The retry NAMES the reason, so the model is told what was wrong
        # rather than merely asked again.
        self.assertIn("REJECTED", fake.prompts[1])
        self.assertIn("the current title, word for word", fake.prompts[1])

    def test_a_second_echo_is_reported_as_unchanged_rather_than_as_new(self):
        # A button that quietly returns what was already on screen is a control
        # that looks broken. The host says "DeenAI kept your title" off this.
        out, fake = self.ask(self.CURRENT, self.CURRENT)
        self.assertEqual(out["title"], self.CURRENT)
        self.assertEqual(out["source"], "unchanged")
        self.assertEqual(len(fake.prompts), 2)

    def test_the_same_title_means_what_it_means_to_the_dedupe_pass(self):
        """Case and trailing punctuation are not a different title.

        `normalise_title` is clip_worker's own, so the retitle button and the
        dedupe cannot disagree about what "the same" is -- two definitions of
        one thing is how every drift in this repo started.
        """
        out, fake = self.ask("The Door That Never Closes...", "Mercy has no closing time")
        self.assertEqual(out["title"], "Mercy has no closing time")
        self.assertEqual(len(fake.prompts), 2)

    def test_a_genuinely_new_title_is_never_re_asked(self):
        # The retry costs a whole generation on a single-slot box, so it must
        # fire only on an actual echo.
        out, fake = self.ask("Mercy has no closing time")
        self.assertEqual(out["source"], "ai")
        self.assertEqual(len(fake.prompts), 1)

    def test_a_clip_with_no_current_title_is_never_re_asked(self):
        out, fake = self.ask(self.CURRENT, title="")
        self.assertEqual(out["title"], self.CURRENT)
        self.assertEqual(out["source"], "ai")
        self.assertEqual(len(fake.prompts), 1)

    def test_a_failed_retry_still_reports_unchanged(self):
        """The first answer stands rather than failing the request -- but it IS
        the current title, and `source` reaches the customer's screen, so it
        must not claim otherwise."""
        fake = FakeOllama(self.CURRENT)

        def explode(request, timeout=None):
            if fake.answers:
                return fake(request, timeout=timeout)
            fake.prompts.append("(the retry)")
            raise self.service.urllib.error.URLError("the box went away")

        with mock.patch.object(self.service.urllib.request, "urlopen", explode):
            out = self.service.retitle_clip(
                {"kind": "title", "text": self.TEXT, "title": self.CURRENT})
        self.assertEqual(out["source"], "unchanged")
        self.assertEqual(out["title"], self.CURRENT)


class RetitlePromptTests(unittest.TestCase):
    """The bytes that actually go to Ollama, not the source that builds them."""

    def setUp(self):
        import service
        self.service = service
        self.env = mock.patch.dict(os.environ, {"OLLAMA_URL": "http://127.0.0.1:11434"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def prompt_for(self, **payload):
        fake = FakeOllama("Mercy has no closing time")
        body = {"kind": "title", "text": "A clip about repentance."}
        body.update(payload)
        with mock.patch.object(self.service.urllib.request, "urlopen", fake):
            self.service.retitle_clip(body)
        return fake.prompts[0]

    def restatement(self, prompt):
        return prompt.split("BEFORE YOU ANSWER:")[-1].split("BEGIN UNTRUSTED")[0]

    def test_the_shape_is_repeated_in_the_restatement(self):
        # Naming it once, higher up, was not enough -- the box returned the
        # same line for four different shapes. The restatement sits last
        # before the data, which is where this model reads a rule.
        said = self.restatement(self.prompt_for(style="question"))
        self.assertIn("in the shape asked for above", said)

    def test_an_unshaped_ask_carries_no_shape_clause(self):
        said = self.restatement(self.prompt_for())
        self.assertNotIn("in the shape asked for above", said)

    def test_the_never_repeat_it_rule_rides_the_restatement_too(self):
        said = self.restatement(self.prompt_for(title="The door that never closes"))
        self.assertIn("never repeat it back", said)

    def test_a_clip_with_no_current_title_is_told_nothing_about_repeating(self):
        # There is nothing to repeat, and a rule about an absent thing is
        # tokens spent teaching this model to think about one.
        said = self.restatement(self.prompt_for())
        self.assertNotIn("never repeat it back", said)


if __name__ == "__main__":
    unittest.main()


class RetitleUnusableAnswerTests(unittest.TestCase):
    """The other three things the box actually did, 4 Sept 2026, run 49.

    Asked with NO current title, qwen3:1.7b returned:

        (no shape)         The door does not close because you walked through
                           it yesterday. He is not waiting for you to run out
        Promise / Warmer   The door does not close because you walked through
                           it yesterday. He is waiting for you to turn around.
        Question           What turns shame into grace
        Subject: payoff    The shape asked for: Sheikh Salman : He is not
                           waiting for you to run out of chances, He is
        Shorter            The door does not close because you walked through
                           it yesterday.

    Three of five are the clip's own opening sentence -- `looks_copied` has
    guarded the automatic titler against exactly that since 31 Aug and was
    never applied here. One is this prompt's own heading with an INVENTED
    SCHOLAR behind it, on a lecture that named nobody. And two are cut
    mid-word by the length limit.
    """

    TEXT = ("The door does not close because you walked through it yesterday. "
            "He is not waiting for you to run out of chances, He is waiting "
            "for you to turn around.")

    def setUp(self):
        import service
        self.service = service
        self.env = mock.patch.dict(os.environ, {"OLLAMA_URL": "http://127.0.0.1:11434"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def ask(self, *answers, **payload):
        fake = FakeOllama(*answers)
        body = {"kind": "title", "text": self.TEXT}
        body.update(payload)
        with mock.patch.object(self.service.urllib.request, "urlopen", fake):
            return self.service.retitle_clip(body), fake

    def test_a_sentence_copied_out_of_the_clip_is_refused(self):
        copied = "The door does not close because you walked through it yesterday."
        out, fake = self.ask(copied, "Mercy has no closing time")
        self.assertEqual(out["title"], "Mercy has no closing time")
        self.assertEqual(len(fake.prompts), 2)
        self.assertIn("copied straight out of the clip", fake.prompts[1])

    def test_this_prompt_s_own_wording_coming_back_is_refused(self):
        """The one that carried an invented scholar.

        This does NOT claim to catch an invented name in general -- there is no
        reliable way to spot one mid-sentence, and `strip_unbacked_attribution`
        only removes a trailing "- Name". What it catches is the shape that
        actually produced one on the box.
        """
        leaked = "The shape asked for: Sheikh Salman : He is not waiting for you"
        out, fake = self.ask(leaked, "Mercy has no closing time")
        self.assertNotIn("Sheikh Salman", out["title"])
        self.assertEqual(out["title"], "Mercy has no closing time")
        self.assertIn("this prompt's own wording", fake.prompts[1])

    def test_with_nothing_to_keep_it_falls_back_to_the_transcript_titler(self):
        copied = "The door does not close because you walked through it yesterday."
        out, _ = self.ask(copied, copied)
        self.assertEqual(out["source"], "fallback")
        # The sanctioned fallback, not the raw echo: it is the same titler the
        # render uses when no AI title survives.
        self.assertTrue(out["title"])
        self.assertNotEqual(out["title"], copied)

    def test_a_long_answer_is_cut_on_a_word_boundary(self):
        """The box returned "...He is waiting for you to turn arou".

        THE FIXTURE MATTERS AND THE FIRST ONE DID NOT TEST THIS. It was
        "Mercy " * 40, and 120 divides evenly by "Mercy " -- so the naive cut
        landed exactly on a word boundary anyway and the probe came back GREEN
        against `answer[:limit]`. The words here are deliberately uneven, so
        character 120 falls INSIDE "finally"; asserted below rather than
        assumed.
        """
        # None of these words are in the transcript above, deliberately:
        # the copy guard fires first, and the second fixture tripped it.
        long_answer = ("Mercy stays open longer than shame can hold you and every "
                       "honest return is welcomed again today when a tired heart "
                       "finally decides to knock")
        self.assertNotEqual(long_answer[119], " ")
        self.assertNotEqual(long_answer[120], " ")
        out, _ = self.ask(long_answer)
        self.assertLessEqual(len(out["title"]), 120)
        self.assertTrue(out["title"].endswith("heart"), out["title"])

    def test_a_good_short_title_is_left_exactly_as_it_came(self):
        # "What turns shame into grace" was the one genuinely good answer of
        # the five, and nothing here may touch it.
        out, fake = self.ask("What turns shame into grace")
        self.assertEqual(out["title"], "What turns shame into grace")
        self.assertEqual(out["source"], "ai")
        self.assertEqual(len(fake.prompts), 1)
