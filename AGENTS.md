# AGENTS.md

## Repo state
- AWS CDK (TypeScript) project: a single stack that provisions a private S3 bucket, CloudFront distribution with OAC, ACM certificate (DNS validation), Route 53 records, and deploys static content.
- Everything is configured via environment variables (see `.env.example`); never hardcode AWS credentials or account IDs.
- The stack runs in `us-east-1` (required by ACM for CloudFront).

## Toolchain and commands
- Node.js 18+ and npm. Install once: `npm install`.
- Local verification (no AWS access required):
  - `npm run typecheck` — TypeScript type check
  - `npm run synth` — generates the CloudFormation template into `cdk.out/`. Full mode requires `DOMAIN_NAME` and `HOSTED_ZONE_ID` (e.g. `DOMAIN_NAME=example.com HOSTED_ZONE_ID=Z00000000000000000000 npm run synth`); content mode requires `CLOUDFRONT_DISTRIBUTION_ID` and `S3_BUCKET_NAME`.
- Deploy (requires AWS credentials and an existing public Route 53 hosted zone):
  - `cdk bootstrap aws://<ACCOUNT>/<REGION>` — once per account/region
  - `npm run deploy` — create/update the stack and publish `SITE_DIR`
  - `npm run diff` — preview changes
  - `npm run destroy` — teardown (bucket content is retained, `RETAIN`)
- Two deploy modes (env-driven): `full` creates all infra (default); `content` only uploads `SITE_DIR` and invalidates an existing distribution (set `CLOUDFRONT_DISTRIBUTION_ID` and `S3_BUCKET_NAME`).
- Key files: `bin/site-stack.ts` (entrypoint), `lib/site-stack.ts` (resources), `lib/config.ts` (env config), `www/` (static content).
- Source of truth for design decisions: `docs/superpowers/specs/2026-09-16-s3-cloudfront-cdk-static-site-design.md` and `docs/superpowers/specs/2026-09-17-content-only-deploy-mode-design.md`.
