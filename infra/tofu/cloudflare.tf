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
