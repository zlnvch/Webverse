#!/bin/bash

# Deploy to AWS
# Usage: ./deploy-aws.sh --region <region> (--push-ecr | --redeploy-ecs | --export-env)

set -e

# Parse arguments
REGION=""
PUSH_ECR=false
REDEPLOY_ECS=false
EXPORT_ENV=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --region)
      REGION="$2"
      shift 2
      ;;
    --push-ecr)
      PUSH_ECR=true
      shift
      ;;
    --redeploy-ecs)
      REDEPLOY_ECS=true
      shift
      ;;
    --export-env)
      EXPORT_ENV=true
      shift
      ;;
    *)
      echo "Error: Unknown argument $1"
      echo "Usage: ./deploy-aws.sh --region <region> (--push-ecr | --redeploy-ecs | --export-env)"
      echo "  At least one of --push-ecr, --redeploy-ecs, or --export-env must be specified"
      exit 1
      ;;
  esac
done

# Check if region is provided
if [[ -z "$REGION" ]]; then
  echo "Error: --region is required"
  echo "Usage: ./deploy-aws.sh --region <region> (--push-ecr | --redeploy-ecs | --export-env)"
  exit 1
fi

# Check if at least one action is specified
if [[ "$PUSH_ECR" == false && "$REDEPLOY_ECS" == false && "$EXPORT_ENV" == false ]]; then
  echo "Error: At least one of --push-ecr, --redeploy-ecs, or --export-env must be specified"
  exit 1
fi

# Get account ID from AWS context
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Configuration
REPO_NAME="webverse"
TAG="latest"
CLUSTER_NAME="webverse-ecs-fargate-cluster"
SERVICE_NAME="webverse-ecs-fargate-service"

# Export environment variables to SSM
if [[ "$EXPORT_ENV" == true ]]; then
  echo ""
  echo "📤 Exporting environment variables to SSM Parameter Store..."
  echo "Region: $REGION"
  echo "Account: $ACCOUNT_ID"
  echo ""

  # Read .env.prod
  if [[ ! -f ".env.prod" ]]; then
    echo "Error: .env.prod not found"
    exit 1
  fi

  # Source the .env.prod file
  set -a
  source .env.prod
  set +a

  # Validate DEV_MODE
  if [[ "$DEV_MODE" != "false" ]]; then
    echo "Error: DEV_MODE must be 'false' for production deployment"
    echo "Current value: $DEV_MODE"
    exit 1
  fi

  # Check for dev-only parameters
  DEV_ONLY_PARAMS=("HOST_PORT" "DYNAMODB_ENDPOINT" "SQS_ENDPOINT")
  for param in "${DEV_ONLY_PARAMS[@]}"; do
    if [[ -n "${!param}" ]]; then
      echo "Error: Parameter '$param' is for development only and should not be set in production"
      exit 1
    fi
  done

  # Check for REDIS_ENDPOINT (auto-set by CloudFormation)
  if [[ -n "$REDIS_ENDPOINT" ]]; then
    echo "Error: REDIS_ENDPOINT is automatically set by CloudFormation and should not be provided"
    exit 1
  fi

  # Required parameters
  REQUIRED_PARAMS=("EXTENSION_ID" "GOOGLE_CLIENT_ID" "GOOGLE_CLIENT_SECRET" "GITHUB_CLIENT_ID" "GITHUB_CLIENT_SECRET" "JWT_SECRET")
  for param in "${REQUIRED_PARAMS[@]}"; do
    if [[ -z "${!param}" ]]; then
      echo "Error: Required parameter '$param' is missing or empty in .env.prod"
      exit 1
    fi
  done

  # Export parameters to SSM
  echo "Writing parameters to SSM..."

  # NOTE: We add a space before parameter names (e.g., " /webverse/...")
  # to prevent Git Bash on Windows from expanding Unix-style paths.
  # See: https://stackoverflow.com/questions/52921242/aws-ssm-put-parameter-validation-exception

  # DEV_MODE
  echo "  - DEV_MODE (String)"
  aws ssm put-parameter \
    --name " /webverse/DEV_MODE" \
    --value "$DEV_MODE" \
    --type "String" \
    --overwrite \
    --region $REGION >/dev/null

  # EXTENSION_ID
  echo "  - EXTENSION_ID (String)"
  aws ssm put-parameter \
    --name " /webverse/EXTENSION_ID" \
    --value "$EXTENSION_ID" \
    --type "String" \
    --overwrite \
    --region $REGION >/dev/null

  # GOOGLE_CLIENT_ID
  echo "  - GOOGLE_CLIENT_ID (String)"
  aws ssm put-parameter \
    --name " /webverse/GOOGLE_CLIENT_ID" \
    --value "$GOOGLE_CLIENT_ID" \
    --type "String" \
    --overwrite \
    --region $REGION >/dev/null

  # GOOGLE_CLIENT_SECRET (SecureString)
  echo "  - GOOGLE_CLIENT_SECRET (SecureString)"
  aws ssm put-parameter \
    --name " /webverse/GOOGLE_CLIENT_SECRET" \
    --value "$GOOGLE_CLIENT_SECRET" \
    --type "SecureString" \
    --overwrite \
    --region $REGION >/dev/null

  # GITHUB_CLIENT_ID
  echo "  - GITHUB_CLIENT_ID (String)"
  aws ssm put-parameter \
    --name " /webverse/GITHUB_CLIENT_ID" \
    --value "$GITHUB_CLIENT_ID" \
    --type "String" \
    --overwrite \
    --region $REGION >/dev/null

  # GITHUB_CLIENT_SECRET (SecureString)
  echo "  - GITHUB_CLIENT_SECRET (SecureString)"
  aws ssm put-parameter \
    --name " /webverse/GITHUB_CLIENT_SECRET" \
    --value "$GITHUB_CLIENT_SECRET" \
    --type "SecureString" \
    --overwrite \
    --region $REGION >/dev/null

  # JWT_SECRET (SecureString)
  echo "  - JWT_SECRET (SecureString)"
  aws ssm put-parameter \
    --name " /webverse/JWT_SECRET" \
    --value "$JWT_SECRET" \
    --type "SecureString" \
    --overwrite \
    --region $REGION >/dev/null

  echo ""
  echo "✅ Environment variables exported to SSM successfully!"
fi

# Push to ECR
if [[ "$PUSH_ECR" == true ]]; then
  echo ""
  echo "🚀 Pushing to ECR..."
  echo "Region: $REGION"
  echo "Account: $ACCOUNT_ID"
  echo "Repository: $REPO_NAME:$TAG"
  echo ""

  # Build Docker image
  echo "📦 Building Docker image..."
  cd app
  docker build -f Dockerfile.prod -t $REPO_NAME:$TAG .
  cd ..

  # Login to ECR
  echo "🔐 Logging in to ECR..."
  aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

  # Create repository if it doesn't exist
  echo "📋 Ensuring ECR repository exists..."
  aws ecr describe-repositories --repository-names $REPO_NAME --region $REGION >/dev/null 2>&1 || \
    aws ecr create-repository --repository-name $REPO_NAME --region $REGION

  # Tag for ECR
  ECR_TAG="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_NAME:$TAG"
  docker tag $REPO_NAME:$TAG $ECR_TAG

  # Push to ECR
  echo "⬆️  Pushing to ECR..."
  docker push $ECR_TAG

  echo ""
  echo "✅ ECR push complete!"
  echo "Image: $ECR_TAG"
fi

# Redeploy ECS
if [[ "$REDEPLOY_ECS" == true ]]; then
  echo ""
  echo "🔄 Redeploying ECS service..."
  echo "Cluster: $CLUSTER_NAME"
  echo "Service: $SERVICE_NAME"
  echo ""

  # Check if service exists
  if aws ecs describe-services \
    --cluster $CLUSTER_NAME \
    --services $SERVICE_NAME \
    --region $REGION >/dev/null 2>&1; then

    echo "📦 Found service $SERVICE_NAME, forcing new deployment..."

    # Force new deployment
    aws ecs update-service \
      --cluster $CLUSTER_NAME \
      --service $SERVICE_NAME \
      --force-new-deployment \
      --region $REGION >/dev/null

    echo "✅ ECS service new deployment triggered!"
  else
    echo "ℹ️  Service $SERVICE_NAME not found in cluster $CLUSTER_NAME"
    echo "   Please ensure the CloudFormation stack is deployed first"
    exit 1
  fi
fi

echo ""
echo "🎉 All operations completed successfully!"
