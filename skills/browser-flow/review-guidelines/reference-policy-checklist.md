# Reference Policy Checklist

Use this checklist when reviewing `references/*.md`.

## Policy Ownership

- [ ] Each policy reference has one clear purpose.
- [ ] A policy reference owns reusable rules that apply across more than one
  phase or agent.
- [ ] Phase-specific procedure is kept in the phase agent unless it is a shared
  contract.
- [ ] Runtime-enforced policy identifies the runtime hook or artifact that
  enforces it.

## Prompt Relationship

- [ ] `prompt.md` points to the reference when the operation is relevant.
- [ ] `prompt.md` does not copy the reference's full rule set.
- [ ] Agent documents use short summaries and point back to the reference.

## Review Quality

- [ ] Rules are structured as tables or bullet lists when they define states,
  artifacts, or verdicts.
- [ ] Rules that depend on user judgment distinguish model guidance from
  code-enforced gates.
- [ ] The reference avoids release-internal labels unless it is specifically a
  versioned artifact contract.
