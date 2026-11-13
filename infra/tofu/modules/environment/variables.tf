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

variable "cloudflare_account_id" {
  type = string
}

variable "zitadel_org_id" {
  type = string
}

variable "zitadel_project_id" {
  type = string
}
