import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException

from parfocal_common.clients import ErrorReporter

PROBLEM_MEDIA_TYPE = "application/problem+json"
PROBLEM_BASE = "https://parfocal.eu/problems/"

logger = logging.getLogger("parfocal.api")


class FieldError(BaseModel):
    location: list[str | int]
    message: str
    code: str


class Problem(BaseModel):
    type: str
    title: str
    status: int
    code: str
    detail: str | None = None
    errors: list[FieldError] | None = None


class ProblemError(Exception):
    status = 500
    code = "internal"
    title = "Something went wrong"

    def __init__(self, detail: str | None = None) -> None:
        super().__init__(detail or self.title)
        self.detail = detail


class BadRequestError(ProblemError):
    status = 400
    code = "bad-request"
    title = "The request is not valid"


class UnauthenticatedError(ProblemError):
    status = 401
    code = "unauthenticated"
    title = "Sign in to continue"


class ForbiddenError(ProblemError):
    status = 403
    code = "forbidden"
    title = "You do not have access to this"


class NotFoundError(ProblemError):
    status = 404
    code = "not-found"
    title = "Not found"


class ConflictError(ProblemError):
    status = 409
    code = "conflict"
    title = "This changed since you loaded it"


STATUS_CODES: dict[int, type[ProblemError]] = {
    problem.status: problem
    for problem in (
        BadRequestError,
        UnauthenticatedError,
        ForbiddenError,
        NotFoundError,
        ConflictError,
    )
}

PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    status: {"model": Problem, "content": {PROBLEM_MEDIA_TYPE: {}}, "description": problem.title}
    for status, problem in {**STATUS_CODES, 422: BadRequestError, 500: ProblemError}.items()
}


def problem_response(
    status: int,
    code: str,
    title: str,
    detail: str | None = None,
    errors: list[FieldError] | None = None,
) -> JSONResponse:
    problem = Problem(
        type=f"{PROBLEM_BASE}{code}",
        title=title,
        status=status,
        code=code,
        detail=detail,
        errors=errors,
    )
    return JSONResponse(
        problem.model_dump(exclude_none=True), status_code=status, media_type=PROBLEM_MEDIA_TYPE
    )


def field_errors(error: RequestValidationError) -> list[FieldError]:
    return [
        FieldError(
            location=[part for part in item.get("loc", ()) if isinstance(part, str | int)],
            message=str(item.get("msg", "")),
            code=str(item.get("type", "invalid")),
        )
        for item in error.errors()
    ]


def install_problem_handlers(app: FastAPI, errors: ErrorReporter) -> None:
    async def known_problem(_: Request, problem: Exception) -> JSONResponse:
        assert isinstance(problem, ProblemError)
        return problem_response(problem.status, problem.code, problem.title, problem.detail)

    async def validation(_: Request, error: Exception) -> JSONResponse:
        assert isinstance(error, RequestValidationError)
        return problem_response(
            422, "validation", "Some fields are not valid", errors=field_errors(error)
        )

    async def http_error(_: Request, error: Exception) -> JSONResponse:
        assert isinstance(error, HTTPException)
        known = STATUS_CODES.get(error.status_code)
        if known is not None:
            return problem_response(known.status, known.code, known.title)
        return problem_response(error.status_code, f"http-{error.status_code}", "Request failed")

    async def unexpected(_: Request, error: Exception) -> JSONResponse:
        errors.capture(error)
        return problem_response(ProblemError.status, ProblemError.code, ProblemError.title)

    app.add_exception_handler(ProblemError, known_problem)
    app.add_exception_handler(RequestValidationError, validation)
    app.add_exception_handler(HTTPException, http_error)
    app.add_exception_handler(Exception, unexpected)
