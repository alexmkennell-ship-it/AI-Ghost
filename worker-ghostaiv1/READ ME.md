diff --git a/worker-ghostaiv1/README.md b/worker-ghostaiv1/README.md
new file mode 100644
index 0000000000000000000000000000000000000000..971947d6b3c362df6e073777ca3b0d794de7c5b5
--- /dev/null
+++ b/worker-ghostaiv1/README.md
@@ -0,0 +1,30 @@
+# ghostaiv1 worker
+
+Deploy using Cloudflare Wrangler from the repository root so the shared `wrangler.toml` is picked up:
+
+```sh
+npx wrangler deploy
+```
+
+If you prefer to run from inside this folder, pass the config explicitly:
+
+```sh
+npx wrangler deploy --config ../wrangler.toml
+```
+
+Make sure the `OPENAI_API_KEY` secret is configured before deploying:
+
+```sh
+npx wrangler secret put OPENAI_API_KEY
+```
+
+## Continuous deployment via GitHub Actions
+
+This repository includes a `Deploy ghostaiv1 worker` workflow that can publish updates without using the command line. To enable it:
+
+1. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**.
+2. Create `CLOUDFLARE_API_TOKEN` with a token that has **Account → Workers Scripts:Edit** and **Account → Workers KV Storage:Edit** (if used) permissions for your Cloudflare account.
+3. Create `CLOUDFLARE_ACCOUNT_ID` with your Cloudflare account ID.
+4. Commit and push your changes to the `main` branch (or trigger the workflow manually via **Actions → Deploy ghostaiv1 worker → Run workflow**).
+
+The workflow automatically installs Wrangler and deploys using the shared `wrangler.toml`, so you can roll out updates directly from GitHub.
