terraform {
  required_version = ">= 1.11"

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

variable "app_origin" {
  type    = string
  default = "http://localhost:5173"
}

provider "zitadel" {
  domain       = "localhost"
  port         = var.zitadel_port
  insecure     = true
  access_token = var.zitadel_access_token
}

resource "zitadel_org" "local" {
  name = "Parfocal Local"
}

module "identity" {
  source                  = "../modules/zitadel-identity"
  org_id                  = zitadel_org.local.id
  default_redirect_origin = var.app_origin
  test_user_password      = var.test_user_password

  environments = {
    local = {
      origin   = var.app_origin
      dev_mode = true
    }
  }

  test_users = {
    e2e = {
      email      = "e2e-pathologist@parfocal.test"
      first_name = "E2E"
      last_name  = "Pathologist"
    }
  }
}

output "org_id" {
  value = zitadel_org.local.id
}

output "client_id" {
  value     = module.identity.client_ids["local"]
  sensitive = true
}

output "client_secret" {
  value     = module.identity.client_secrets["local"]
  sensitive = true
}
