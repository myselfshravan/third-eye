#!/usr/bin/env bash
# Provision third-eye on AWS from the terminal: S3 bucket, IAM role (SSM + S3),
# no-inbound security group, and (with LAUNCH=1) an EC2 instance with IMDSv2.
# Idempotent — safe to re-run. Requires an authenticated AWS CLI with rights to
# create S3/IAM/EC2 resources (AdministratorAccess, or scoped EC2+S3+IAM+SSM).
#
#   bash deploy/aws-provision.sh              # create infra only
#   LAUNCH=1 bash deploy/aws-provision.sh     # also launch the EC2 instance
#
# The instance uses an IAM role for S3 (no static keys) + SSM for management, so
# you never open an inbound port or distribute long-lived credentials.
set -euo pipefail

REGION="${REGION:-ap-south-1}"
NAME="${NAME:-third-eye}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.large}"   # t3.xlarge for more throughput; m7g.* = Graviton
VOLUME_GB="${VOLUME_GB:-30}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"     # repo root
USERDATA="$HERE/deploy/aws-ec2-userdata.sh"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${BUCKET:-${NAME}-captures-${ACCOUNT}}"
ROLE="${NAME}-ec2-role"; PROFILE="${NAME}-ec2-profile"; SG_NAME="${NAME}-sg"
echo "account=$ACCOUNT region=$REGION bucket=$BUCKET type=$INSTANCE_TYPE"

echo "── S3 bucket ──"
aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null || \
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "── IAM role + instance profile ──"
aws iam get-role --role-name "$ROLE" >/dev/null 2>&1 || \
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam put-role-policy --role-name "$ROLE" --policy-name "${NAME}-s3" --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:GetObject\"],\"Resource\":\"arn:aws:s3:::${BUCKET}/*\"}]}"
if ! aws iam get-instance-profile --instance-profile-name "$PROFILE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$PROFILE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE" --role-name "$ROLE"
  sleep 12  # IAM propagation
fi

echo "── security group (default VPC, no inbound) ──"
VPC="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
SG="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)"
[ "$SG" = "None" ] && SG="$(aws ec2 create-security-group --group-name "$SG_NAME" \
  --description "third-eye no-inbound (CF tunnel egress)" --vpc-id "$VPC" --query GroupId --output text)"
echo "vpc=$VPC sg=$SG"

if [ "${LAUNCH:-0}" != "1" ]; then
  echo "✓ infra ready. Re-run with LAUNCH=1 to start the EC2 instance."
  exit 0
fi

echo "── launch EC2 ──"
case "$INSTANCE_TYPE" in *g.*|*gd.*) PARCH=arm64;; *) PARCH=x86_64;; esac
AMI="$(aws ssm get-parameters --names "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-${PARCH}" \
  --query 'Parameters[0].Value' --output text)"
IID="$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
  --iam-instance-profile "Name=$PROFILE" --security-group-ids "$SG" \
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=2" \
  --block-device-mappings "DeviceName=/dev/xvda,Ebs={VolumeSize=$VOLUME_GB,VolumeType=gp3}" \
  --user-data "file://$USERDATA" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
  --query 'Instances[0].InstanceId' --output text)"
echo "launched $IID — waiting for running…"
aws ec2 wait instance-running --instance-ids "$IID"
echo "✓ INSTANCE_ID=$IID  (SSM will register in ~30-60s)"
echo "Next: configure /opt/third-eye/.env and 'docker compose -f docker-compose.prod.yml up -d' via SSM — see DEPLOY-AWS.md."
