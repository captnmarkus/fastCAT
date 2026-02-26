resource "aws_security_group" "alb" {
  name        = "${local.name}-alb-sg"
  description = "ALB ingress"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${local.name}-alb-sg"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_security_group" "app" {
  name        = "${local.name}-app-sg"
  description = "ECS task ingress"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from ALB"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${local.name}-app-sg"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds-sg"
  description = "RDS ingress from ECS tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from app"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${local.name}-rds-sg"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_security_group" "redis" {
  count       = var.enable_elasticache_redis ? 1 : 0
  name        = "${local.name}-redis-sg"
  description = "Redis ingress from ECS tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from app"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${local.name}-redis-sg"
    Project     = var.project_name
    Environment = var.environment
  }
}

