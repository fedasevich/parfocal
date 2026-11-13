output "project_id" {
  value = zitadel_project.parfocal.id
}

output "client_ids" {
  value     = { for env, app in zitadel_application_oidc.api : env => app.client_id }
  sensitive = true
}

output "client_secrets" {
  value     = { for env, app in zitadel_application_oidc.api : env => app.client_secret }
  sensitive = true
}

output "test_user_ids" {
  value = { for key, user in zitadel_human_user.test : key => user.id }
}
