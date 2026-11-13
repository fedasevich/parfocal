locals {
  first_factor_lifetime = "240h0m0s"
}

resource "zitadel_login_policy" "main" {
  org_id                        = var.org_id
  user_login                    = true
  allow_register                = var.allow_register
  allow_external_idp            = false
  allow_domain_discovery        = false
  disable_login_with_email      = false
  disable_login_with_phone      = true
  ignore_unknown_usernames      = true
  hide_password_reset           = false
  default_redirect_uri          = "${var.default_redirect_origin}/"
  force_mfa                     = false
  force_mfa_local_only          = false
  passwordless_type             = "PASSWORDLESS_TYPE_ALLOWED"
  second_factors                = ["SECOND_FACTOR_TYPE_OTP", "SECOND_FACTOR_TYPE_U2F"]
  multi_factors                 = ["MULTI_FACTOR_TYPE_U2F_WITH_VERIFICATION"]
  password_check_lifetime       = local.first_factor_lifetime
  external_login_check_lifetime = local.first_factor_lifetime
  second_factor_check_lifetime  = "12h0m0s"
  multi_factor_check_lifetime   = "12h0m0s"
  mfa_init_skip_lifetime        = var.second_factor_prompt_skip_lifetime
}

resource "zitadel_password_complexity_policy" "main" {
  org_id        = var.org_id
  min_length    = var.password_min_length
  has_lowercase = false
  has_uppercase = false
  has_number    = false
  has_symbol    = false
}

resource "zitadel_lockout_policy" "main" {
  org_id                = var.org_id
  max_password_attempts = var.max_password_attempts
  max_otp_attempts      = var.max_otp_attempts
}
