#!/usr/bin/env bash
# =============================================================================
# FinTrack - one-time AWS provisioning
# -----------------------------------------------------------------------------
# Creates everything the pipeline needs in one AWS account, idempotently, with
# nothing but the AWS CLI:
#
#   ECR      fintrack-backend, fintrack-frontend   (scan on push, keep 20 tags)
#   IAM      GitHub OIDC provider
#            fintrack-github-actions  role  -> ECR push, assumed by CI/CD
#            fintrack-ec2             role  -> ECR read-only, on the instance
#   EC2      key pair, security group (22 + 80), t3.micro Ubuntu 24.04,
#            Elastic IP so the address survives a stop/start
#
# Usage (from the repository root, with admin credentials configured):
#
#   KEY_DIR=../private ./scripts/aws-provision.sh
#
# Re-running it is safe: every resource is looked up before it is created.
# The private key is written to $KEY_DIR, which must be OUTSIDE the repository.
# The script prints the values to store as GitHub Secrets at the end.
# =============================================================================

set -euo pipefail

# Git Bash on Windows rewrites arguments that start with "/" into Windows
# paths, which breaks SSM parameter names. Harmless everywhere else.
export MSYS_NO_PATHCONV=1

REGION="${AWS_REGION:-ap-south-1}"
PROJECT=fintrack
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.micro}"
KEY_NAME="${PROJECT}-deploy"
KEY_DIR="${KEY_DIR:-../private}"
SG_NAME="${PROJECT}-web"
CI_ROLE="${PROJECT}-github-actions"
EC2_ROLE="${PROJECT}-ec2"

# owner/repo of the GitHub repository allowed to assume the CI role.
GITHUB_REPO="${GITHUB_REPO:-$(git remote get-url origin | sed -E 's#(\.git)?$##; s#.*github\.com[:/]##')}"

export AWS_DEFAULT_REGION="$REGION"
aws_txt() { aws "$@" --output text | tr -d '\r'; }

ACCOUNT_ID=$(aws_txt sts get-caller-identity --query Account)
echo "==> Account ${ACCOUNT_ID}, region ${REGION}, repository ${GITHUB_REPO}"

# --- ECR -----------------------------------------------------------------------
for repo in "${PROJECT}-backend" "${PROJECT}-frontend"; do
  if aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1; then
    echo "    ECR ${repo} exists"
  else
    echo "==> Creating ECR repository ${repo}"
    aws ecr create-repository --repository-name "$repo" \
      --image-scanning-configuration scanOnPush=true \
      --image-tag-mutability MUTABLE >/dev/null
  fi
  # Old SHA tags are rollback targets, but not forever: keep the newest 20.
  aws ecr put-lifecycle-policy --repository-name "$repo" --lifecycle-policy-text '{
    "rules": [{
      "rulePriority": 1,
      "description": "Keep the 20 most recent images",
      "selection": {"tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 20},
      "action": {"type": "expire"}
    }]}' >/dev/null
done
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# --- GitHub OIDC provider -------------------------------------------------------
OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  echo "    OIDC provider exists"
else
  echo "==> Creating the GitHub OIDC provider"
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
fi

# --- CI/CD role -----------------------------------------------------------------
# Trusted only for this repository's main and develop pushes, and for the
# `production` environment the CD job runs in. Pull requests cannot assume it.
#
# Repositories with GitHub's immutable OIDC subjects send
#   repo:<owner>@<owner-id>/<repo>@<repo-id>:ref:refs/heads/main
# instead of repo:<owner>/<repo>:..., so ask GitHub for the prefix in use and
# trust both forms.
SUB_PREFIX="repo:${GITHUB_REPO}"
GH_PREFIX=$(gh api "repos/${GITHUB_REPO}/actions/oidc/customization/sub" \
  --jq '.sub_claim_prefix // empty' 2>/dev/null | tr -d '\r' || true)
ALT_PREFIX="${GH_PREFIX:-$SUB_PREFIX}"
CI_TRUST=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "${OIDC_ARN}"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"},
      "StringLike": {"token.actions.githubusercontent.com:sub": [
        "${SUB_PREFIX}:ref:refs/heads/main",
        "${SUB_PREFIX}:ref:refs/heads/develop",
        "${SUB_PREFIX}:environment:production",
        "${ALT_PREFIX}:ref:refs/heads/main",
        "${ALT_PREFIX}:ref:refs/heads/develop",
        "${ALT_PREFIX}:environment:production"
      ]}
    }
  }]
}
JSON
)
CI_POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*"},
    {"Effect": "Allow",
     "Action": ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage",
                "ecr:CompleteLayerUpload", "ecr:DescribeImages",
                "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload",
                "ecr:PutImage", "ecr:UploadLayerPart"],
     "Resource": "arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/${PROJECT}-*"}
  ]
}
JSON
)
if aws iam get-role --role-name "$CI_ROLE" >/dev/null 2>&1; then
  echo "    IAM role ${CI_ROLE} exists - refreshing its trust policy"
  aws iam update-assume-role-policy --role-name "$CI_ROLE" --policy-document "$CI_TRUST"
else
  echo "==> Creating IAM role ${CI_ROLE}"
  aws iam create-role --role-name "$CI_ROLE" --assume-role-policy-document "$CI_TRUST" \
    --description "FinTrack GitHub Actions: push images to ECR" >/dev/null
fi
aws iam put-role-policy --role-name "$CI_ROLE" --policy-name ecr-push --policy-document "$CI_POLICY"
CI_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${CI_ROLE}"

# --- EC2 instance role ----------------------------------------------------------
if aws iam get-role --role-name "$EC2_ROLE" >/dev/null 2>&1; then
  echo "    IAM role ${EC2_ROLE} exists"
else
  echo "==> Creating IAM role ${EC2_ROLE}"
  aws iam create-role --role-name "$EC2_ROLE" \
    --description "FinTrack EC2 instance: pull images from ECR" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$EC2_ROLE" \
    --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
fi
if ! aws iam get-instance-profile --instance-profile-name "$EC2_ROLE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$EC2_ROLE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$EC2_ROLE" --role-name "$EC2_ROLE"
  # A brand-new instance profile is not usable by RunInstances for a few seconds.
  sleep 10
fi

# --- Key pair -------------------------------------------------------------------
mkdir -p "$KEY_DIR"
KEY_FILE="${KEY_DIR}/${KEY_NAME}.pem"
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  echo "    Key pair ${KEY_NAME} exists"
  [ -f "$KEY_FILE" ] || echo "    WARNING: ${KEY_FILE} is missing locally"
else
  echo "==> Creating key pair ${KEY_NAME} -> ${KEY_FILE}"
  aws_txt ec2 create-key-pair --key-name "$KEY_NAME" --key-type ed25519 \
    --query KeyMaterial > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi

# --- Security group -------------------------------------------------------------
VPC_ID=$(aws_txt ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId')
SG_ID=$(aws_txt ec2 describe-security-groups \
  --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId')
if [ "$SG_ID" = "None" ]; then
  echo "==> Creating security group ${SG_NAME}"
  SG_ID=$(aws_txt ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC_ID" \
    --description "FinTrack: HTTP from anywhere, SSH key-only" --query GroupId)
  # 80: the application, through nginx.
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions 'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description="HTTP"}]' >/dev/null
  # 22: GitHub-hosted runners have no fixed address range, so SSH is open but
  # password login is disabled on Ubuntu AMIs - only the deploy key works.
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions 'IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0,Description="SSH (key only) for CD"}]' >/dev/null
  # 5432 is deliberately absent: postgres is never published by compose.
else
  echo "    Security group ${SG_NAME} exists (${SG_ID})"
fi

# --- Instance -------------------------------------------------------------------
INSTANCE_ID=$(aws_txt ec2 describe-instances \
  --filters Name=tag:Name,Values="${PROJECT}-prod" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].InstanceId')
if [ "$INSTANCE_ID" = "None" ]; then
  AMI_ID=$(aws_txt ssm get-parameter \
    --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query Parameter.Value)
  echo "==> Launching ${INSTANCE_TYPE} from ${AMI_ID}"
  INSTANCE_ID=$(aws_txt ec2 run-instances \
    --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" --security-group-ids "$SG_ID" \
    --iam-instance-profile Name="$EC2_ROLE" \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3}' \
    --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2 \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${PROJECT}-prod},{Key=Project,Value=${PROJECT}}]" \
    --query 'Instances[0].InstanceId')
else
  echo "    Instance ${INSTANCE_ID} exists"
  aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null || true
fi
echo "==> Waiting for ${INSTANCE_ID} to be running"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

# --- Elastic IP -----------------------------------------------------------------
EIP_ALLOC=$(aws_txt ec2 describe-addresses --filters Name=tag:Name,Values="${PROJECT}-prod" \
  --query 'Addresses[0].AllocationId')
if [ "$EIP_ALLOC" = "None" ]; then
  echo "==> Allocating an Elastic IP"
  EIP_ALLOC=$(aws_txt ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${PROJECT}-prod}]" \
    --query AllocationId)
fi
aws ec2 associate-address --allocation-id "$EIP_ALLOC" --instance-id "$INSTANCE_ID" >/dev/null
PUBLIC_IP=$(aws_txt ec2 describe-addresses --allocation-ids "$EIP_ALLOC" --query 'Addresses[0].PublicIp')

cat <<EOF

============================================================
 AWS provisioning complete

 Instance      ${INSTANCE_ID} (${INSTANCE_TYPE})
 Public IP     ${PUBLIC_IP}
 Registry      ${REGISTRY}
 SSH           ssh -i ${KEY_FILE} ubuntu@${PUBLIC_IP}

 GitHub Secrets (Settings -> Secrets and variables -> Actions):
   AWS_ROLE_ARN       ${CI_ROLE_ARN}
   EC2_SSH_KEY        contents of ${KEY_FILE}
   POSTGRES_USER      fintrack_app
   POSTGRES_PASSWORD  <generate: openssl rand -hex 16>
   POSTGRES_DB        fintrack_prod
   JWT_SECRET         <generate: openssl rand -hex 32>

 GitHub Variables (same page, Variables tab):
   EC2_HOST           ${PUBLIC_IP}
   EC2_USER           ubuntu

 Next: bootstrap the instance
   scp -i ${KEY_FILE} scripts/ec2-setup.sh ubuntu@${PUBLIC_IP}:~
   ssh -i ${KEY_FILE} ubuntu@${PUBLIC_IP} 'bash ~/ec2-setup.sh'
============================================================
EOF
