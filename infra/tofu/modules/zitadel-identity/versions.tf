terraform {
  required_version = ">= 1.10"

  required_providers {
    zitadel = {
      source  = "zitadel/zitadel"
      version = "~> 3.8"
    }
  }
}
