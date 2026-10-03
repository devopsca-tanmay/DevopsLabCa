# Deployment

End-to-end AWS deployment: provisioning, secrets, the automated pipeline,
verification, rollback and recovery.

- [What deployment means here](#what-deployment-means-here)
- [Prerequisites](#prerequisites)
- [Step 1 — Launch the EC2 instance](#step-1--launch-the-ec2-instance)
- [Step 2 — Configure the security group](#step-2--configure-the-security-group)
- [Step 3 — Bootstrap the instance](#step-3--bootstrap-the-instance)
- [Step 4 — Create the Docker Hub repositories](#step-4--create-the-docker-hub-repositories)
- [Step 5 — Add the GitHub Secrets](#step-5--add-the-github-secrets)
- [Step 6 — Deploy](#step-6--deploy)
- [Step 7 — Verify](#step-7--verify)
- [Using Amazon ECR instead](#using-amazon-ecr-instead)
- [Manual deployment](#manual-deployment)
- [Rollback runbook](#rollback-runbook)
- [Database migrations](#database-migrations)
- [Backup and recovery](#backup-and-recovery)
- [Adding HTTPS](#adding-https)
- [Troubleshooting](#troubleshooting)
- [Secrets reference](#secrets-reference)

---

## What deployment means here

```
   Build in CI   ->   Store the artifact   ->   Deploy that artifact
   (test, scan)       (registry, SHA tag)       (pull and run on EC2)
```

**Not** this:

```
   SSH in  ->  git pull  ->  npm install  ->  npm build       <-- NOT what happens
```

The application source code is never on the instance. Only three things are
synced there: `docker-compose.prod.yml`, `nginx/nginx.conf`, and `database/`.
The application itself arrives as pre-built images pulled from the registry —
byte-for-byte the artifacts CI tested and scanned.

`docker-compose.prod.yml` contains **no `build:` key anywhere**, which is what
enforces this.

---

## Prerequisites

- An AWS account
- A Docker Hub account (free tier is sufficient)
- The repository pushed to GitHub
- An SSH key pair for EC2

---

## Step 1 — Launch the EC2 instance

AWS Console → EC2 → **Launch instance**

| Setting | Value | Why |
|---|---|---|
| Name | `fintrack-production` | |
| AMI | Ubuntu Server 22.04 LTS (or 24.04) | `scripts/ec2-setup.sh` targets Ubuntu |
| Instance type | **`t3.small`** | 2 GB RAM. `t2.micro` (free tier) works with the swap file the bootstrap script creates, but four containers plus PostgreSQL on 1 GB is tight |
| Key pair | Create or select one | Download the `.pem` — it becomes the `EC2_SSH_KEY` secret |
| Storage | 20 GB gp3 | Docker images plus the database |
| Security group | New — see Step 2 | |

Note the **public IPv4 address** once it launches. That becomes `EC2_HOST`.

> An EC2 public IP changes when the instance is stopped and started. For a
> demonstration spanning several days, allocate an **Elastic IP** and associate
> it, or you will have to update `EC2_HOST` each time.

---

## Step 2 — Configure the security group

| Type | Port | Source | Why |
|---|---|---|---|
| SSH | 22 | **My IP** | Administration and the CD pipeline. Opening this to `0.0.0.0/0` invites continuous brute-force traffic |
| HTTP | 80 | `0.0.0.0/0` | Public application traffic |
| HTTPS | 443 | `0.0.0.0/0` | Once TLS is configured |
| PostgreSQL | 5432 | **DO NOT ADD** | See below |

**Why there is no database rule.** `docker-compose.prod.yml` declares no
`ports:` for the postgres service, so the container publishes nothing to the
host — PostgreSQL is reachable only as `postgres:5432` on the internal Docker
network. Two independent layers keep it private: no published port, and no
firewall rule. Either alone would be sufficient; having both is correct.

> GitHub Actions runners use a wide, changing IP range. With SSH restricted to
> your IP, the CD workflow cannot connect. Options, best first:
> 1. Use AWS Systems Manager Session Manager (no inbound SSH at all)
> 2. Open 22 to GitHub's published Actions IP ranges (`https://api.github.com/meta`)
> 3. For a time-boxed demonstration only, open 22 to `0.0.0.0/0` and **close it
>    afterwards**

---

## Step 3 — Bootstrap the instance

```bash
chmod 400 ~/Downloads/fintrack-key.pem

scp -i ~/Downloads/fintrack-key.pem scripts/ec2-setup.sh ubuntu@<EC2-IP>:~
ssh -i ~/Downloads/fintrack-key.pem ubuntu@<EC2-IP> 'bash ~/ec2-setup.sh'
```

The script installs Docker Engine and the Compose v2 plugin **from Docker's own
apt repository** (Ubuntu's package is older and ships Compose v1, the
`docker-compose` binary, rather than the `docker compose` plugin this project
uses), adds `ubuntu` to the `docker` group, creates `/opt/fintrack` with mode
`750`, caps daemon log size, and creates a 2 GB swap file.

Log out and back in so the `docker` group applies, then confirm:

```bash
ssh -i ~/Downloads/fintrack-key.pem ubuntu@<EC2-IP>
docker --version
docker compose version
ls -ld /opt/fintrack
```

---

## Step 4 — Create the Docker Hub repositories

Docker Hub → **Create repository**, twice:

- `fintrack-backend`
- `fintrack-frontend`

Then create an access token: **Account Settings → Security → New Access
Token**, with Read & Write scope. Use the token — not your account password —
as `DOCKERHUB_TOKEN`.

---

## Step 5 — Add the GitHub Secrets

GitHub → repository → **Settings → Secrets and variables → Actions → New
repository secret**.

| Secret | Value | How to produce it |
|---|---|---|
| `DOCKERHUB_USERNAME` | Your Docker Hub username | Also the image namespace |
| `DOCKERHUB_TOKEN` | The access token from Step 4 | Not your password |
| `EC2_HOST` | `13.234.x.x` | EC2 console → public IPv4 |
| `EC2_USER` | `ubuntu` | Default for Ubuntu AMIs |
| `EC2_SSH_KEY` | The **entire** `.pem` contents | `cat fintrack-key.pem` — include the `-----BEGIN/END-----` lines |
| `POSTGRES_USER` | `fintrack` | Your choice |
| `POSTGRES_PASSWORD` | A strong password | `openssl rand -base64 24` |
| `POSTGRES_DB` | `fintrack` | Your choice |
| `JWT_SECRET` | A 64-char hex string | `openssl rand -hex 32` |

```bash
# Generate the two secrets
openssl rand -hex 32        # JWT_SECRET
openssl rand -base64 24     # POSTGRES_PASSWORD
```

> `EC2_SSH_KEY` must be the complete private key including both delimiter
> lines. A truncated key is the single most common cause of
> `Permission denied (publickey)` in the CD job.

> Changing `JWT_SECRET` after deployment invalidates every issued token — all
> users are logged out. That is the correct response to a suspected leak, but
> not something to do casually.

---

## Step 6 — Deploy

Push to `main`:

```bash
git checkout main
git merge develop
git push origin main
```

Then watch **Actions**:

```
  CI
   lint · unit-tests · integration-tests · build-frontend   (parallel)
            |
       build-images  ->  trivy scan  ->  push :latest and :<sha>
            |
  CD  (only if CI concluded success)
            |
   ssh -> write .env -> docker compose pull
            |
   start postgres -> wait healthy -> npm run migrate
            |
   docker compose up -d -> prune old images
            |
   verify: containers healthy -> /health -> frontend 200
            |
       Deployment successful
```

---

## Step 7 — Verify

From anywhere:

```bash
curl http://<EC2-IP>/health
```

```json
{
  "status": "healthy",
  "service": "fintrack-backend",
  "version": "a81f23c",
  "uptimeSeconds": 42,
  "checks": { "database": "up" }
}
```

`version` is the deployed image tag — this is how you confirm from outside the
instance that the new build is actually serving.

On the instance:

```bash
ssh -i key.pem ubuntu@<EC2-IP>
cd /opt/fintrack
docker compose -f docker-compose.prod.yml ps
```

```
NAME                 STATUS
fintrack-nginx       Up 2 minutes (healthy)
fintrack-frontend    Up 2 minutes (healthy)
fintrack-backend     Up 2 minutes (healthy)
fintrack-postgres    Up 2 minutes (healthy)
```

Then open `http://<EC2-IP>` in a browser, register, and add a transaction.

---

## Using Amazon ECR instead

ECR is the AWS-native registry: private by default, IAM-controlled, and in the
same region as the instance — faster pulls and no cross-internet egress.

```bash
aws ecr create-repository --repository-name fintrack-backend  --region ap-south-1
aws ecr create-repository --repository-name fintrack-frontend --region ap-south-1
```

In `ci.yml`, replace the Docker Hub login step with:

```yaml
- uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id:     ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region:            ${{ secrets.AWS_REGION }}

- uses: aws-actions/amazon-ecr-login@v2
  id: ecr
```

and change the image tags to
`${{ steps.ecr.outputs.registry }}/fintrack-backend:<tag>`.

On the instance, the registry login becomes:

```bash
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-south-1.amazonaws.com
```

The cleanest approach is to attach an **IAM instance role** with
`AmazonEC2ContainerRegistryReadOnly` to the EC2 instance, so it can pull
without any long-lived credentials on disk at all.

Additional secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
`ECR_REGISTRY`.

Everything else — tagging, scanning, the compose files, rollback — is
unchanged, because they all read `REGISTRY` from the environment.

---

## Manual deployment

Useful when demonstrating the steps the pipeline automates.

```bash
ssh -i key.pem ubuntu@<EC2-IP>
cd /opt/fintrack

# .env is written by the pipeline; create it by hand the first time if needed
umask 077
cat > .env <<'EOF'
REGISTRY=docker.io/<your-username>
IMAGE_TAG=latest
POSTGRES_USER=fintrack
POSTGRES_PASSWORD=<password>
POSTGRES_DB=fintrack
JWT_SECRET=<secret>
JWT_EXPIRES_IN=24h
BCRYPT_ROUNDS=10
LOG_LEVEL=info
NODE_ENV=production
EOF

docker login -u <username>
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml run --rm --no-deps backend npm run migrate
docker compose -f docker-compose.prod.yml up -d
curl http://localhost/health
```

---

## Rollback runbook

### When to roll back

- `/health` does not return `"status":"healthy"`
- The frontend does not load
- A critical defect is discovered in the new version
- The CD job reported failure

### Automatic

`cd.yml` records the currently deployed tag **before** touching anything. If
verification fails, it rewrites `IMAGE_TAG` to that value, brings the stack
back up, and re-verifies — reporting either `::notice::Rollback successful` or
an explicit call for manual intervention.

### Manual — the script

```bash
ssh -i key.pem ubuntu@<EC2-IP>
cd /opt/fintrack

./rollback.sh                 # current version + locally available versions
./rollback.sh a81f23c         # roll back, then verify health automatically
```

The script saves the previous `.env` as `.env.before-rollback` and restores it
if the pull fails, so a mistyped tag does not leave the instance in a broken
state.

### Manual — by hand

```bash
cd /opt/fintrack
grep IMAGE_TAG .env                                        # what is live now
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=a81f23c/' .env           # pick the target
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
curl http://localhost/health
```

### From GitHub

**Actions → CD → Run workflow**, entering the image tag. This uses the same
verified deployment path as a normal release.

### Finding the tag to roll back to

| Source | Command |
|---|---|
| Locally cached images | `docker images '*/fintrack-backend'` |
| Registry | Docker Hub → repository → Tags |
| Git history | `git log --oneline -10` — the 7-char SHA **is** the tag |
| Previous CD run | The job summary records both deployed and previous versions |

### Version table — keep this current during the demonstration

| Version | Image tag | Deployed | Notes |
|---|---|---|---|
| v2 | `b72d91e` | *(date)* | Current |
| v1 | `a81f23c` | *(date)* | Last known good — rollback target |

---

## Database migrations

```
  database/init.sql        runs ONCE, only on an empty postgres volume
  database/migrations/     everything after that, forward-only
```

The CD pipeline runs `npm run migrate` **before** the new containers take
traffic, using the **new** image — so migration code always matches application
code. A non-zero exit aborts the deploy and leaves the old stack running.

Each migration runs inside its own transaction and is recorded in
`schema_migrations`, so re-running is a no-op and a failure leaves no partial
schema.

### Adding one

```bash
cat > database/migrations/003_add_transaction_tags.sql <<'SQL'
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tags TEXT[];
SQL
```

Write migrations to be **additive and idempotent** (`IF NOT EXISTS`,
`ADD COLUMN` with a default). An additive migration is compatible with the
previous image, which is what keeps rollback safe.

### The destructive case — read before dropping a column

A rollback restores the **application image**, not the database. If migration
`004` drops a column and the deployment then fails, rolling back to the
previous image gives you code that queries a column which no longer exists.

For a destructive change:

1. `pg_dump` **before** deploying (see below)
2. Prefer a two-release pattern: release N stops using the column; release N+1
   drops it. Each release is then independently rollback-safe
3. Or write and test a reversing migration before deploying

---

## Backup and recovery

### Back up

```bash
ssh -i key.pem ubuntu@<EC2-IP>
cd /opt/fintrack
set -a; source .env; set +a

docker exec fintrack-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > ~/fintrack-$(date +%Y%m%d-%H%M).sql.gz
```

Copy it off the instance — a backup that lives only on the machine it protects
is not a backup:

```bash
scp -i key.pem ubuntu@<EC2-IP>:~/fintrack-*.sql.gz ./backups/
```

Nightly, via cron on the instance:

```bash
0 2 * * * cd /opt/fintrack && set -a && . ./.env && set +a && \
  docker exec fintrack-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > ~/backups/fintrack-$(date +\%Y\%m\%d).sql.gz
```

### Restore

```bash
cd /opt/fintrack
set -a; source .env; set +a

gunzip -c ~/fintrack-20261003-0200.sql.gz \
  | docker exec -i fintrack-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

### Full instance loss

Everything except the database is reproducible from the repository and the
registry:

1. Launch a replacement instance (Steps 1–3)
2. Update the `EC2_HOST` secret
3. Re-run the CD workflow — images are pulled, the stack comes up
4. Restore the most recent `pg_dump`

**The `pgdata` volume is the only irreplaceable thing on the instance.** That
is precisely why it is the only thing backed up.

---

## Adding HTTPS

Needs a real domain name — an EC2 public IP cannot have a certificate issued
for it.

```bash
# 1. Point an A record at the instance (or its Elastic IP)
# 2. Open 443 in the security group
# 3. On the instance:
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d fintrack.example.com
```

Certbot writes the TLS server block and a 301 redirect from `:80`
automatically. The shape it produces is included, commented, at the bottom of
`nginx/nginx.conf`.

Then uncomment in `docker-compose.prod.yml`:

```yaml
ports:
  - "80:80"
  - "443:443"
volumes:
  - /etc/letsencrypt:/etc/letsencrypt:ro
```

---

## Troubleshooting

### `Permission denied (publickey)` in the CD job

`EC2_SSH_KEY` is incomplete. Paste the **entire** key:

```bash
cat fintrack-key.pem
# -----BEGIN RSA PRIVATE KEY-----
# ...every line...
# -----END RSA PRIVATE KEY-----
```

Also confirm `EC2_USER` is `ubuntu` (not `ec2-user`, which is Amazon Linux).

### `docker: permission denied while trying to connect to the Docker daemon`

The deploy user is not in the `docker` group.

```bash
sudo usermod -aG docker ubuntu
# then log out and back in
```

### `manifest unknown` / `pull access denied`

The tag does not exist in the registry, or the login failed. Check the CI run
actually reached its push step, and verify `DOCKERHUB_USERNAME` matches the
image namespace exactly.

### Health check fails but the containers are running

```bash
docker logs --tail 100 fintrack-backend
docker exec fintrack-backend curl -s localhost:5000/health
```

If it reports `"database":"down"`:

```bash
docker logs fintrack-postgres
docker exec fintrack-postgres pg_isready -U fintrack
```

Most often a `POSTGRES_PASSWORD` mismatch between the secret and an existing
volume — **the password in the volume was set on first initialisation and does
not change when the secret changes.** Either restore the original password or
recreate the volume (which destroys the data).

### The site is unreachable but the deployment succeeded

Security group: confirm inbound 80 is open to `0.0.0.0/0`. Then from the
instance:

```bash
curl http://localhost/health      # works? -> it is the security group
```

### Instance out of memory

```bash
free -h
docker stats --no-stream
```

Confirm the swap file exists (`scripts/ec2-setup.sh` creates one), or move to a
larger instance type.

### Disk full

```bash
df -h
docker system df
docker image prune -a -f     # removes images not used by a running container
```

> `docker image prune -a` removes images no running container uses — **including
> your rollback targets**. Prefer the filtered form the CD pipeline uses:
> `docker image prune -f --filter "until=168h"`.

---

## Secrets reference

Every secret the pipeline needs, where it is used, and how to generate it.

| Secret | Used in | Purpose | Source |
|---|---|---|---|
| `DOCKERHUB_USERNAME` | `ci.yml`, `cd.yml` | Registry login, image namespace | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | `ci.yml`, `cd.yml` | Registry authentication | Docker Hub → Security → New Access Token |
| `EC2_HOST` | `cd.yml` | Deployment target | EC2 console → public IPv4 |
| `EC2_USER` | `cd.yml` | SSH user | `ubuntu` |
| `EC2_SSH_KEY` | `cd.yml` | SSH authentication | The full `.pem` file contents |
| `POSTGRES_USER` | `cd.yml` → `.env` | Database user | Your choice |
| `POSTGRES_PASSWORD` | `cd.yml` → `.env` | Database password | `openssl rand -base64 24` |
| `POSTGRES_DB` | `cd.yml` → `.env` | Database name | `fintrack` |
| `JWT_SECRET` | `cd.yml` → `.env` | Token signing | `openssl rand -hex 32` |
| `AWS_ACCESS_KEY_ID` | `ci.yml` *(ECR only)* | ECR authentication | IAM user |
| `AWS_SECRET_ACCESS_KEY` | `ci.yml` *(ECR only)* | ECR authentication | IAM user |
| `AWS_REGION` | `ci.yml` *(ECR only)* | ECR region | e.g. `ap-south-1` |
| `ECR_REGISTRY` | `ci.yml` *(ECR only)* | Registry host | `<account>.dkr.ecr.<region>.amazonaws.com` |

**None of these values appears anywhere in this repository**, in any branch or
commit. They exist only in GitHub Secrets and, at runtime, in
`/opt/fintrack/.env` on the instance — written with `umask 077` (mode `600`)
and rewritten on every deploy.

### If a secret leaks

1. **Rotate it immediately** — a new token, a new password, a new key pair
2. Update the GitHub Secret
3. Re-deploy
4. For `JWT_SECRET`, note that rotation logs every user out — that is the
   intended effect
5. Deleting the value in a later commit does **not** remove it from git history.
   Rotate first; clean history second
