# TranscriptionMate

TranscriptionMate is a single-page Next.js tool for cleaning and formatting raw lyrics with a polished editing workflow.

## Features

- Large input and output editors
- One-click sanitizer flow
- Separate source-check workflow for likely copy-paste fingerprints
- Server-side AI audit with manual verification links
- Copy-to-clipboard feedback toast
- Light and dark theme support
- Responsive layout for desktop and mobile

## Local development

```bash
npm install
npm run dev
```

## AI audit setup

Create a local `.env.local` from `.env.example` and set:

- `OPENAI_API_KEY`
- `AUDIT_MODEL` (defaults to `gpt-5-nano`)
- `AUDIT_RATE_LIMIT_PER_HOUR` (defaults to `5`)

For stronger public rate limiting on Vercel, also set:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
