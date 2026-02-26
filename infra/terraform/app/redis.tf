resource "aws_elasticache_subnet_group" "redis" {
  count      = var.enable_elasticache_redis ? 1 : 0
  name       = "${local.name}-redis-subnets"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_cluster" "redis" {
  count                = var.enable_elasticache_redis ? 1 : 0
  cluster_id           = "${local.name}-redis"
  engine               = "redis"
  node_type            = "cache.t4g.micro"
  num_cache_nodes      = 1
  port                 = 6379
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.redis[0].name
  security_group_ids   = [aws_security_group.redis[0].id]

  tags = {
    Name        = "${local.name}-redis"
    Project     = var.project_name
    Environment = var.environment
  }
}

