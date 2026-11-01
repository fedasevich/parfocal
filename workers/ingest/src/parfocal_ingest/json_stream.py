import re
from collections.abc import Iterator
from dataclasses import dataclass
from enum import Enum, auto
from typing import BinaryIO

import msgspec
import numpy as np
from numpy.typing import NDArray

BLOCK_BYTES = 1024 * 1024
QUOTE = ord('"')
BACKSLASH = ord("\\")
OPEN_OBJECT = ord("{")
OPEN_ARRAY = ord("[")
CLOSE_OBJECT = ord("}")
CLOSE_ARRAY = ord("]")
COMMA = ord(",")
WHITESPACE = b" \t\r\n"
MEMBER_KEY = re.compile(rb'\s*("(?:[^"\\]|\\.)*")\s*:\s*\Z', re.DOTALL)


class JsonStreamError(msgspec.DecodeError):
    pass


class Phase(Enum):
    SEEK = auto()
    ITEMS = auto()
    TAIL = auto()


@dataclass
class Carry:
    in_string: bool = False
    backslashes: int = 0
    depth: int = 0


@dataclass(frozen=True)
class Tokens:
    positions: NDArray[np.int64]
    kinds: NDArray[np.uint8]
    depths: NDArray[np.int64]

    def where(self, mask: NDArray[np.bool_]) -> Tokens:
        return Tokens(self.positions[mask], self.kinds[mask], self.depths[mask])


def unescaped_quotes(view: NDArray[np.uint8], carry: Carry) -> NDArray[np.int64]:
    quotes = np.flatnonzero(view == QUOTE)
    slashes = view == BACKSLASH
    if not len(quotes) or (not carry.backslashes and not slashes.any()):
        return quotes
    index = np.arange(len(view), dtype=np.int64)
    last_plain = np.maximum.accumulate(np.where(slashes, -1, index))
    previous = last_plain[np.maximum(quotes - 1, 0)]
    runs = np.where(previous >= 0, quotes - 1 - previous, quotes + carry.backslashes)
    runs[quotes == 0] = carry.backslashes
    return quotes[runs % 2 == 0]


def trailing_backslashes(view: NDArray[np.uint8], carry: Carry) -> int:
    plain = np.flatnonzero(view != BACKSLASH)
    if not len(plain):
        return carry.backslashes + len(view)
    return len(view) - 1 - int(plain[-1])


def tokens_of(view: NDArray[np.uint8], carry: Carry, offset: int) -> Tokens:
    quotes = unescaped_quotes(view, carry)
    opens = (view == OPEN_OBJECT) | (view == OPEN_ARRAY)
    closes = (view == CLOSE_OBJECT) | (view == CLOSE_ARRAY)
    marks = np.flatnonzero(opens | closes | (view == COMMA))
    outside = (np.searchsorted(quotes, marks) + int(carry.in_string)) % 2 == 0
    marks = marks[outside]
    steps = opens[marks].astype(np.int64) - closes[marks].astype(np.int64)
    totals = np.cumsum(steps)
    depths = carry.depth + totals - steps
    carry.in_string = (len(quotes) + int(carry.in_string)) % 2 == 1
    carry.backslashes = trailing_backslashes(view, carry)
    if len(totals):
        carry.depth += int(totals[-1])
    return Tokens(marks.astype(np.int64) + offset, view[marks], depths)


class JsonArray:
    def __init__(self, handle: BinaryIO, key: str, *, block_bytes: int = BLOCK_BYTES) -> None:
        self.handle = handle
        self.key = key
        self.block_bytes = block_bytes
        self.rest = bytearray()
        self.phase = Phase.SEEK
        self.top: int | None = None
        self.array_depth = 0
        self.buffer = bytearray()
        self.base = 0
        self.item_start = 0
        self.member_start = 0
        self.batches_out = 0

    def is_key(self, text: bytes) -> bool:
        matched = MEMBER_KEY.match(text)
        if matched is None:
            return False
        try:
            return msgspec.json.decode(matched.group(1)) == self.key
        except msgspec.DecodeError:
            return False

    def local(self, position: int) -> int:
        return position - self.base

    def seek(self, tokens: Tokens) -> int | None:
        if self.top is None:
            first = self.buffer.lstrip(WHITESPACE)[:1]
            if not first:
                return None
            self.top = first[0]
        shallow = tokens.where(tokens.depths <= 1)
        for position, kind, depth in zip(
            shallow.positions.tolist(), shallow.kinds.tolist(), shallow.depths.tolist(), strict=True
        ):
            if self.top == OPEN_ARRAY and depth == 0 and kind == OPEN_ARRAY:
                self.array_depth = 1
                return position
            if self.top != OPEN_OBJECT:
                continue
            if (depth, kind) in ((0, OPEN_OBJECT), (1, COMMA)):
                self.member_start = position + 1
            elif depth == 1 and kind == OPEN_ARRAY:
                key = bytes(self.buffer[self.local(self.member_start) : self.local(position)])
                if self.is_key(key):
                    self.array_depth = 2
                    return position
        return None

    def batch(self, end: int) -> bytes:
        body = bytes(self.buffer[self.local(self.item_start) : self.local(end)])
        if not body.strip(WHITESPACE):
            raise JsonStreamError("An array holds an empty item")
        self.batches_out += 1
        return b"[" + body + b"]"

    def items(self, tokens: Tokens, after: int) -> Iterator[bytes]:
        level = tokens.where((tokens.depths == self.array_depth) & (tokens.positions >= after))
        closers = np.flatnonzero((level.kinds == CLOSE_ARRAY) | (level.kinds == CLOSE_OBJECT))
        if len(closers):
            end = int(level.positions[closers[0]])
            if level.kinds[closers[0]] != CLOSE_ARRAY:
                raise JsonStreamError("An array is closed by a brace")
            body = bytes(self.buffer[self.local(self.item_start) : self.local(end)])
            if body.strip(WHITESPACE):
                self.batches_out += 1
                yield b"[" + body + b"]"
            elif self.batches_out:
                raise JsonStreamError("An array ends with a comma")
            self.rest += b"]"
            self.rest += self.buffer[self.local(end) + 1 :]
            self.buffer = bytearray()
            self.phase = Phase.TAIL
            return
        commas = level.positions[level.kinds == COMMA]
        if len(commas):
            cut = int(commas[-1])
            yield self.batch(cut)
            self.item_start = cut + 1
        drop = self.local(self.item_start)
        del self.buffer[:drop]
        self.base = self.item_start

    def batches(self) -> Iterator[bytes]:
        carry = Carry()
        read = 0
        while block := self.handle.read(self.block_bytes):
            offset = read
            read += len(block)
            if self.phase is Phase.TAIL:
                self.rest += block
                continue
            self.buffer += block
            tokens = tokens_of(np.frombuffer(block, dtype=np.uint8), carry, offset)
            after = offset
            if self.phase is Phase.SEEK:
                found = self.seek(tokens)
                if found is None:
                    continue
                self.rest += self.buffer[: self.local(found) + 1]
                self.item_start = found + 1
                self.phase = Phase.ITEMS
                after = found + 1
            yield from self.items(tokens, after)
        if self.phase is Phase.SEEK:
            self.rest += self.buffer
            self.buffer = bytearray()
        elif self.phase is Phase.ITEMS:
            raise JsonStreamError("The file ends inside an array")
