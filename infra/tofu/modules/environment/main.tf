resource "cloudflare_r2_bucket" "slides" {
  account_id = var.cloudflare_account_id
  name       = "parfocal-${var.name}"
  location   = "eeur"

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [location]
  }
}

resource "cloudflare_r2_bucket_cors" "uploads" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.slides.name

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

resource "cloudflare_r2_bucket_lifecycle" "uploads" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.slides.name

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

resource "zitadel_application_oidc" "api" {
  org_id                       = var.zitadel_org_id
  project_id                   = var.zitadel_project_id
  name                         = "parfocal-api-${var.name}"
  app_type                     = "OIDC_APP_TYPE_WEB"
  auth_method_type             = "OIDC_AUTH_METHOD_TYPE_BASIC"
  grant_types                  = ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"]
  response_types               = ["OIDC_RESPONSE_TYPE_CODE"]
  access_token_type            = "OIDC_TOKEN_TYPE_JWT"
  redirect_uris                = ["${var.origin}/api/auth/callback"]
  post_logout_redirect_uris    = ["${var.origin}/"]
  dev_mode                     = var.dev_mode
  id_token_userinfo_assertion  = true
  id_token_role_assertion      = false
  access_token_role_assertion  = false
  additional_origins           = []
  skip_native_app_success_page = false
}
