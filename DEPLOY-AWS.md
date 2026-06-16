# Deploying third-eye on AWS (EC2 + S3 + Cloudflare Tunnel)

Single EC2 instance running `api` + `worker` + `redis` via Docker Compose,
captures/product images stored in **S3**, published through a **Cloudflare
Tunnel** (no inbound ports). Region used here: **`ap-south-1` (Mumbai)** — close
to India-centric downstreams; swap freely, credits apply anywhere.

> Why EC2 (not Fargate/Lambda): browser workloads are memory-bound and want full
> `shm`/instance control + a warm pool. See [README → Deploy](README.md#deploy).

---

## 1. S3 bucket + IAM (ap-south-1)
```bash
aws s3api create-bucket --bucket third-eye-captures \
  --region ap-south-1 --create-bucket-configuration LocationConstraint=ap-south-1
```
Create an IAM user (or role) scoped to just this bucket:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject"],
    "Resource": "arn:aws:s3:::third-eye-captures/*"
  }]
}
```
Generate an access key for that user. (Bucket stays **private** — third-eye
returns presigned URLs. Front it with CloudFront later for public CDN URLs and
set `S3_PUBLIC_BASE_URL`.)

## 2. Launch the EC2 instance
- **AMI:** Amazon Linux 2023.
- **Type:** `t3.large` (2 vCPU/8 GB) to start, `t3.xlarge` (4 vCPU/16 GB) for
  throughput. Graviton `m7g.xlarge` (arm64) is ~20% cheaper and supported.
- **Disk:** 30 GB gp3 (the Playwright image + browsers are a few GB).
- **Security group:** **no inbound rules** (Cloudflare Tunnel dials out). Allow
  all outbound.
- **⚠️ Metadata / SSRF:** set **IMDSv2 = required**, hop limit 1. third-eye
  renders arbitrary URLs; IMDSv2 stops a hostile page from stealing instance
  creds via `169.254.169.254`. (Launch → Advanced → Metadata version: V2 only.)
- **User data:** paste [`deploy/aws-ec2-userdata.sh`](deploy/aws-ec2-userdata.sh)
  — installs Docker + compose, adds swap, clones the repo, writes a starter `.env`.

## 3. Cloudflare Tunnel
Cloudflare Zero Trust → Networks → Tunnels → create one, copy the **token**, add
a public hostname (e.g. `shots.yourdomain.com`) → service `http://api:8080`.

## 4. Configure + launch
SSH in (via SSM Session Manager — no SSH port needed — or your key), then:
```bash
cd /opt/third-eye
nano .env
```
Set at minimum:
```ini
API_KEYS=te_live_<openssl rand -hex 24>:unlimited
TUNNEL_TOKEN=<cloudflare tunnel token>
STORAGE_DRIVER=s3
S3_REGION=ap-south-1
S3_BUCKET=third-eye-captures
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
# leave S3_ENDPOINT empty for native AWS S3
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

## Cost (rough, on-demand; credits cover it)
- `t3.large` ≈ \$0.084/hr (~\$60/mo) · `t3.xlarge` ≈ \$0.17/hr · `m7g.xlarge` ~20% less.
- S3: pennies at this scale. Cloudflare Tunnel: free. ElastiCache: not needed
  (Redis runs in-compose) until you split workers across machines.

## When to graduate off a single box
Move to **ECS on EC2** (keeps `shm` control) or **ECS Fargate** with
**ElastiCache** Redis + an **ALB** once one instance can't hold the worker
concurrency you need. The image is identical; only the orchestration changes.
