# Security Policy

We currently accept reports for vulnerabilities on the latest published version
of **axi** (this repository).

## Reporting a Vulnerability

**You must report vulnerabilities by emailing [aquin@aquin.app](mailto:aquin@aquin.app).** That is the only accepted channel.

Do **not** open a public GitHub issue (or discussion, PR, or other public post) for a security vulnerability. Public vulnerability reports will be **closed immediately**. Re-send the report privately to **aquin@aquin.app**.

When reporting a finding, include:

- The project or repository name (**axi**)
- A clear description of the issue and its impact
- Steps to reproduce, and any proof-of-concept if available
- Affected versions or commit hashes, if known

We do not currently offer a bounty for disclosures. We will acknowledge valid reports and work to address them as promptly as we can.

## Scope notes

axi runs tools against a workspace with a permission model (`ask` / `auto` / `plan` / `full-access`). Reports that show a bypass of `authorizeTool`, unintended credential exposure from `~/.axi`, or unsafe default behavior are especially useful. Do not include live API keys or personal chat contents in reports — redact them.
