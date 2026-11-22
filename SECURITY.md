# Security

## Reporting

Do not open a public issue for a vulnerability.

Use GitHub's private vulnerability reporting:
<https://github.com/jefo/realtime-kit/security/advisories/new>

Include the affected package, version, a minimal reproduction and the impact.

## Scope

- Session IDs in `@rtkit/subscriptions` are bearer capabilities. Deploy the
  handler behind authentication and short TTLs.
- CORS is disabled by default. Enable it only for origins you control.
- `POST /subscribe` accepts at most 64 KiB by default (`maxBodyBytes`); adjust it
  deliberately, not to infinity.
- `@rtkit/market-ingest` and `@rtkit/udf-datafeed` proxy public exchange data.
  Apply your own rate limits and do not expose them as an open proxy.
- Secrets (exchange keys, Redis URLs, npm tokens) must never be committed.
