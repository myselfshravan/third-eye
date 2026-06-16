# Security Policy

## Supported Versions

third-eye is pre-1.0 and under active development. Security fixes target the
latest `main`. Pin a commit/tag if you need stability.

## Reporting a Vulnerability

**Please do not open public issues for security vulnerabilities.**

Report privately via GitHub's
[private vulnerability reporting](https://github.com/myselfshravan/third-eye/security/advisories/new)
(Security → Advisories → "Report a vulnerability").

Please include:
- A description of the issue and its impact
- Steps to reproduce (a minimal request/URL that triggers it)
- Affected version/commit
- Any suggested remediation

We aim to acknowledge reports within 72 hours and to ship a fix or mitigation as
quickly as severity warrants. We'll credit you in the advisory unless you prefer
to remain anonymous.

## Operator security notes

Because third-eye fetches and renders **arbitrary, user-supplied URLs**, treat
it as a potential **SSRF** vector and harden your deployment:

- **Network isolation** — run capture workers where they cannot reach internal
  services, cloud metadata endpoints (`169.254.169.254`), or private CIDRs.
  Egress-filter to the public internet only.
- **Auth** — never run with `API_KEYS` empty in production (that disables auth).
  Use strong, rotated keys (`openssl rand -hex 24`).
- **Resource limits** — keep `CAPTURE_TIMEOUT_MS`, `BROWSER_MAX_USES`, and pool
  sizes bounded; run containers with memory limits so a hostile page can't OOM
  the host.
- **Input** — the API validates request shape, but `injectJs`/`injectCss` run
  attacker-influenced code in the page context; expose those options only to
  trusted callers.
- **Storage** — scope object-store credentials to a single bucket/prefix.
