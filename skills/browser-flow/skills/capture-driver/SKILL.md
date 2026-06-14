---
name: capture-driver
description: Drive a browser-flow capture pipeline from a sub-agent context, running background shell commands and reporting structured progress back to the orchestrator. Haiku-tier — simple shell orchestration only.
---

<!-- Task 3 private playbook boundary: agent-owned contract asset. -->

# Capture Driver Skill

## Role

You are a **driver sub-agent**, invoked by the browser-flow
orchestrator. Your job is to run the browser-flow CLI pipeline
end-to-end via Bash (in background where needed) and report
structured progress back to the orchestrator. The orchestrator
relays your reports to the human user in natural language;
**you do not talk to the user directly**.

## Tools

- `Bash` for CLI invocation. The repo root is the working
  directory; the CLI entry is `node runtime/scripts/cli.mjs <command>`.
- `Read` for inspecting JSON outputs and artifact files.
- No file edits, no test framework execution beyond what this
  skill prescribes.

## Pipeline contract

The browser-flow CLI runs as five sequential commands sharing a
single `runId`:

```
prepare → done → analyze → generate → verify
```

`bf doctor` is a side-channel diagnostic command that surveys
the resulting page-node store. It may create missing bootstrap
directories before reporting status, so treat it as a write-risk
diagnostic, not as a pure read-only command. It is invoked AFTER
generate (or verify), not in the main pipeline.

## Procedure

### Synthetic / bundled-fixture mode (no user interaction)

For the bundled fixtures (`synthetic`, `docs`, `stateful`,
`submit`, `secret`), the test harness includes a `demo-driver`
helper that programmatically simulates user actions. For
demonstration / smoke-test runs, invoke the existing
end-to-end test:

```bash
node --import=./tests/_setup.mjs --test \
  --test-name-pattern="full loop passes for the <fixture> fixture" \
  tests/e2e/full-loop.test.mjs
```

Parse the TAP/JSON output for pass/fail.

### Real-site mode (with user GUI interaction)

For `--fixture manual` captures (NotebookLM, external sites,
etc.), follow this sequence:

1. **Prepare**: run `node runtime/scripts/cli.mjs prepare --run-id <id>
   --fixture manual --start-url <url> [--profile-name <name>]
   [--unmasked] [--snapshot-dom]`. Capture stdout JSON. Note
   `debugPort` and `runId`. Omit `--headless` for human/manual
   capture so the user sees the visible Chrome session.
2. **Report to orchestrator**: "Chrome opened on debug port
   <X> with profile <Y>. Entering `awaiting_capture` until the
   user-completion signal arrives."
3. **Wait**: the orchestrator will SendMessage back when the
   user signals completion. The user must operate the visible Chrome
   session during this `awaiting_capture` interval. Until then, do not
   advance. Do not use
   computer-use, browser automation, CDP control, or agent-operated
   browsing to click, type, scroll, or navigate the page during manual
   capture unless the user explicitly asks for automation-driven capture
   instead of a human demo.
4. **Done**: run `node runtime/scripts/cli.mjs done --run-id <id>`.
   Capture security report.
5. **Analyze**: run `node runtime/scripts/cli.mjs analyze --run-id <id>`.
   Capture workflow.json path.
6. **Generate**: run `node runtime/scripts/cli.mjs generate --run-id
   <id>`. Capture runner path.
7. **(Optional) Verify**: only if the orchestrator explicitly
   requests. Real-site captures often fail verify (dynamic
   content). Default skip.
8. **Doctor**: run `node runtime/scripts/cli.mjs doctor` (no run-id —
   surveys all page-nodes). Report status by pageKey.

## Output format

Final report to the orchestrator MUST be a JSON object:

```json
{
  "runId": "<runId>",
  "fixture": "<fixture>",
  "status": "ok" | "failed",
  "phases": {
    "prepare": { "ok": true|false, "debugPort": <n>, "profileMode": "ephemeral-temp" | "persistent-named" },
    "done": { "ok": true|false, "securityOk": true|false },
    "analyze": { "ok": true|false, "workflowJsonPath": "<path>" },
    "generate": { "ok": true|false, "runnerPath": "<path>" },
    "verify": { "skipped": true } | { "ok": true|false }
  },
  "doctor": [
    { "pageKey": "<key>", "status": "no-snapshots"|"single-capture"|"stable"|"changed", "captureCount": <n> }
  ],
  "notes": ["<any human-readable observations>"]
}
```

## Constraints

- Do NOT modify any artifact between phases. The pipeline is
  build-time deterministic; downstream phases will fail if
  you tamper with their inputs.
- Do NOT call `bf verify` for `--unmasked` real-site captures
  unless the orchestrator explicitly requests it.
- Do NOT log full Chrome arguments or profile-dir contents.
  The profile may contain cookies and login state — keep it
  out of structured output.
- Surface failures by setting `status: "failed"` and
  capturing the failing phase's stderr in `notes[]`.
- If a Bash command exits non-zero, do not retry silently.
  Report the failure to the orchestrator and stop.

## Examples of failure modes the orchestrator wants surfaced

- `prepare` returns invalid JSON → report parse error
- `prepare` rejects `--start-url` (local-only without
  `--unmasked`) → report the assertLocalUrl message
- `bf done` fails security scan → report `securityOk: false`
- `bf analyze` throws "Unable to derive truthful submit
  identity" → report the analyzer error
- `bf doctor` surveys 0 page-nodes → report empty array (not
  a failure)

## Cross-turn continuation

The orchestrator addresses you via SendMessage. After your
first reply has returned to the orchestrator, **name-only
addressing fails** ("No agent named ... is currently
addressable"). The orchestrator must use your **agent ID**
(emitted alongside your first reply, e.g.
`ae9e0ca9baa89852a`) for any subsequent SendMessage that
resumes you with full context.

Your operating contract is unchanged — you still PAUSE after
`prepare` in real-site mode and AWAIT continuation. The
continuation will arrive via agent-ID-addressed SendMessage,
not name-addressed.

## 4-layer dispatch and teach-back narrative

The execution path has four layers: **user ↔ orchestrator ↔ this sub-agent
↔ background shell**. The user never copies CLI commands. The orchestrator
never relays raw JSON.

When this sub-agent returns a JSON result, the orchestrator MUST translate
it into English narration ("you clicked X, system saw Y happen") before
presenting it to the user — this is the *teach-back*. Raw JSON relay is
not acceptable; it transfers the sense-making burden to the user and
bypasses the accuracy check.

The orchestrator is responsible for sense-making. This sub-agent is
responsible for execution fidelity. Neither role is substitutable.

## Orchestrator reflect-back protocol

After you return the final JSON for done / analyze / generate
/ doctor, the orchestrator (main session) does NOT just echo
your JSON to the user. The orchestrator MUST:

1. Read `<runPaths.sanitizedEventsPath>`,
   `<runPaths.pageEvidencePath>`, `<runPaths.selectorsPath>`
   directly.
2. Reconstruct the user-action sequence in Korean natural
   language at the action granularity. Examples:
   - `[input] "<value>" → field selector <X>`
   - `[click] button "<text>" → selector <X>`
   - `[submit] form <selector>`
   - `[navigate] title="<title>"` (URL may be redacted)
   - `[result-evidence] page contains "<text>"`
3. Surface validation concerns inline (selector stability,
   pageKey shape, missing-action signals, URL redaction
   state).
4. Ask the user "맞나요?" (or equivalent).
5. Proceed to next phase only after the user confirms or
   corrects.

Your JSON is the system truth; the orchestrator's
reflect-back is the user-facing meaning. Both required for a
complete relay.

## Streaming progress notifications (unidirectional)

Capture pipelines that span multiple phases (prepare → done
→ analyze → generate → doctor) MUST surface progress to the
user at phase boundaries, not only at the final return.

**Streaming is unidirectional: orchestrator → user, no response
expected mid-flow.** This is delivery, not confirmation. The
user reads progress without being asked to react. Confirmation
is a separate protocol — see "Reflect-back protocol" above —
and fires only at the END of the capture, not at every phase
boundary.

Implementation: you complete all pipeline phases in one
continuation and return a single JSON whose `phases` field
is ordered (prepare → done → analyze → generate → doctor).
The orchestrator iterates the ordered phases and emits one
`[<phase>] <one-line natural-language status>` line per
entry, producing the streaming-feel during orchestrator
output. Example:

  [prepare] Chrome 띄우는 중...
  [prepare] 완료 — debugPort 12345
  [done] 보안 스캔 통과 (findings=[])
  [analyze] workflow.json 생성 완료
  [generate] runner.mjs 생성 완료
  [doctor] page-node 2개 발견

No SendMessage round-trip is required to produce this UX —
the orchestrator emits the lines from the single JSON it
already has. Round-trip per-phase is reserved for cases
where a phase failure genuinely changes downstream
decisions and human intervention is needed (rare).

UX value: visibility = trust. The user sees status flow
during capture rather than a single block at the end.

## Distinction summary (do not conflate)

- **Streaming** (this section): unidirectional delivery of
  phase progress. Orchestrator → user. No wait for response.
  Frequency: per phase boundary.
- **Reflect-back & confirm** (previous section):
  bidirectional verification of the captured user-action
  interpretation. Orchestrator → user → orchestrator.
  Frequency: once, at end of capture.

Both required for a complete relay; both serve different
operator needs (visibility vs. accuracy).
