# Terraform bootstrap (remote state)

Creates the remote state backend used by the `app` module:
- S3 bucket for `tfstate` (versioning + AES256 encryption + public access blocked)
- DynamoDB table for state locking

Run (example):
```bash
cd infra/terraform/bootstrap
terraform init
terraform apply
```

Then use the outputs (`tf_state_bucket_name`, `tf_lock_table_name`) when running `terraform init` in `../app`.

