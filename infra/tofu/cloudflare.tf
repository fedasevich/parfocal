data "cloudflare_zone" "main" {
  filter = {
    name = var.domain
  }
}

locals {
  zone_settings = {
    always_use_https = "on"
    min_tls_version  = "1.2"
    tls_1_3          = "on"
    ssl              = "strict"
  }
}

resource "cloudflare_zone_setting" "main" {
  for_each   = local.zone_settings
  zone_id    = data.cloudflare_zone.main.zone_id
  setting_id = each.key
  value      = each.value
}

import {
  to = cloudflare_r2_bucket.slides["dev"]
  id = "${var.cloudflare_account_id}/parfocal-dev/default"
}

resource "cloudflare_r2_bucket" "slides" {
  for_each   = var.environments
  account_id = var.cloudflare_account_id
  name       = "parfocal-${each.key}"
  location   = "eeur"

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [location]
  }
}

resource "cloudflare_r2_bucket_cors" "uploads" {
  for_each    = var.environments
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.slides[each.key].name

  rules = [{
    id = "browser-part-uploads"
    allowed = {
      origins = [each.value.origin]
      methods = ["PUT"]
      headers = ["Content-Type"]
    }
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }]
}

resource "cloudflare_r2_bucket_lifecycle" "uploads" {
  for_each    = var.environments
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.slides[each.key].name

  rules = [{
    id      = "abort-incomplete-uploads"
    enabled = true
    conditions = {
      prefix = "t/"
    }
    abort_multipart_uploads_transition = {
      condition = {
        type    = "Age"
        max_age = 86400
      }
    }
  }]
}
