# Eval harness

Every claim about whether a change made the designs better used to rest on a
handful of runs someone watched. Four runs on one brief is an anecdote, and six
changes shipped together cannot be told apart by looking at the result.

This turns a change into a number.

```bash
bun eval/run.ts --model gpt-5.6-luna --repeats 3 --docs --out eval/runs/before.json
# change something
bun eval/run.ts --model gpt-5.6-luna --repeats 3 --docs --out eval/runs/after.json
bun eval/report.ts eval/runs/after.json --against eval/runs/before.json
```

## What it records

Per run: blockers and warnings by rule, tool calls by name, tool errors, turns,
wall time, and the craft metrics in `metrics.ts`.

The audit answers "is anything broken". The craft metrics answer "is this a
system or a pile" — distinct spacing values, type range, accent fills per
screen, token coverage, component reuse, tree depth. A design can clear every
audit rule and still be flat, and only the second set shows it.

`--docs` writes each finished document beside the JSON. A row saying "8 clipped"
is a fact without a cause; the document is what makes it one.

## Reading the report

Medians with a min and a max, never a mean. Run-to-run variance is a defect in
its own right: a brief that yields one screen on one run and four on the next
has a problem the average hides.

A metric marked `better` or `worse` has a direction that is not in doubt. Screen
count, node count and tree depth carry no verdict — fewer screens is not
automatically worse.

## What the first batch found

It crashed on run 11 and took the ten runs before it with it. Fixing that
surfaced the rest:

- `runSession` yielded `done` after yielding `error`, so a run that never
  reached the provider reported as finished with an untouched document.
- The completion gate accepted an empty canvas. A document with nothing in it
  satisfies every audit rule, so ten dead runs scored as perfect.
- `childrenOf` threw on a child that was not an object, taking the whole audit
  down with it.
- The scaffold's own tab items measured 39px against a 44px minimum, and its
  padding sat off the 4px grid the auditor holds everything else to.
- `$foreground-muted` does not reach 4.5:1 on small text in any palette, and
  the style guidelines were recommending it for captions and timestamps.
- The audit and `measure` did not resolve component instances, though the canvas
  and the renderer both did. A screen built from components measured as a screen
  full of 0x0 boxes.

None of these were visible in a run someone watched finish.
