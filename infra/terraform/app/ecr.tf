resource "aws_ecr_repository" "web" {
  name                 = "${local.name}-web"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_repository" "cat_api" {
  name                 = "${local.name}-cat-api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_repository" "tm_proxy" {
  name                 = "${local.name}-tm-proxy"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_repository" "llm_gateway" {
  name                 = "${local.name}-llm-gateway"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}
