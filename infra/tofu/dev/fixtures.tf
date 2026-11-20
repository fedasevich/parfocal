data "cloudflare_account_api_token_permission_groups_list" "r2_object_read" {
  account_id = var.cloudflare_account_id
  name       = "Workers R2 Storage Bucket Item Read"
}

resource "cloudflare_account_token" "fixtures_reader_eu" {
  account_id = var.cloudflare_account_id
  name       = "parfocal-fixtures-read-eu"

  policies = [{
    effect            = "allow"
    permission_groups = [{ id = one(data.cloudflare_account_api_token_permission_groups_list.r2_object_read.result).id }]
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${var.cloudflare_account_id}_eu_${module.environment.slide_bucket_eu}" = "*"
    })
  }]
}
