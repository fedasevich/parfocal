from datetime import UTC, datetime

import pytest

from parfocal_common.object_store import (
    EMPTY_SHA256,
    UNSIGNED_PAYLOAD,
    NoSuchUploadError,
    StorageError,
    StorageLocation,
    StoredPart,
    completion_xml,
    error_of,
    presign,
    signature,
)

AWS_EXAMPLE = StorageLocation(
    endpoint="https://examplebucket.s3.amazonaws.com",
    region="us-east-1",
    bucket="examplebucket",
    access_key_id="AKIAIOSFODNN7EXAMPLE",
    secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
)
AWS_EXAMPLE_TIME = datetime(2013, 5, 24, tzinfo=UTC)


def test_a_presigned_url_matches_the_aws_documented_example() -> None:
    query = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request",
        "X-Amz-Date": "20130524T000000Z",
        "X-Amz-Expires": "86400",
        "X-Amz-SignedHeaders": "host",
    }
    signed = signature(
        AWS_EXAMPLE,
        "GET",
        "/test.txt",
        query,
        {"host": "examplebucket.s3.amazonaws.com"},
        UNSIGNED_PAYLOAD,
        AWS_EXAMPLE_TIME,
    )
    assert signed.value == "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"


def test_a_signed_header_request_matches_the_aws_documented_example() -> None:
    headers = {
        "Host": "examplebucket.s3.amazonaws.com",
        "Range": "bytes=0-9",
        "x-amz-content-sha256": EMPTY_SHA256,
        "x-amz-date": "20130524T000000Z",
    }
    signed = signature(AWS_EXAMPLE, "GET", "/test.txt", {}, headers, EMPTY_SHA256, AWS_EXAMPLE_TIME)
    assert signed.signed_headers == "host;range;x-amz-content-sha256;x-amz-date"
    assert signed.value == "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"


def test_a_part_url_is_path_style_and_encodes_the_key() -> None:
    location = StorageLocation("http://127.0.0.1:9000", "auto", "bucket", "id", "secret")
    url = presign(
        location,
        "PUT",
        "t/a/quarantine/u/My slide (1).svs",
        {"partNumber": "3", "uploadId": "a/b+c="},
        900,
        AWS_EXAMPLE_TIME,
    )
    assert url.startswith("http://127.0.0.1:9000/bucket/t/a/quarantine/u/My%20slide%20%281%29.svs?")
    assert "uploadId=a%2Fb%2Bc%3D" in url
    assert "X-Amz-Expires=900" in url
    assert "X-Amz-Credential=id%2F20130524%2Fauto%2Fs3%2Faws4_request" in url


def test_a_presigned_url_lives_at_most_seven_days() -> None:
    with pytest.raises(ValueError, match="7 days"):
        presign(AWS_EXAMPLE, "PUT", "key", {}, 7 * 24 * 3600 + 1, AWS_EXAMPLE_TIME)


def test_storage_errors_are_read_from_the_xml_body() -> None:
    body = b"<?xml version='1.0'?><Error><Code>NoSuchUpload</Code><Message>x</Message></Error>"
    assert isinstance(error_of(404, body), NoSuchUploadError)
    other = error_of(400, b"<Error><Code>InvalidPart</Code></Error>")
    assert (type(other), other.code) == (StorageError, "InvalidPart")
    assert error_of(502, b"<html>gateway</html>").code == "unknown"
    assert error_of(502, b"not xml").code == "unknown"


def test_the_completion_body_quotes_each_etag() -> None:
    body = completion_xml([StoredPart(1, 5, "abc"), StoredPart(2, 1, "def")])
    assert body == (
        b'<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"abc"</ETag></Part>'
        b'<Part><PartNumber>2</PartNumber><ETag>"def"</ETag></Part></CompleteMultipartUpload>'
    )
