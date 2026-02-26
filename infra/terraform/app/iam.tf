data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name}-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn  = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "app_task" {
  name               = "${local.name}-app-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

data "aws_iam_policy_document" "app_s3" {
  statement {
    sid     = "BucketList"
    effect  = "Allow"
    actions = ["s3:ListBucket"]
    resources = [aws_s3_bucket.files.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["root/*", "departments/*", "users/*"]
    }
  }

  statement {
    sid     = "BucketLocation"
    effect  = "Allow"
    actions = ["s3:GetBucketLocation"]
    resources = [aws_s3_bucket.files.arn]
  }

  statement {
    sid    = "ObjectRW"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts"
    ]
    resources = [
      "${aws_s3_bucket.files.arn}/root/*",
      "${aws_s3_bucket.files.arn}/departments/*",
      "${aws_s3_bucket.files.arn}/users/*"
    ]
  }
}

resource "aws_iam_policy" "app_s3" {
  name   = "${local.name}-s3-policy"
  policy = data.aws_iam_policy_document.app_s3.json
}

resource "aws_iam_role_policy_attachment" "app_s3" {
  role      = aws_iam_role.app_task.name
  policy_arn = aws_iam_policy.app_s3.arn
}
