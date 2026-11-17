data "cloudflare_account_api_token_permission_groups_list" "r2_object_write" {
  account_id = var.cloudflare_account_id
  name       = "Workers R2 Storage Bucket Item Write"
}

resource "cloudflare_account_token" "app_eu" {
  account_id = var.cloudflare_account_id
  name       = "parfocal-app-eu"

  policies = [{
    effect            = "allow"
    permission_groups = [{ id = one(data.cloudflare_account_api_token_permission_groups_list.r2_object_write.result).id }]
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${var.cloudflare_account_id}_eu_${module.environment.slide_bucket_eu}" = "*"
    })
  }]
}

output "app_eu_access_key_id" {
  value     = cloudflare_account_token.app_eu.id
  sensitive = true
}

output "app_eu_secret_access_key" {
  value     = sha256(cloudflare_account_token.app_eu.value)
  sensitive = true
}
