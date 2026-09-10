# Railway Infrastructure as Code

This directory contains the Railway project configuration as code.

## Files

- `railway.ts` — the single source of truth for the Railway project/environment.

## Workflow

Install the Railway CLI and the TypeScript SDK, then link this directory to
your Railway project:

```bash
npm install railway
railway login
railway link
```

Preview and apply changes:

```bash
railway config plan
railway config apply
```

Import the current Railway project state into the authoring file:

```bash
railway config pull
```

See https://docs.railway.com/infrastructure-as-code for full documentation.