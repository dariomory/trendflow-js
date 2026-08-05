# Affiliate link checklist

The proxy provider links in the docs are affiliate links with **placeholder IDs**. Replace
them before publishing, or they will send traffic that credits nobody.

## Placeholders to replace

| Placeholder | File | Where |
|-------------|------|-------|
| `REPLACE_WITH_DECODO_AFFILIATE_ID` | `README.md` | "Where to get proxies" table |
| `REPLACE_WITH_OXYLABS_AFFILIATE_ID` | `README.md` | "Where to get proxies" table |

Find every remaining placeholder with:

```bash
grep -rn "REPLACE_WITH_" --include="*.md" .
```

Both current links use a `?ref=` query parameter. If a program issues a different link
format — a distinct domain, a path segment, or a tracking subdomain — replace the whole URL
rather than just the ID.

## Sign-up links

- Decodo (formerly Smartproxy): https://decodo.com/affiliate-program
- Oxylabs: https://oxylabs.io/affiliate-program

## Rules to keep

- **Keep the disclosure.** The README carries an affiliate disclosure directly beneath the
  table. The FTC requires disclosure that is clear and near the links, and both programs'
  terms require it too. Do not remove it when editing the section.
- **No affiliate links in library output.** `TooManyRequestsError` points at
  `RATE_LIMIT_DOCS_URL` in `src/http/errors.ts`, a plain GitHub docs anchor. Keep it that
  way — referral URLs in error messages read as adware and get packages publicly criticised.
  The docs page is where monetisation belongs.
- **Keep the raw endpoint formats.** The table lists plain `host:port` formats so the docs
  stay useful to someone using another provider or their own proxy.
- **Only recommend what was tested.** Both listed providers were run against this library.
  Adding a provider means verifying it works first.
