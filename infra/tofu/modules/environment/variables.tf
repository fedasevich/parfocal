variable "name" {
  type = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.name)
    error_message = "The environment is dev, staging or prod."
  }
}

variable "origin" {
  type = string

  validation {
    condition     = var.name == "dev" || startswith(var.origin, "https://")
    error_message = "Only dev may use an origin without TLS."
  }
}

variable "extra_upload_origins" {
  type    = list(string)
  default = []

  validation {
    condition     = alltrue([for o in var.extra_upload_origins : startswith(o, "https://")])
    error_message = "Extra upload origins must use TLS."
  }
}

variable "dev_mode" {
  type = bool

  validation {
    condition     = var.name == "dev" || !var.dev_mode
    error_message = "Only dev may run its login app in development mode."
  }
}

variable "eu_bucket" {
  type    = bool
  default = false
}

variable "tier_after_days" {
  type    = number
  default = 90

  validation {
    condition     = var.tier_after_days >= 30 && floor(var.tier_after_days) == var.tier_after_days
    error_message = "Tenant objects move to Infrequent Access after at least 30 whole days, its minimum storage duration."
  }
}

variable "locked_days" {
  type    = number
  default = 7

  validation {
    condition     = var.locked_days >= 1 && floor(var.locked_days) == var.locked_days
    error_message = "Tenant objects stay locked against delete and overwrite for at least one whole day, so a mistaken delete can be undone."
  }
}

variable "cloudflare_account_id" {
  type = string
}

variable "zitadel_org_id" {
  type = string
}

variable "zitadel_project_id" {
  type = string
}
