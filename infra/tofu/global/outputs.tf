output "zone_id" {
  value = data.cloudflare_zone.main.zone_id
}

output "zitadel_issuer" {
  value = "https://${var.zitadel_domain}"
}

output "zitadel_project_id" {
  value = zitadel_project.parfocal.id
}
