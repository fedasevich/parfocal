terraform {
  required_version = ">= 1.10"

  required_providers {
    zitadel = {
      source  = "zitadel/zitadel"
      version = "~> 3.8"
    }
  }
}

variable "zitadel_port" {
  type    = string
  default = "8089"
}

variable "zitadel_access_token" {
  type      = string
  sensitive = true
}

variable "test_user_password" {
  type      = string
  sensitive = true
}

provider "zitadel" {
  domain       = "localhost"
  port         = var.zitadel_port
  insecure     = true
  access_token = var.zitadel_access_token
}

resource "zitadel_org" "scratch" {
  name = "Parfocal Scratch"
}

module "identity" {
  source                  = "../modules/zitadel-identity"
  org_id                  = zitadel_org.scratch.id
  default_redirect_origin = "https://staging.parfocal.eu"
  test_user_password      = var.test_user_password

  environments = {
    dev = {
      origin   = "http://localhost:5173"
      dev_mode = true
    }
    preview = {
      origin   = "https://parfocal-edge-pr-*.example.workers.dev"
      dev_mode = true
    }
    staging = {
      origin   = "https://staging.parfocal.eu"
      dev_mode = false
    }
  }

  test_users = {
    e2e = {
      email      = "e2e-pathologist@parfocal.eu"
      first_name = "E2E"
      last_name  = "Pathologist"
    }
  }
}

output "org_id" {
  value = zitadel_org.scratch.id
}

output "project_id" {
  value = module.identity.project_id
}

output "client_ids" {
  value     = module.identity.client_ids
  sensitive = true
}

output "client_secrets" {
  value     = module.identity.client_secrets
  sensitive = true
}

output "test_user_ids" {
  value = module.identity.test_user_ids
}
