variable "org_id" {
  type = string
}

variable "project_name" {
  type    = string
  default = "Parfocal"
}

variable "restrict_to_own_org" {
  type    = bool
  default = true
}

variable "environments" {
  type = map(object({
    origin   = string
    dev_mode = bool
  }))
}

variable "default_redirect_origin" {
  type = string
}

variable "allow_register" {
  type    = bool
  default = true
}

variable "second_factor_prompt_skip_lifetime" {
  type    = string
  default = "720h0m0s"
}

variable "password_min_length" {
  type    = number
  default = 12
}

variable "max_password_attempts" {
  type    = number
  default = 10
}

variable "max_otp_attempts" {
  type    = number
  default = 5
}

variable "test_users" {
  type = map(object({
    email      = string
    first_name = string
    last_name  = string
  }))
  default = {}
}

variable "test_user_password" {
  type      = string
  sensitive = true
  default   = null
}
