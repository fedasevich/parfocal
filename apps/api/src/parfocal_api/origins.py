import uuid
from enum import StrEnum

from pydantic import BaseModel


class OriginRoute(StrEnum):
    HOME = "home"
    MY_WORK = "my-work"
    PROJECT = "project"
    CASE = "case"
    TASK = "task"
    SEARCH = "search"


class Origin(BaseModel):
    route: OriginRoute
    project_id: uuid.UUID | None = None
    case_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    slide_id: uuid.UUID | None = None
