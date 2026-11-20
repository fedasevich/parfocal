output "app_origin" {
  value = var.origin
}

output "slide_bucket" {
  value = one(cloudflare_r2_bucket.slides[*].name)
}

output "slide_bucket_eu" {
  value = one(cloudflare_r2_bucket.slides_eu[*].name)
}

output "zitadel_client_id" {
  value     = zitadel_application_oidc.api.client_id
  sensitive = true
}

output "zitadel_client_secret" {
  value     = zitadel_application_oidc.api.client_secret
  sensitive = true
}
