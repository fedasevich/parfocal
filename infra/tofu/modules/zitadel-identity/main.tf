resource "zitadel_project" "parfocal" {
  org_id                 = var.org_id
  name                   = var.project_name
  project_role_assertion = true
  has_project_check      = var.restrict_to_own_org
}

resource "zitadel_application_oidc" "api" {
  for_each                     = var.environments
  org_id                       = var.org_id
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

resource "zitadel_human_user" "test" {
  for_each                     = var.test_users
  org_id                       = var.org_id
  user_name                    = each.value.email
  email                        = each.value.email
  first_name                   = each.value.first_name
  last_name                    = each.value.last_name
  is_email_verified            = true
  initial_password             = var.test_user_password
  initial_skip_password_change = true
  depends_on                   = [zitadel_password_complexity_policy.main]

  lifecycle {
    precondition {
      condition     = var.test_user_password != null
      error_message = "test_user_password is required when test_users is not empty."
    }
  }
}
