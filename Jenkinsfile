pipeline {
  agent any

  parameters {
    choice(name: 'ENV', choices: ['dev', 'prod'], description: 'Target environment')
    string(name: 'AWS_REGION', defaultValue: 'us-east-1', description: 'AWS region')
    booleanParam(name: 'ENABLE_ELASTICACHE_REDIS', defaultValue: false, description: 'Provision ElastiCache instead of sidecar Redis')
  }

  environment {
    AWS_REGION = "${params.AWS_REGION}"
    TF_IN_AUTOMATION = "true"
    TF_INPUT = "0"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Bootstrap Terraform State') {
      steps {
        dir('infra/terraform/bootstrap') {
          sh 'terraform init -input=false'
          sh "terraform apply -auto-approve -input=false -var aws_region=${AWS_REGION} -var environment=${params.ENV} -var project_name=fastcat"
        }
      }
    }

    stage('Init Terraform App') {
      steps {
        script {
          def tfStateBucket = sh(script: 'cd infra/terraform/bootstrap && terraform output -raw tf_state_bucket_name', returnStdout: true).trim()
          def tfLockTable = sh(script: 'cd infra/terraform/bootstrap && terraform output -raw tf_lock_table_name', returnStdout: true).trim()

          env.TF_STATE_BUCKET = tfStateBucket
          env.TF_LOCK_TABLE = tfLockTable

          def tfKey = "fastcat/${params.ENV}/app.tfstate"
          env.TF_STATE_KEY = tfKey
        }

        dir('infra/terraform/app') {
          sh """
            terraform init -input=false \
              -backend-config=\"bucket=${env.TF_STATE_BUCKET}\" \
              -backend-config=\"dynamodb_table=${env.TF_LOCK_TABLE}\" \
              -backend-config=\"key=${env.TF_STATE_KEY}\" \
              -backend-config=\"region=${AWS_REGION}\"
          """
        }
      }
    }

    stage('Ensure ECR Repos') {
      steps {
        withCredentials([
          string(credentialsId: 'fastcat-jwt-secret', variable: 'TF_VAR_jwt_secret'),
          string(credentialsId: 'fastcat-db-password', variable: 'TF_VAR_db_password'),
          string(credentialsId: 'fastcat-admin-password', variable: 'TF_VAR_default_admin_password')
        ]) {
          dir('infra/terraform/app') {
            sh """
              terraform apply -auto-approve -input=false \
                -target=aws_ecr_repository.web \
                -target=aws_ecr_repository.cat_api \
                -target=aws_ecr_repository.tm_proxy \
                -target=aws_ecr_repository.llm_gateway \
                -var aws_region=${AWS_REGION} \
                -var environment=${params.ENV} \
                -var enable_elasticache_redis=${params.ENABLE_ELASTICACHE_REDIS}
            """
          }
        }
      }
    }

    stage('Build & Push Images') {
      steps {
        script {
          env.GIT_SHA = sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()
          env.AWS_ACCOUNT_ID = sh(script: "aws sts get-caller-identity --query Account --output text --region ${AWS_REGION}", returnStdout: true).trim()
          env.ECR_REGISTRY = "${env.AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
        }

        sh "aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${env.ECR_REGISTRY}"

        script {
          env.IMAGE_WEB = "${env.ECR_REGISTRY}/fastcat-${params.ENV}-web"
          env.IMAGE_CAT_API = "${env.ECR_REGISTRY}/fastcat-${params.ENV}-cat-api"
          env.IMAGE_TM_PROXY = "${env.ECR_REGISTRY}/fastcat-${params.ENV}-tm-proxy"
          env.IMAGE_LLM_GATEWAY = "${env.ECR_REGISTRY}/fastcat-${params.ENV}-llm-gateway"
        }

        sh "docker build -t ${env.IMAGE_WEB}:${env.GIT_SHA} -t ${env.IMAGE_WEB}:latest -f web/Dockerfile ."
        sh "docker build -t ${env.IMAGE_CAT_API}:${env.GIT_SHA} -t ${env.IMAGE_CAT_API}:latest -f cat-api/Dockerfile cat-api"
        sh "docker build -t ${env.IMAGE_TM_PROXY}:${env.GIT_SHA} -t ${env.IMAGE_TM_PROXY}:latest -f tm-proxy/Dockerfile tm-proxy"
        sh "docker build -t ${env.IMAGE_LLM_GATEWAY}:${env.GIT_SHA} -t ${env.IMAGE_LLM_GATEWAY}:latest -f llm-gateway/Dockerfile llm-gateway"

        sh "docker push ${env.IMAGE_WEB}:${env.GIT_SHA}"
        sh "docker push ${env.IMAGE_WEB}:latest"
        sh "docker push ${env.IMAGE_CAT_API}:${env.GIT_SHA}"
        sh "docker push ${env.IMAGE_CAT_API}:latest"
        sh "docker push ${env.IMAGE_TM_PROXY}:${env.GIT_SHA}"
        sh "docker push ${env.IMAGE_TM_PROXY}:latest"
        sh "docker push ${env.IMAGE_LLM_GATEWAY}:${env.GIT_SHA}"
        sh "docker push ${env.IMAGE_LLM_GATEWAY}:latest"
      }
    }

    stage('Deploy (Terraform Apply)') {
      steps {
        withCredentials([
          string(credentialsId: 'fastcat-jwt-secret', variable: 'TF_VAR_jwt_secret'),
          string(credentialsId: 'fastcat-db-password', variable: 'TF_VAR_db_password'),
          string(credentialsId: 'fastcat-admin-password', variable: 'TF_VAR_default_admin_password')
        ]) {
          dir('infra/terraform/app') {
            sh """
              terraform apply -auto-approve -input=false \
                -var aws_region=${AWS_REGION} \
                -var environment=${params.ENV} \
                -var enable_elasticache_redis=${params.ENABLE_ELASTICACHE_REDIS} \
                -var web_image=${env.IMAGE_WEB}:${env.GIT_SHA} \
                -var cat_api_image=${env.IMAGE_CAT_API}:${env.GIT_SHA} \
                -var tm_proxy_image=${env.IMAGE_TM_PROXY}:${env.GIT_SHA} \
                -var llm_gateway_image=${env.IMAGE_LLM_GATEWAY}:${env.GIT_SHA}
            """
          }
        }
      }
    }
  }
}

