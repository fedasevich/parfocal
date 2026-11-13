provider "cloudflare" {}

provider "zitadel" {
  domain           = var.zitadel_domain
  jwt_profile_file = pathexpand(var.zitadel_key_file)
}
