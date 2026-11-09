import base64
import binascii
import json
import uuid
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Request, Response
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field, StringConstraints

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.availability import member_of
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.problems import BadRequestError, ProblemError

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
SCREENSHOT_LIMIT = 4 * 1024 * 1024
BODY_LIMIT = 6 * 1024 * 1024
FEEDBACK_PREFIX = "feedback"

FeedbackText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
]
FeedbackRoute = Annotated[
    str, StringConstraints(max_length=300, pattern=r"^(__root__|/[A-Za-z0-9/_.$\-]*)$")
]

AppVersion = Annotated[str, StringConstraints(max_length=80)]
Viewport = Annotated[list[Annotated[int, Field(ge=0, le=20000)]], Field(max_length=2)]
ScreenshotData = Annotated[str, StringConstraints(max_length=SCREENSHOT_LIMIT * 4 // 3 + 4)]


class FeedbackDraft(BaseModel):
    text: FeedbackText
    route: FeedbackRoute
    app_version: AppVersion | None = None
    viewport: Viewport | None = None
    screenshot_png: ScreenshotData | None = None


class FeedbackSent(BaseModel):
    id: uuid.UUID
    screenshot: bool


class ScreenshotNotPngError(BadRequestError):
    code = "screenshot-not-png"
    title = "The screenshot must be a PNG image"


class FeedbackTooLargeError(ProblemError):
    status = 413
    code = "feedback-too-large"
    title = "The feedback and its screenshot are too large"


class LengthRequiredError(ProblemError):
    status = 411
    code = "length-required"
    title = "Send the size of the feedback with it"


def declared_length(request: Request) -> int:
    try:
        return int(request.headers["content-length"])
    except (KeyError, ValueError) as error:
        raise LengthRequiredError from error


class SizeCappedRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def capped(request: Request) -> Response:
            if declared_length(request) > BODY_LIMIT:
                raise FeedbackTooLargeError
            return await handler(request)

        return capped


router = APIRouter(prefix="/api/feedback", tags=["feedback"], route_class=SizeCappedRoute)


def feedback_key(tenant_id: uuid.UUID, feedback_id: uuid.UUID, name: str) -> str:
    return f"{FEEDBACK_PREFIX}/{tenant_id}/{feedback_id}/{name}"


def decoded_png(encoded: str) -> bytes:
    try:
        image = base64.b64decode(encoded, validate=True)
    except binascii.Error as error:
        raise ScreenshotNotPngError from error
    if not image.startswith(PNG_SIGNATURE) or len(image) > SCREENSHOT_LIMIT:
        raise ScreenshotNotPngError
    return image


@router.post("", operation_id="sendFeedback")
async def send_feedback(
    draft: FeedbackDraft, principal: CurrentPrincipal, connection: TenantConnection, store: Store
) -> FeedbackSent:
    member = member_of(principal)
    screenshot = None if draft.screenshot_png is None else decoded_png(draft.screenshot_png)
    feedback_id = uuid.uuid4()
    note = {
        "id": str(feedback_id),
        "tenant_id": str(member.tenant_id),
        "user_id": str(member.user_id),
        "sent_at": datetime.now(UTC).isoformat(),
        "route": draft.route,
        "app_version": draft.app_version,
        "viewport": draft.viewport,
        "text": draft.text,
        "screenshot": screenshot is not None,
    }
    if screenshot is not None:
        await store.put_object(
            feedback_key(member.tenant_id, feedback_id, "screenshot.png"), screenshot, "image/png"
        )
    await store.put_object(
        feedback_key(member.tenant_id, feedback_id, "feedback.json"),
        json.dumps(note).encode(),
        "application/json",
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.FEEDBACK_SENT,
        AuditTarget.FEEDBACK,
        feedback_id,
        tenant_id=member.tenant_id,
        details={"screenshot": screenshot is not None},
    )
    return FeedbackSent(id=feedback_id, screenshot=screenshot is not None)
