output "alb_dns_name" {
  value       = aws_lb.app.dns_name
  description = "Public ALB DNS name."
}

output "alb_url" {
  value       = "http://${aws_lb.app.dns_name}"
  description = "Convenience URL for the app (HTTP)."
}

output "s3_bucket_name" {
  value       = aws_s3_bucket.files.bucket
  description = "S3 bucket used for FastCAT file blobs."
}

output "rds_endpoint" {
  value       = aws_db_instance.postgres.address
  description = "RDS Postgres hostname."
}

output "rds_port" {
  value       = aws_db_instance.postgres.port
  description = "RDS Postgres port."
}

output "redis_endpoint" {
  value       = var.enable_elasticache_redis ? aws_elasticache_cluster.redis[0].cache_nodes[0].address : null
  description = "ElastiCache Redis endpoint (null when using sidecar Redis)."
}

output "ecr_web_repo" {
  value       = aws_ecr_repository.web.repository_url
  description = "ECR repo URL for web."
}

output "ecr_cat_api_repo" {
  value       = aws_ecr_repository.cat_api.repository_url
  description = "ECR repo URL for cat-api."
}

output "ecr_tm_proxy_repo" {
  value       = aws_ecr_repository.tm_proxy.repository_url
  description = "ECR repo URL for tm-proxy."
}

output "ecr_llm_gateway_repo" {
  value       = aws_ecr_repository.llm_gateway.repository_url
  description = "ECR repo URL for llm-gateway."
}

