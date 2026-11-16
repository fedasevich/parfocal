import modal

from parfocal_deploy.modal_app import SECRETS, app_image

ROTATE_APP = "parfocal-key-rotation"
ACTIONS = ("status", "rewrap")
KEY_LISTS = ("SESSION_KEY", "TILE_TOKEN_KEY", "ROOM_TOKEN_KEY")

app = modal.App(
    ROTATE_APP,
    image=app_image(),
    secrets=[modal.Secret.from_name(name) for name in SECRETS],
)


@app.function(timeout=600, max_containers=1)
def keyring(action: str) -> tuple[str, dict[str, int]]:
    import asyncio

    from parfocal_api.key_rotation import run
    from parfocal_api.settings import ApiSettings
    from parfocal_common.envelope import MasterKeyring
    from parfocal_common.settings import load_settings

    if action not in ACTIONS:
        raise ValueError(action)
    settings = load_settings(ApiSettings)
    stored = settings.master_keys.get_secret_value()
    status = asyncio.run(
        run(str(settings.database_url), MasterKeyring.from_setting(stored), action)
    )
    return stored, status.wrapped_by


@app.function(timeout=60, max_containers=1)
def key_list(name: str) -> str:
    import os

    if name not in KEY_LISTS:
        raise ValueError(name)
    return os.environ[name]
