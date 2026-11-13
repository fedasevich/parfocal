output "app_origin" {
  value = var.origin
}

output "slide_bucket" {
  value = cloudflare_r2_bucket.slides.name
}

output "zitadel_client_id" {
  value     = zitadel_application_oidc.api.client_id
  sensitive = true
}

output "zitadel_client_secret" {
  value     = zitadel_application_oidc.api.client_secret
  sensitive = true
}
