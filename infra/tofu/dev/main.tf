data "zitadel_projects" "parfocal" {
  org_id      = var.zitadel_org_id
  name        = "Parfocal"
  name_method = "TEXT_QUERY_METHOD_EQUALS"
}

module "environment" {
  source = "../modules/environment"

  name                  = "dev"
  origin                = "http://localhost:5173"
  extra_upload_origins  = ["https://app.parfocal.eu"]
  dev_mode              = true
  cloudflare_account_id = var.cloudflare_account_id
  zitadel_org_id        = var.zitadel_org_id
  zitadel_project_id    = one(data.zitadel_projects.parfocal.project_ids)
}
