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
