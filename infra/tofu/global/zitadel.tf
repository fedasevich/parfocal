resource "zitadel_project" "parfocal" {
  org_id                 = var.zitadel_org_id
  name                   = "Parfocal"
  project_role_assertion = true
}
