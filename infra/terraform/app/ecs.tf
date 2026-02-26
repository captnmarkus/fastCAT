resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "app" {
  name = "${local.name}-cluster"
}

locals {
  web_env = [
    { name = "CAT_API_UPSTREAM", value = "http://127.0.0.1:4000" },
    { name = "TM_PROXY_UPSTREAM", value = "http://127.0.0.1:3001" },
    { name = "LLM_GATEWAY_UPSTREAM", value = "http://127.0.0.1:5005" }
  ]

  cat_api_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "JWT_SECRET", value = var.jwt_secret },
    { name = "CAT_DB_URL", value = local.db_url },
    { name = "REDIS_URL", value = local.redis_url },
    { name = "TM_PROXY_URL", value = "http://127.0.0.1:3001" },
    { name = "LLM_GATEWAY_URL", value = "http://127.0.0.1:5005" },
    { name = "S3_BUCKET", value = aws_s3_bucket.files.bucket },
    { name = "S3_REGION", value = var.aws_region },
    { name = "S3_ENDPOINT_URL", value = "" },
    { name = "S3_PUBLIC_ENDPOINT_URL", value = "" },
    { name = "S3_FORCE_PATH_STYLE", value = "false" },
    { name = "PGSSLMODE", value = "require" }
  ]

  tm_proxy_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "JWT_SECRET", value = var.jwt_secret },
    { name = "TM_DB_URL", value = local.db_url },
    { name = "T5MEMORY_BASE_URL", value = "http://127.0.0.1:4040/t5memory" },
    { name = "TM_DB_INIT_MAX_ATTEMPTS", value = "25" },
    { name = "TM_DB_INIT_RETRY_DELAY_MS", value = "1000" },
    { name = "PGSSLMODE", value = "require" }
  ]

  llm_gateway_env = [
    { name = "LOG_LEVEL", value = "info" },
    { name = "LLM_GATEWAY_PORT", value = "5005" },
    { name = "LLM_DB_URL", value = local.db_url },
    { name = "JWT_SECRET", value = var.jwt_secret },
    { name = "PGSSLMODE", value = "require" }
  ]

  log_config = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.app.name
      awslogs-region        = var.aws_region
      awslogs-stream-prefix = local.name
    }
  }

  redis_container = var.enable_elasticache_redis ? [] : [
    {
      name      = "redis"
      image     = var.redis_image
      essential = true
      portMappings = [
        { containerPort = 6379, hostPort = 6379, protocol = "tcp" }
      ]
      logConfiguration = local.log_config
    }
  ]

  container_definitions = concat(
    [
      {
        name      = "web"
        image     = local.image_web
        essential = true
        portMappings = [
          { containerPort = 80, hostPort = 80, protocol = "tcp" }
        ]
        environment      = local.web_env
        logConfiguration = local.log_config
        dependsOn = [
          { containerName = "cat-api", condition = "START" },
          { containerName = "tm-proxy", condition = "START" },
          { containerName = "llm-gateway", condition = "START" }
        ]
      },
      {
        name      = "cat-api"
        image     = local.image_cat_api
        essential = true
        portMappings = [
          { containerPort = 4000, hostPort = 4000, protocol = "tcp" }
        ]
        environment      = local.cat_api_env
        logConfiguration = local.log_config
        dependsOn = concat(
          [{ containerName = "tm-proxy", condition = "START" }],
          var.enable_elasticache_redis ? [] : [{ containerName = "redis", condition = "START" }]
        )
      },
      {
        name      = "tm-proxy"
        image     = local.image_tm_proxy
        essential = true
        portMappings = [
          { containerPort = 3001, hostPort = 3001, protocol = "tcp" }
        ]
        environment      = local.tm_proxy_env
        logConfiguration = local.log_config
        dependsOn = [
          { containerName = "t5memory", condition = "START" }
        ]
      },
      {
        name      = "llm-gateway"
        image     = local.image_llm_gateway
        essential = true
        portMappings = [
          { containerPort = 5005, hostPort = 5005, protocol = "tcp" }
        ]
        environment      = local.llm_gateway_env
        logConfiguration = local.log_config
      },
      {
        name      = "t5memory"
        image     = var.t5memory_image
        essential = true
        portMappings = [
          { containerPort = 4040, hostPort = 4040, protocol = "tcp" }
        ]
        logConfiguration = local.log_config
      }
    ],
    local.redis_container
  )
}

resource "aws_ecs_task_definition" "app" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.app_task.arn

  container_definitions = jsonencode(local.container_definitions)
}

resource "aws_ecs_service" "app" {
  name            = "${local.name}-svc"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 80
  }

  depends_on = [aws_lb_listener.http]
}
