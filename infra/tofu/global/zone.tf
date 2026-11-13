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
