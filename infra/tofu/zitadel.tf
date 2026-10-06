resource "zitadel_project" "parfocal" {
  org_id                 = var.zitadel_org_id
  name                   = "Parfocal"
  project_role_assertion = true
}

resource "zitadel_application_oidc" "api" {
  for_each                     = var.environments
  org_id                       = var.zitadel_org_id
  project_id                   = zitadel_project.parfocal.id
  name                         = "parfocal-api-${each.key}"
  app_type                     = "OIDC_APP_TYPE_WEB"
  auth_method_type             = "OIDC_AUTH_METHOD_TYPE_BASIC"
  grant_types                  = ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"]
  response_types               = ["OIDC_RESPONSE_TYPE_CODE"]
  access_token_type            = "OIDC_TOKEN_TYPE_JWT"
  redirect_uris                = ["${each.value.origin}/api/auth/callback"]
  post_logout_redirect_uris    = ["${each.value.origin}/"]
  dev_mode                     = each.value.dev_mode
  id_token_userinfo_assertion  = true
  id_token_role_assertion      = false
  access_token_role_assertion  = false
  additional_origins           = []
  skip_native_app_success_page = false
}
