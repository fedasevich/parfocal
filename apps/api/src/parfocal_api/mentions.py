import re
import uuid

MAX_MENTIONS = 20
HEX = "[0-9a-fA-F]"
TOKEN = re.compile(rf"@\[({HEX}{{8}}-{HEX}{{4}}-{HEX}{{4}}-{HEX}{{4}}-{HEX}{{12}})\]")


def mentioned_in(body: str) -> list[uuid.UUID]:
    return list(dict.fromkeys(uuid.UUID(found) for found in TOKEN.findall(body)))


def token_for(user_id: uuid.UUID) -> str:
    return f"@[{user_id}]"
