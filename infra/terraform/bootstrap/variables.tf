variable "aws_region" {
  type        = string
  description = "AWS region to deploy into."
}

variable "project_name" {
  type        = string
  description = "Project name prefix used for resource naming."
  default     = "fastcat"
}

variable "environment" {
  type        = string
  description = "Environment name (e.g. dev, prod)."
  default     = "dev"
}

variable "state_bucket_name" {
  type        = string
  description = "Optional explicit S3 bucket name for Terraform state (must be globally unique). If empty, a name is derived from project/env/account."
  default     = ""
}

variable "lock_table_name" {
  type        = string
  description = "Optional explicit DynamoDB table name for state locking. If empty, a name is derived from project/env."
  default     = ""
}

