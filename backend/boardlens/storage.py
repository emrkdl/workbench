"""블롭 스토어.

원본 HKP 와 레이어 기하 버퍼(.blg)가 사는 곳이다. 관계형 DB 에 넣지 않는 것들 —
질의 대상이 아니고, 크고, 불변이다.

초기에는 마운트된 파일시스템으로 충분하다. MinIO 가 필요해지는 시점이 오면 이 인터페이스만
구현하면 되고, 그 전에 미들웨어를 하나 더 세우는 것은 폐쇄망 운영 부담만 늘린다.
"""

from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path
from typing import BinaryIO, Protocol


class BlobStore(Protocol):
    def put(self, key: str, data: bytes) -> int: ...
    def get(self, key: str) -> bytes: ...
    def open(self, key: str) -> BinaryIO: ...
    def exists(self, key: str) -> bool: ...
    def delete(self, key: str) -> None: ...


class FileSystemStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # 키에 .. 이 섞여 루트 밖으로 나가는 것을 막는다. 업로드 파일명이 키에 섞이는
        # 경로가 있으므로 형식적인 방어가 아니다.
        target = (self.root / key).resolve()
        if not str(target).startswith(str(self.root.resolve())):
            raise ValueError(f"스토어 루트를 벗어나는 키: {key}")
        return target

    def put(self, key: str, data: bytes) -> int:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # 같은 이름으로 반쯤 쓰인 파일이 남지 않도록 임시로 쓰고 옮긴다
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(path)
        return len(data)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def open(self, key: str) -> BinaryIO:
        return self._path(key).open("rb")

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def copy_tree_to(self, key_prefix: str, dest: Path) -> None:
        src = self._path(key_prefix)
        if src.exists():
            shutil.copytree(src, dest, dirs_exist_ok=True)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def design_key(digest: str) -> str:
    """원본은 내용 해시로 주소를 잡는다. 같은 파일을 두 번 올려도 하나만 남는다."""
    return f"design/{digest[:2]}/{digest}.hkp"


def geometry_key(revision_id: str, layer_index: int) -> str:
    return f"blg/{revision_id}/L{layer_index}.blg"


def default_store() -> FileSystemStore:
    return FileSystemStore(os.environ.get("BOARDLENS_BLOB_ROOT", "./var/blobs"))
