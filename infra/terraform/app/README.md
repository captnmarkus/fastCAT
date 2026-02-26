# Terraform app module (FastCAT on AWS)

Provisions AWS infrastructure to run the FastCAT stack on ECS Fargate, backed by:
- S3 bucket for file blobs (versioning + encryption + CORS for presigned URLs)
- RDS Postgres
- Redis (either sidecar container or optional ElastiCache)
- ECR repos for `web`, `cat-api`, `tm-proxy`, `llm-gateway`
- ALB + ECS service (single task definition with multiple containers)

## Usage

1) Bootstrap remote state (once per account/env):
```bash
cd infra/terraform/bootstrap
terraform init
terraform apply
```

2) Deploy the app:
```bash
cd infra/terraform/app
terraform init \
  -backend-config="bucket=<tf_state_bucket_name>" \
  -backend-config="dynamodb_table=<tf_lock_table_name>" \
  -backend-config="key=fastcat/<env>/app.tfstate" \
  -backend-config="region=<aws_region>"

terraform apply \
  -var="aws_region=<aws_region>" \
  -var="environment=<env>" \
  -var="jwt_secret=<jwt_secret>" \
  -var="db_password=<db_password>"
```

Pass `web_image`, `cat_api_image`, `tm_proxy_image`, `llm_gateway_image` to roll the ECS task to new container images.

