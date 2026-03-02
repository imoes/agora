import io

import pytest

from .conftest import auth_headers, register_user


@pytest.mark.asyncio
async def test_download_file_accepts_token_query(client, tmp_upload_dir):
    auth = await register_user(client)
    token = auth["access_token"]

    upload_response = await client.post(
        "/api/files/upload",
        headers=auth_headers(token),
        files={"file": ("bericht.txt", io.BytesIO(b"hello world"), "text/plain")},
    )
    assert upload_response.status_code == 201
    ref_id = upload_response.json()["id"]

    download_response = await client.get(f"/api/files/download/{ref_id}?token={token}")
    assert download_response.status_code == 200
    assert download_response.content == b"hello world"
    assert "bericht.txt" in download_response.headers.get("content-disposition", "")
