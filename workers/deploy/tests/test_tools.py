from parfocal_deploy.tools import SMOKE_USER_AGENT, smoke_request


def test_the_smoke_check_names_itself_so_cloudflare_does_not_refuse_it() -> None:
    request = smoke_request("https://app.parfocal.eu/api/health")
    assert request.get_header("User-agent") == SMOKE_USER_AGENT
