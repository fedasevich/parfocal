import re
import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter
from pydantic import AfterValidator, BaseModel, Field, StringConstraints
from sqlalchemy import exists, literal_column, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import ConflictError
from parfocal_api.tables import accession_counters, accession_formats, cases
from parfocal_common.db import CURRENT_TENANT

DEFAULT_TEMPLATE = "{prefix}{yy}-{seq:5}"
DEFAULT_PREFIXES = ("S",)
MAX_ACCESSION_LENGTH = 40
TOKEN = re.compile(r"\{(prefix|yy|yyyy|seq:(\d))\}")
LITERAL = re.compile(r"^[A-Z0-9./-]*$")


class InvalidTemplateError(ValueError):
    pass


class AccessionRangeFullError(ConflictError):
    code = "accession-range-full"
    title = "Every number for this prefix and year is used"


class AccessionTakenError(ConflictError):
    code = "accession-taken"
    title = "This accession number is already used in this workspace"


class AccessionFormatError(ConflictError):
    code = "accession-format"
    title = "This accession number does not match the workspace's format"


@dataclass(frozen=True)
class AccessionFormat:
    template: str
    prefixes: tuple[str, ...]

    @property
    def digits(self) -> int:
        found = TOKEN.findall(self.template)
        return next(int(width) for name, width in found if name.startswith("seq"))

    def render(self, prefix: str, year: int, seq: int) -> str:
        values = {"prefix": prefix, "yy": f"{year % 100:02d}", "yyyy": f"{year:04d}"}
        return TOKEN.sub(
            lambda m: f"{seq:0{m.group(2)}d}" if m.group(2) else values[m.group(1)],
            self.template,
        )

    def pattern(self) -> re.Pattern[str]:
        prefixes = "|".join(re.escape(prefix) for prefix in self.prefixes)
        parts: list[str] = []
        position = 0
        for match in TOKEN.finditer(self.template):
            parts.append(re.escape(self.template[position : match.start()]))
            name, width = match.group(1), match.group(2)
            if width:
                parts.append(rf"(?P<seq>\d{{{width}}})")
            elif name == "prefix":
                parts.append(rf"(?P<prefix>{prefixes})")
            else:
                parts.append(rf"(?P<{name}>\d{{{len(name)}}})")
            position = match.end()
        parts.append(re.escape(self.template[position:]))
        return re.compile("^" + "".join(parts) + "$")

    def matches(self, accession: str) -> bool:
        return self.pattern().match(accession) is not None


def validate_template(template: str) -> str:
    tokens = [match.group(1) for match in TOKEN.finditer(template)]
    sequences = [token for token in tokens if token.startswith("seq")]
    if len(sequences) != 1 or tokens.count("prefix") != 1:
        raise InvalidTemplateError("The template needs exactly one {prefix} and one {seq:N}")
    if len(tokens) != len(set(tokens)) or ("yy" in tokens) == ("yyyy" in tokens):
        raise InvalidTemplateError("The template needs exactly one of {yy} or {yyyy}")
    width = int(sequences[0].split(":")[1])
    if not 3 <= width <= 8:
        raise InvalidTemplateError("The sequence must have 3 to 8 digits")
    if not LITERAL.match(TOKEN.sub("", template)):
        raise InvalidTemplateError(
            "Only capital letters, digits, '-', '.' and '/' may surround tokens"
        )
    longest = AccessionFormat(template, ("XXXX",)).render("XXXX", 2026, 0)
    if len(longest) > MAX_ACCESSION_LENGTH:
        raise InvalidTemplateError("The numbers would be longer than 40 characters")
    return template


type Template = Annotated[str, StringConstraints(max_length=60), AfterValidator(validate_template)]
type Prefix = Annotated[str, StringConstraints(pattern=r"^[A-Z]{1,4}$")]


class AccessionFormatChange(BaseModel):
    template: Template
    prefixes: Annotated[list[Prefix], Field(min_length=1, max_length=20)]


class AccessionFormatView(BaseModel):
    template: str
    prefixes: list[str]
    next: dict[str, str]


async def format_of(connection: AsyncConnection, tenant_id: uuid.UUID) -> AccessionFormat:
    row = (
        await connection.execute(
            select(accession_formats.c.template, accession_formats.c.prefixes).where(
                accession_formats.c.tenant_id == tenant_id
            )
        )
    ).one_or_none()
    if row is None:
        return AccessionFormat(DEFAULT_TEMPLATE, DEFAULT_PREFIXES)
    return AccessionFormat(row.template, tuple(row.prefixes))


async def taken(connection: AsyncConnection, tenant_id: uuid.UUID, accession: str) -> bool:
    return bool(
        await connection.scalar(
            select(exists().where(cases.c.tenant_id == tenant_id, cases.c.accession == accession))
        )
    )


async def allocate_accession(
    connection: AsyncConnection, tenant_id: uuid.UUID, prefix: str, year: int
) -> str:
    accession_format = await format_of(connection, tenant_id)
    if prefix not in accession_format.prefixes:
        raise AccessionFormatError(f"Unknown prefix {prefix}")
    limit = 10**accession_format.digits - 1
    counter = upsert(accession_counters).values(
        tenant_id=tenant_id, prefix=prefix, year=year, last_value=1
    )
    counter = counter.on_conflict_do_update(
        index_elements=[
            accession_counters.c.tenant_id,
            accession_counters.c.prefix,
            accession_counters.c.year,
        ],
        set_={"last_value": accession_counters.c.last_value + 1},
    ).returning(accession_counters.c.last_value)
    while True:
        value = await connection.scalar(counter)
        assert isinstance(value, int)
        if value > limit:
            raise AccessionRangeFullError
        accession = accession_format.render(prefix, year, value)
        if not await taken(connection, tenant_id, accession):
            return accession


async def check_imported_accession(
    connection: AsyncConnection, tenant_id: uuid.UUID, accession: str
) -> str:
    if not (await format_of(connection, tenant_id)).matches(accession):
        raise AccessionFormatError
    if await taken(connection, tenant_id, accession):
        raise AccessionTakenError
    return accession


async def next_numbers(
    connection: AsyncConnection, tenant_id: uuid.UUID, year: int
) -> dict[str, str]:
    accession_format = await format_of(connection, tenant_id)
    previews: dict[str, str] = {}
    for prefix in accession_format.prefixes:
        last = await connection.scalar(
            select(accession_counters.c.last_value).where(
                accession_counters.c.tenant_id == tenant_id,
                accession_counters.c.prefix == prefix,
                accession_counters.c.year == year,
            )
        )
        previews[prefix] = accession_format.render(prefix, year, (last or 0) + 1)
    return previews


router = APIRouter(prefix="/api/tenant/accession-format", tags=["tenant"])


async def current_year(connection: AsyncConnection) -> int:
    year = await connection.scalar(select(literal_column("extract(year FROM now())::int")))
    assert isinstance(year, int)
    return year


async def view_of(connection: AsyncConnection, tenant_id: uuid.UUID) -> AccessionFormatView:
    accession_format = await format_of(connection, tenant_id)
    return AccessionFormatView(
        template=accession_format.template,
        prefixes=list(accession_format.prefixes),
        next=await next_numbers(connection, tenant_id, await current_year(connection)),
    )


async def tenant_of(connection: AsyncConnection) -> uuid.UUID:
    tenant_id = await connection.scalar(select(literal_column(CURRENT_TENANT)))
    assert isinstance(tenant_id, uuid.UUID)
    return tenant_id


@router.get("", operation_id="getAccessionFormat")
async def get_accession_format(connection: TenantConnection) -> AccessionFormatView:
    return await view_of(connection, await tenant_of(connection))


@router.put("", operation_id="updateAccessionFormat", **require(Permission.LAB_SETUP, write=True))
async def update_accession_format(
    change: AccessionFormatChange, principal: CurrentPrincipal, connection: TenantConnection
) -> AccessionFormatView:
    tenant_id = await tenant_of(connection)
    previous = await format_of(connection, tenant_id)
    values = {"template": change.template, "prefixes": change.prefixes}
    await connection.execute(
        upsert(accession_formats)
        .values(tenant_id=tenant_id, **values)
        .on_conflict_do_update(index_elements=[accession_formats.c.tenant_id], set_=values)
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.ACCESSION_FORMAT_CHANGED,
        AuditTarget.TENANT,
        tenant_id,
        tenant_id=database_scope(principal).tenant_id,
        details={
            "from": {"template": previous.template, "prefixes": list(previous.prefixes)},
            "to": values,
        },
    )
    return await view_of(connection, tenant_id)
