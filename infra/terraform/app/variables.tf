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

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC."
  default     = "10.42.0.0/16"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "List of public subnet CIDRs (2 recommended)."
  default     = ["10.42.0.0/24", "10.42.1.0/24"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "List of private subnet CIDRs (2 recommended)."
  default     = ["10.42.10.0/24", "10.42.11.0/24"]
}

variable "desired_count" {
  type        = number
  description = "Desired ECS service count."
  default     = 1
}

variable "task_cpu" {
  type        = number
  description = "Fargate task CPU units."
  default     = 1024
}

variable "task_memory" {
  type        = number
  description = "Fargate task memory (MiB)."
  default     = 2048
}

variable "jwt_secret" {
  type        = string
  description = "JWT secret shared by tm-proxy and cat-api."
  sensitive   = true
}

variable "default_admin_username" {
  type        = string
  description = "Deprecated: initial admin is created via Global Setup; this value is ignored."
  default     = "admin"
}

variable "default_admin_password" {
  type        = string
  description = "Deprecated: initial admin is created via Global Setup; this value is ignored."
  sensitive   = true
  default     = ""
}

variable "db_name" {
  type        = string
  description = "Postgres database name."
  default     = "fastcat"
}

variable "db_username" {
  type        = string
  description = "Postgres master username."
  default     = "fastcat"
}

variable "db_password" {
  type        = string
  description = "Postgres master password."
  sensitive   = true
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance class."
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type        = number
  description = "RDS allocated storage (GiB)."
  default     = 20
}

variable "db_skip_final_snapshot" {
  type        = bool
  description = "If true, RDS will be destroyed without a final snapshot (recommended for dev only)."
  default     = true
}

variable "enable_elasticache_redis" {
  type        = bool
  description = "If true, provision ElastiCache Redis and point the app at it; otherwise run Redis as an ECS sidecar."
  default     = false
}

variable "cors_allowed_origins" {
  type        = list(string)
  description = "Allowed Origins for S3 bucket CORS (needed for browser presigned PUT/GET)."
  default     = ["*"]
}

variable "s3_bucket_name" {
  type        = string
  description = "Optional explicit S3 bucket name for FastCAT file storage. If empty, a name is derived from project/env/account."
  default     = ""
}

variable "web_image" {
  type        = string
  description = "Full image URI for the web container. If empty, defaults to the created ECR repo with :latest."
  default     = ""
}

variable "cat_api_image" {
  type        = string
  description = "Full image URI for the cat-api container. If empty, defaults to the created ECR repo with :latest."
  default     = ""
}

variable "tm_proxy_image" {
  type        = string
  description = "Full image URI for the tm-proxy container. If empty, defaults to the created ECR repo with :latest."
  default     = ""
}

variable "llm_gateway_image" {
  type        = string
  description = "Full image URI for the llm-gateway container. If empty, defaults to the created ECR repo with :latest."
  default     = ""
}

variable "t5memory_image" {
  type        = string
  description = "Image URI for translate5/t5memory (can be overridden to use a mirrored/ECR image)."
  default     = "translate5/t5memory:latest"
}

variable "redis_image" {
  type        = string
  description = "Redis image used when enable_elasticache_redis=false."
  default     = "redis:7-alpine"
}
