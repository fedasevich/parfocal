variable "state_passphrase" {
  type      = string
  sensitive = true
}

variable "cloudflare_account_id" {
  type    = string
  default = "ecd7fda10e3d9ff42ecc86cb43073fcd"
}

variable "zitadel_domain" {
  type    = string
  default = "parfocal-iqcyh5.eu1.zitadel.cloud"
}

variable "zitadel_org_id" {
  type    = string
  default = "393969446668073456"
}

variable "zitadel_key_file" {
  type    = string
  default = "~/.config/parfocal/zitadel-sa.json"
}
