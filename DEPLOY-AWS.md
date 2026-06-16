# Deploying third-eye on AWS (EC2 + S3 + Cloudflare Tunnel)

Single EC2 instance running `api` + `worker` + `redis` via Docker Compose,
captures/product images stored in **S3**, published through a **Cloudflare
Tunnel** (no inbound ports). Region used here: **`ap-south-1` (Mumbai)** — close
to India-centric downstreams; swap freely, credits apply anywhere.

> Why EC2 (not Fargate/Lambda): browser workloads are memory-bound and want full
> `shm`/instance control + a warm pool. See [README → Deploy](README.md#deploy).

---

## Quick path (scripted, terminal-only)
With an authenticated AWS CLI (AdministratorAccess, or scoped EC2+S3+IAM+SSM):
```bash
# 1. Create S3 bucket + IAM role/profile + no-inbound SG + launch the instance:
LAUNCH=1 bash deploy/aws-provision.sh           # REGION/INSTANCE_TYPE overridable
# 2. Configure .env + start the stack over SSM (no SSH) — see steps 3-5 below.
```
The instance gets an **IAM role** granting S3 (`PutObject`/`GetObject` on the
bucket) + SSM, with **IMDSv2 required** — so there are **no static S3 keys** to
manage and nothing inbound is exposed. The rest of this doc explains each piece
and the manual/SSM steps.

## 1. What the provision script creates (ap-south-1)
- Private S3 bucket `third-eye-captures-<accountId>` (all public access blocked;
  third-eye returns presigned URLs — front with CloudFront later + set
  `S3_PUBLIC_BASE_URL` for public CDN URLs).
- IAM role `third-eye-ec2-role` + instance profile: `AmazonSSMManagedInstanceCore`
  + an inline S3 policy scoped to the bucket.
- Security group `third-eye-sg`: **no inbound**, all outbound.

## 2. The EC2 instance
- **AMI:** Amazon Linux 2023.
- **Type:** `t3.large` (2 vCPU/8 GB) to start, `t3.xlarge` (4 vCPU/16 GB) for
  throughput. Graviton `m7g.xlarge` (arm64) is ~20% cheaper and supported.
- **Disk:** 30 GB gp3 (the Playwright image + browsers are a few GB).
- **Security group:** **no inbound rules** (Cloudflare Tunnel dials out). Allow
  all outbound.
- **⚠️ Metadata / SSRF:** **IMDSv2 = required** (the provision script sets this).
  third-eye renders arbitrary URLs; IMDSv2 stops a hostile page from stealing the
  instance role creds via `169.254.169.254` (a simple GET-based SSRF can't obtain
  the IMDSv2 token). Hop limit is 2 so the app container can use the role for S3.
- **User data:** [`deploy/aws-ec2-userdata.sh`](deploy/aws-ec2-userdata.sh)
  — installs Docker + compose + **buildx**, adds swap, clones the repo, writes a
  starter `.env`.

## 3. Cloudflare Tunnel
Cloudflare Zero Trust → Networks → Tunnels → create one, copy the **token**, add
a public hostname (e.g. `shots.yourdomain.com`) → service `http://api:8080`.

## 4. Configure + launch
SSH in (via SSM Session Manager — no SSH port needed — or your key), then:
```bash
cd /opt/third-eye
nano .env
```
Set at minimum (note: **no S3 keys** — the instance role provides S3 access):
```ini
API_KEYS=te_live_<openssl rand -hex 24>:unlimited
TUNNEL_TOKEN=<cloudflare tunnel token>
STORAGE_DRIVER=s3
S3_REGION=ap-south-1
S3_BUCKET=third-eye-captures-<accountId>
# leave S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY empty →
# the SDK uses the EC2 instance role automatically.
BROWSER_POOL_SIZE=4
WORKER_CONCURRENCY=4
EXTRACT_DOWNLOAD_IMAGES=true   # re-host product images in your S3
```
Bring it up:
```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api worker
```

## 5. Verify
```bash
curl -s http://127.0.0.1:8080/healthz                     # on the box
curl -s https://shots.yourdomain.com/healthz              # via tunnel
curl -s -X POST https://shots.yourdomain.com/v1/extract \
  -H "x-api-key: <key>" -H 'content-type: application/json' \
  -d '{"url":"https://bluorng.com/products/flyway-linen-shirt"}'
```

## 6. Operate
```bash
# scale workers (more capture throughput):
docker compose -f docker-compose.prod.yml up -d --scale worker=3
# update:
git pull && docker compose -f docker-compose.prod.yml up -d --build
# metrics: http://127.0.0.1:8080/metrics  (scrape via CloudWatch agent / Prometheus)
```

## 7. Continuous deploy (`#deploy`)
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) ships to the box
over SSM (no SSH) — `git reset --hard origin/main` → `docker compose up -d
--build` → health-check. It runs when you **push to `main` with `#deploy` in the
commit message**, or manually (Actions → Deploy → Run workflow).

One-time setup:
1. Create a dedicated **deploy IAM user** with this least-privilege policy:
   ```json
   { "Version": "2012-10-17", "Statement": [
     { "Effect": "Allow", "Action": ["ec2:DescribeInstances"], "Resource": "*" },
     { "Effect": "Allow", "Action": ["ssm:SendCommand","ssm:GetCommandInvocation"], "Resource": "*" } ] }
   ```
2. Add its keys as repo secrets **`AWS_ACCESS_KEY_ID`** / **`AWS_SECRET_ACCESS_KEY`**
   (Settings → Secrets and variables → Actions). Region defaults to `ap-south-1`.
3. Deploy: `git commit -m "feat: … #deploy" && git push`.

> Don't reuse your personal admin keys here — scope a deploy user, or upgrade to
> GitHub OIDC + an IAM role (no stored secrets).

## Cost (rough, on-demand; credits cover it)
- `t3.large` ≈ \$0.084/hr (~\$60/mo) · `t3.xlarge` ≈ \$0.17/hr · `m7g.xlarge` ~20% less.
- S3: pennies at this scale. Cloudflare Tunnel: free. ElastiCache: not needed
  (Redis runs in-compose) until you split workers across machines.

## When to graduate off a single box
Move to **ECS on EC2** (keeps `shm` control) or **ECS Fargate** with
**ElastiCache** Redis + an **ALB** once one instance can't hold the worker
concurrency you need. The image is identical; only the orchestration changes.
