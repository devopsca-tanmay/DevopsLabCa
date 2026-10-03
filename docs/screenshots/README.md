# Screenshots

Capture these for the project report. The numbering matches the table in the
root `README.md`.

| # | File | What to capture | Where |
|---|---|---|---|
| 1 | `01-repository.png` | Repository home page | GitHub |
| 2 | `02-branches.png` | Branch list showing all 8 branches | GitHub → Branches |
| 3 | `03-pull-request.png` | A pull request with CI checks listed | GitHub → Pull requests |
| 4 | `04-ci-success.png` | A CI run with all five jobs green | Actions tab |
| 5 | `05-ci-failure.png` | A CI run with tests red and `build-images` **skipped** | Actions tab |
| 6 | `06-test-output.png` | Jest output in the job log | Actions → unit-tests |
| 7 | `07-docker-images.png` | `docker images` | Terminal |
| 8 | `08-docker-ps.png` | `docker compose ps` with all four healthy | Terminal |
| 9 | `09-compose-up.png` | `docker compose up -d` output | Terminal |
| 10 | `10-registry-tags.png` | Both `latest` and the SHA tag | AWS Console → ECR |
| 11 | `11-ec2-instance.png` | The running instance | AWS Console |
| 12 | `12-security-group.png` | Inbound rules (note: no 5432) | AWS Console |
| 13 | `13-deployment-log.png` | The CD job log | Actions → CD |
| 14 | `14-health-check.png` | `curl http://<EC2-IP>/health` | Terminal |
| 15 | `15-live-app.png` | The dashboard in a browser | Browser |
| 16 | `16-rollback.png` | `./rollback.sh` output and the restored version | Terminal + browser |

## Getting a dashboard worth screenshotting

An empty account shows empty states. Seed realistic data first:

```bash
node scripts/seed-demo-data.js                 # against http://localhost
node scripts/seed-demo-data.js http://<EC2-IP> # against the deployment
```

That creates `demo@fintrack.local` / `demo-password-123` with two months of
history — income 120,000, expenses 35,000, balance 85,000, a ~71% savings rate,
and budgets deliberately spanning all three states (on track, close to limit,
over budget) so every part of the dashboard renders.
