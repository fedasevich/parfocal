output "app_origin" {
  value = module.environment.app_origin
}

output "slide_bucket" {
  value = module.environment.slide_bucket
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
