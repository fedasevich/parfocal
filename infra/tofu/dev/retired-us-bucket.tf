moved {
  from = module.environment.cloudflare_r2_bucket.slides[0]
  to   = cloudflare_r2_bucket.retired_us
}

moved {
  from = module.environment.cloudflare_r2_bucket_cors.uploads[0]
  to   = cloudflare_r2_bucket_cors.retired_us
}

moved {
  from = module.environment.cloudflare_r2_bucket_lifecycle.uploads[0]
  to   = cloudflare_r2_bucket_lifecycle.retired_us
}

moved {
  from = module.environment.cloudflare_r2_bucket_lock.recovery[0]
  to   = cloudflare_r2_bucket_lock.retired_us
}
