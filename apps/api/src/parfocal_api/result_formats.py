import json
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from parfocal_api.context import TenantConnection
from parfocal_common.results_schema import Code, schema_text, template_text, validate

MAX_CONTENT = 20_000_000


class ResultsFile(BaseModel):
    content: Annotated[str, Field(max_length=MAX_CONTENT)]


class SchemaProblem(BaseModel):
    line: int
    path: str
    code: Code
    message: str


class Validation(BaseModel):
    valid: bool
    problems: list[SchemaProblem]


router = APIRouter(prefix="/api/result-formats/parfocal-json", tags=["result-sets"])


@router.get("/schema", operation_id="getResultsSchema")
async def get_results_schema(connection: TenantConnection) -> dict[str, Any]:
    return json.loads(schema_text())


@router.get("/template", operation_id="getResultsTemplate")
async def get_results_template(connection: TenantConnection) -> dict[str, Any]:
    return json.loads(template_text())


@router.post("/validate", operation_id="validateResultsFile")
async def validate_results_file(upload: ResultsFile, connection: TenantConnection) -> Validation:
    problems = [
        SchemaProblem(line=item.line, path=item.path, code=item.code, message=item.message)
        for item in validate(upload.content)
    ]
    return Validation(valid=not problems, problems=problems)
