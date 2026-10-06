output "zone_id" {
  value = data.cloudflare_zone.main.zone_id
}

output "slide_buckets" {
  value = { for env, bucket in cloudflare_r2_bucket.slides : env => bucket.name }
}

output "zitadel_issuer" {
  value = "https://${var.zitadel_domain}"
}

output "zitadel_client_ids" {
  value     = { for env, app in zitadel_application_oidc.api : env => app.client_id }
  sensitive = true
}

output "zitadel_client_secrets" {
  value     = { for env, app in zitadel_application_oidc.api : env => app.client_secret }
  sensitive = true
}
