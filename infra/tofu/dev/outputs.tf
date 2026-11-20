output "app_origin" {
  value = module.environment.app_origin
}

output "slide_bucket_eu" {
  value = module.environment.slide_bucket_eu
}

output "fixtures_eu_access_key_id" {
  value     = cloudflare_account_token.fixtures_reader_eu.id
  sensitive = true
}

output "fixtures_eu_secret_access_key" {
  value     = sha256(cloudflare_account_token.fixtures_reader_eu.value)
  sensitive = true
}

output "zitadel_issuer" {
  value = "https://${var.zitadel_domain}"
}

output "zitadel_client_id" {
  value     = module.environment.zitadel_client_id
  sensitive = true
}

output "zitadel_client_secret" {
  value     = module.environment.zitadel_client_secret
  sensitive = true
}
