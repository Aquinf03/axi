# Tests

Agent evals for axi. Not a user feature. Not `evals/` in a train. Not `aq eval`.

```
npm test
node tests/run.mjs follow-skill
```

Needs a configured provider (`axi provider`) and a reachable `aq` (`AQ_ROOT` or sibling `../aq`). Work copies land in `.work/` (gitignored).
