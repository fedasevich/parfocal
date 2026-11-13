data "zitadel_projects" "parfocal" {
  org_id      = var.zitadel_org_id
  name        = "Parfocal"
  name_method = "TEXT_QUERY_METHOD_EQUALS"
}

module "environment" {
  source = "../modules/environment"

  name                  = "staging"
  origin                = "https://staging.parfocal.eu"
  dev_mode              = false
  cloudflare_account_id = var.cloudflare_account_id
  zitadel_org_id        = var.zitadel_org_id
  zitadel_project_id    = one(data.zitadel_projects.parfocal.project_ids)
}
