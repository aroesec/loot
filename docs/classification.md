# Classification and the review queue

Some transactions cannot be classified from their description. `Zelle payment
to JORDAN 10000000006` is a name and a reference number. Rather than guess, those
are filed somewhere real and queued at `/review/queue`, alongside anything the
model placed without confidence.

The queue is keyboard-driven: `1` to `9` to choose, `/` to search, `j` and `k`
to move, `s` to skip. A dropdown per row is fine for three transactions and
gets abandoned at thirty, and an abandoned queue is a permanent skew in every
total. Offers are ranked by what that merchant has been filed as before, so the
answer is usually key 1.

Answering also writes a rule and re-files matching history, which can be turned
off per answer for a one-off.

## The three passes

1. **Rules.** Deterministic merchant matching, sorted by priority then pattern
   length, so "uber eats" beats "uber". Seeded rules ship at priority 100 and
   learned ones at 200.
2. **Model.** Batches of 40, structured output, taxonomy cached in the system
   prompt. Skipped entirely when no API key is set.
3. **Floor.** Anything still unresolved becomes Uncategorized rather than a
   guess.

## Corrections teach

Answering in the review queue writes a merchant rule and re-applies it to
non-manual history. That is most of the value, and also the risk, so it can be
switched off per answer. A one-off payment should not refile every future
payment on the same rail.

Manual answers are never overwritten. Every automated pass filters on
`classification_source <> 'manual'`.
