# Delegation benchmark

Fixed tasks and a fixed evaluation contract for comparing sequential execution with Maestro delegation. The scaffold validates tasks, validates supplied runs, and emits JSON; it does not execute tasks, and it never reports a winner without one sequential and one Maestro run for every task.

## Run

```sh
pnpm exec tsx scripts/benchmark-delegation.ts
pnpm exec tsx scripts/benchmark-delegation.ts --results path/to/results.json
```

Without `--results`, the report lists the tasks, zero runs, `verdict: null`, and a note explaining that no comparison exists. With complete results, `verdict` compares pass rate first and wall time second. Missing cost stays `null` instead of becoming zero.

## Results contract

```json
{
  "version": 1,
  "runs": [
    {
      "taskId": "rename-config-key",
      "mode": "sequential",
      "wallTimeMs": 183000,
      "inputTokens": 24000,
      "outputTokens": 3100,
      "costUsd": 0.42,
      "passed": true
    }
  ]
}
```

Each task and mode may appear once. A run's `passed` is the runner's application of the task's fixed evaluation to the produced workspace or answer; the scaffold does not re-run that evaluation and does not infer a pass.

## Tasks

`tasks.json` is the fixed set. Add a task only with a deterministic evaluation (`file-exists`, `file-contains`, or `answer-contains`) and do not tune prompts between modes.
