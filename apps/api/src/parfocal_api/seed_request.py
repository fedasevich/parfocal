from starlette.requests import Request


def seed_request() -> Request:
    return Request({"type": "http", "app": None, "headers": []})
