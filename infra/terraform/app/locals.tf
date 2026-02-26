data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = "${var.project_name}-${var.environment}"

  stateful_bucket_name = length(trim(var.s3_bucket_name)) > 0 ? var.s3_bucket_name : "${var.project_name}-${var.environment}-files-${data.aws_caller_identity.current.account_id}"

  azs = slice(data.aws_availability_zones.available.names, 0, min(length(data.aws_availability_zones.available.names), 2))

  image_web        = length(trim(var.web_image)) > 0 ? var.web_image : "${aws_ecr_repository.web.repository_url}:latest"
  image_cat_api    = length(trim(var.cat_api_image)) > 0 ? var.cat_api_image : "${aws_ecr_repository.cat_api.repository_url}:latest"
  image_tm_proxy   = length(trim(var.tm_proxy_image)) > 0 ? var.tm_proxy_image : "${aws_ecr_repository.tm_proxy.repository_url}:latest"
  image_llm_gateway = length(trim(var.llm_gateway_image)) > 0 ? var.llm_gateway_image : "${aws_ecr_repository.llm_gateway.repository_url}:latest"

  db_url = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:${aws_db_instance.postgres.port}/${var.db_name}"

  redis_url = var.enable_elasticache_redis ? "redis://${aws_elasticache_cluster.redis[0].cache_nodes[0].address}:${aws_elasticache_cluster.redis[0].cache_nodes[0].port}" : "redis://127.0.0.1:6379"
}
