terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.27"
    }
    zitadel = {
      source  = "zitadel/zitadel"
      version = "~> 3.8"
    }
  }
}
