from dataclasses import dataclass


@dataclass(frozen=True)
class Environment:
    name: str
    app_env: str
    wrangler_env: str
    worker: str
    hostname: str
    modal_environment: str
    neon_branch: str
    tofu_root: str
    slide_bucket: str

    @property
    def origin(self) -> str:
        return f"https://{self.hostname}"


ENVIRONMENTS = {
    environment.name: environment
    for environment in (
        Environment(
            name="production",
            app_env="prod",
            wrangler_env="production",
            worker="parfocal-edge",
            hostname="app.parfocal.eu",
            modal_environment="main",
            neon_branch="main",
            tofu_root="prod",
            slide_bucket="parfocal-dev",
        ),
        Environment(
            name="staging",
            app_env="staging",
            wrangler_env="staging",
            worker="parfocal-edge-staging",
            hostname="staging.parfocal.eu",
            modal_environment="staging",
            neon_branch="staging",
            tofu_root="staging",
            slide_bucket="parfocal-staging",
        ),
    )
}


class UnknownEnvironmentError(Exception):
    def __init__(self, name: str) -> None:
        super().__init__(
            f"unknown environment {name}, use one of {', '.join(sorted(ENVIRONMENTS))}"
        )


def environment(name: str) -> Environment:
    try:
        return ENVIRONMENTS[name]
    except KeyError:
        raise UnknownEnvironmentError(name) from None
