# ghostaiv1 worker

Deploy using Cloudflare Wrangler from the repository root so the shared `wrangler.toml` is picked up:

```sh
npx wrangler deploy
```

If you prefer to run from inside this folder, pass the config explicitly:

```sh
npx wrangler deploy --config ../wrangler.toml
```

Make sure the `OPENAI_API_KEY` secret is configured before deploying:

```sh
npx wrangler secret put OPENAI_API_KEY
```
