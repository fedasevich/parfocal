import re
import uuid

from parfocal_api.problems import BadRequestError

MAX_MENTIONS = 20
HEX = "[0-9a-fA-F]"
TOKEN = re.compile(rf"@\[({HEX}{{8}}-{HEX}{{4}}-{HEX}{{4}}-{HEX}{{4}}-{HEX}{{12}})\]")


def mentioned_in(body: str) -> list[uuid.UUID]:
    return list(dict.fromkeys(uuid.UUID(found) for found in TOKEN.findall(body)))


def token_for(user_id: uuid.UUID) -> str:
    return f"@[{user_id}]"


class BadMentionError(BadRequestError):
    code = "bad-mention"
    title = "Only members who can see this can be mentioned in it"
