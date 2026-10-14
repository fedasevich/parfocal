import base64
import os
import struct
from collections.abc import Mapping
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY_BYTES = 32
NONCE_BYTES = 12
CIPHERTEXT_FORMAT = 1
HEADER = struct.Struct(">BH")


class EnvelopeError(Exception):
    pass


class InvalidMasterKeysError(EnvelopeError):
    def __init__(self) -> None:
        super().__init__("MASTER_KEYS must be id:key pairs with 32-byte url-safe base64 keys")


class UnknownMasterKeyError(EnvelopeError):
    def __init__(self, key_id: str) -> None:
        super().__init__(f"Master key '{key_id}' is not in the keyring")


class DataKeyUnavailableError(EnvelopeError):
    def __init__(self, version: int) -> None:
        super().__init__(f"Data key version {version} is not available")


class InvalidCiphertextError(EnvelopeError):
    def __init__(self) -> None:
        super().__init__("The ciphertext is damaged or belongs to another context")


@dataclass(frozen=True)
class WrappedKey:
    master_id: str
    blob: bytes


@dataclass(frozen=True)
class DataKey:
    version: int
    key: bytes


def new_data_key(version: int) -> DataKey:
    return DataKey(version, os.urandom(KEY_BYTES))


def decode_key(value: str) -> bytes:
    try:
        key = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except ValueError as error:
        raise InvalidMasterKeysError from error
    if len(key) != KEY_BYTES:
        raise InvalidMasterKeysError
    return key


def seal(key: bytes, plaintext: bytes, context: bytes) -> bytes:
    nonce = os.urandom(NONCE_BYTES)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, context)


def unseal(key: bytes, sealed: bytes, context: bytes) -> bytes:
    try:
        return AESGCM(key).decrypt(sealed[:NONCE_BYTES], sealed[NONCE_BYTES:], context)
    except InvalidTag as error:
        raise InvalidCiphertextError from error


def wrap_context(tenant_id: str, version: int) -> bytes:
    return f"parfocal-data-key:{tenant_id}:{version}".encode()


@dataclass(frozen=True)
class MasterKeyring:
    keys: Mapping[str, bytes]
    current: str

    @classmethod
    def from_setting(cls, value: str) -> MasterKeyring:
        pairs = [item.strip() for item in value.split(",") if item.strip()]
        keys: dict[str, bytes] = {}
        for pair in pairs:
            key_id, separator, encoded = pair.partition(":")
            if not separator or not key_id or key_id in keys:
                raise InvalidMasterKeysError
            keys[key_id] = decode_key(encoded)
        if not keys:
            raise InvalidMasterKeysError
        return cls(keys, next(iter(keys)))

    def wrap(self, tenant_id: str, data_key: DataKey) -> WrappedKey:
        context = wrap_context(tenant_id, data_key.version)
        return WrappedKey(self.current, seal(self.keys[self.current], data_key.key, context))

    def unwrap(self, tenant_id: str, version: int, wrapped: WrappedKey) -> DataKey:
        master = self.keys.get(wrapped.master_id)
        if master is None:
            raise UnknownMasterKeyError(wrapped.master_id)
        return DataKey(version, unseal(master, wrapped.blob, wrap_context(tenant_id, version)))

    def rewrap(self, tenant_id: str, version: int, wrapped: WrappedKey) -> WrappedKey:
        if wrapped.master_id == self.current:
            return wrapped
        return self.wrap(tenant_id, self.unwrap(tenant_id, version, wrapped))


def encrypt(data_key: DataKey, plaintext: str, context: bytes) -> bytes:
    header = HEADER.pack(CIPHERTEXT_FORMAT, data_key.version)
    return header + seal(data_key.key, plaintext.encode(), header + context)


def version_of(ciphertext: bytes) -> int:
    if len(ciphertext) < HEADER.size + NONCE_BYTES:
        raise InvalidCiphertextError
    form, version = HEADER.unpack_from(ciphertext)
    if form != CIPHERTEXT_FORMAT:
        raise InvalidCiphertextError
    return version


def decrypt(data_keys: Mapping[int, bytes], ciphertext: bytes, context: bytes) -> str:
    version = version_of(ciphertext)
    key = data_keys.get(version)
    if key is None:
        raise DataKeyUnavailableError(version)
    header = ciphertext[: HEADER.size]
    return unseal(key, ciphertext[HEADER.size :], header + context).decode()
