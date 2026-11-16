from collections.abc import Mapping
from itertools import count

from parfocal_deploy.smoke import CSP, CSP_PARTS, ISOLATION_HEADERS, PERMISSIONS, SECURITY_HEADERS

_nonces = count()


def secured_page_headers(isolation: Mapping[str, str] = ISOLATION_HEADERS) -> dict[str, str]:
    return {
        **isolation,
        **SECURITY_HEADERS,
        "strict-transport-security": "max-age=31536000",
        "permissions-policy": ", ".join(PERMISSIONS),
        CSP: f"script-src 'nonce-n{next(_nonces)}A==' {'; '.join(CSP_PARTS)}",
    }
