resource "cloudflare_r2_bucket" "slides_eu" {
  count        = var.eu_bucket ? 1 : 0
  account_id   = var.cloudflare_account_id
  name         = "parfocal-${var.name}-eu"
  jurisdiction = "eu"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket_cors" "uploads_eu" {
  count        = var.eu_bucket ? 1 : 0
  account_id   = var.cloudflare_account_id
  bucket_name  = cloudflare_r2_bucket.slides_eu[0].name
  jurisdiction = "eu"

  rules = [{
    id = "browser-part-uploads"
    allowed = {
      origins = concat([var.origin], var.extra_upload_origins)
      methods = ["PUT"]
      headers = ["Content-Type"]
    }
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }]
}

resource "cloudflare_r2_bucket_lifecycle" "uploads_eu" {
  count        = var.eu_bucket ? 1 : 0
  account_id   = var.cloudflare_account_id
  bucket_name  = cloudflare_r2_bucket.slides_eu[0].name
  jurisdiction = "eu"

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
    }, {
    id      = "tier-old-tenant-objects"
    enabled = true
    conditions = {
      prefix = "t/"
    }
    storage_class_transitions = [{
      condition = {
        type    = "Age"
        max_age = var.tier_after_days * 86400
      }
      storage_class = "InfrequentAccess"
    }]
  }]
}

resource "cloudflare_r2_bucket_lock" "recovery_eu" {
  count        = var.eu_bucket ? 1 : 0
  account_id   = var.cloudflare_account_id
  bucket_name  = cloudflare_r2_bucket.slides_eu[0].name
  jurisdiction = "eu"

  rules = [{
    id      = "keep-tenant-objects"
    enabled = true
    prefix  = "t/"
    condition = {
      type            = "Age"
      max_age_seconds = var.locked_days * 86400
    }
  }]
}
