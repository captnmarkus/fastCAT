resource "aws_db_subnet_group" "postgres" {
  name       = "${local.name}-postgres-subnets"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "postgres" {
  identifier             = "${local.name}-postgres"
  engine                 = "postgres"
  engine_version         = "15.8"
  instance_class         = var.db_instance_class
  allocated_storage      = var.db_allocated_storage
  db_name                = var.db_name
  username               = var.db_username
  password               = var.db_password
  port                   = 5432
  storage_encrypted      = true
  multi_az               = var.environment == "prod"
  publicly_accessible    = false
  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  skip_final_snapshot = var.db_skip_final_snapshot
  final_snapshot_identifier = var.db_skip_final_snapshot ? null : "${local.name}-final-${replace(timestamp(), \":\", \"-\")}"

  tags = {
    Name        = "${local.name}-postgres"
    Project     = var.project_name
    Environment = var.environment
  }
}

