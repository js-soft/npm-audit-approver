# npm-audit-auto-approval

Small GitHub App webhook service that approves selected pull requests so GitHub auto-merge can proceed when branch protection requires an approval.

For the initial implementation, the app approves a pull request only when every commit currently on the pull request has `commit.author.email` equal to `ci@js-soft.com`. The email is configurable through `APPROVED_AUTHOR_EMAIL`.

## GitHub App Setup

Create a GitHub App with:

- Webhook URL: `https://<your-host>/webhook`
- Webhook secret: any strong random value
- Subscribe to events: `Pull request`
- Repository permissions:
    - Pull requests: `Read and write`
    - Metadata: `Read-only`, granted automatically by GitHub

Install the app on the repositories that should receive automatic approvals.

## Configuration

Set these environment variables:

- `GITHUB_APP_ID`: GitHub App ID.
- `GITHUB_PRIVATE_KEY`: GitHub App private key PEM. Escaped `\n` newlines are accepted.
- `GITHUB_PRIVATE_KEY_PATH`: Alternative to `GITHUB_PRIVATE_KEY`; path to a private key PEM file.
- `GITHUB_WEBHOOK_SECRET`: Webhook secret configured on the GitHub App.
- `APPROVED_AUTHOR_EMAIL`: Optional. Defaults to `ci@js-soft.com`.
- `PORT`: Optional. Defaults to `3000`.

## Run

```bash
npm install
npm run build
npm start
```

For local development:

```bash
npm install
npm run dev
```

The service exposes `GET /healthz` for health checks and `POST /webhook` for GitHub webhook delivery.

## Security Note

Git commit author emails can be spoofed. This first version intentionally implements only the requested condition. Before broad production use, add checks for trusted repositories, branch names, PR labels, check runs, signed commits, or the exact workflow/app actor that created the PR.
