"""인증·권한·감사.

PCB 설계 데이터는 회사의 핵심 자산이다. 폐쇄망이라는 사실이 접근 통제를 면제해 주지 않는다 —
망 안에 있는 사람이 전부 모든 프로젝트를 볼 자격이 있는 것은 아니다.

권한 경계는 **프로젝트**다. 보드 단위 예외는 두지 않는다. 관리 비용 대비 실효가 없고,
예외가 쌓이면 아무도 현재 상태를 모르게 된다.

인증 자체는 `AuthProvider` 뒤에 둔다. 지금은 로컬 계정이고, 사내 AD/LDAP 연동이 정해지면
구현체 하나만 갈아 끼운다.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from boardlens.db import models as m

ROLES = ("viewer", "engineer", "maintainer", "admin")
_RANK = {role: i for i, role in enumerate(ROLES)}

#: 각 동작에 필요한 최소 역할. 설계 문서 §10 의 표를 코드로 옮긴 것이다.
PERMISSIONS = {
    "board.read": "viewer",
    "revision.read": "viewer",
    "geometry.read": "viewer",
    "compare.read": "viewer",
    "file.download": "engineer",
    "comment.write": "engineer",
    "revision.upload": "maintainer",
    "revision.reparse": "maintainer",
    "revision.status": "maintainer",
    "user.manage": "admin",
    "audit.read": "admin",
}

TOKEN_TTL_SECONDS = 12 * 3600


@dataclass(frozen=True)
class Principal:
    id: str
    username: str
    display_name: str
    role: str
    projects: tuple[str, ...]

    def at_least(self, role: str) -> bool:
        return _RANK[self.role] >= _RANK[role]

    def can(self, action: str) -> bool:
        required = PERMISSIONS.get(action)
        return required is not None and self.at_least(required)

    def sees_project(self, project_key: str | None) -> bool:
        # 프로젝트가 비어 있는 사용자는 전 프로젝트 접근으로 본다 (관리자·초기 구축용).
        if not self.projects or self.role == "admin":
            return True
        return project_key in self.projects


class PermissionDenied(Exception):
    pass


# ── 비밀번호 ──────────────────────────────────


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False
    _, salt_b64, digest_b64 = stored.split("$", 2)
    expected = base64.b64decode(digest_b64)
    actual = hashlib.scrypt(
        password.encode(), salt=base64.b64decode(salt_b64), n=2**14, r=8, p=1, dklen=32
    )
    return hmac.compare_digest(expected, actual)


# ── 토큰 ──────────────────────────────────────


def _secret() -> bytes:
    # 배포 스크립트가 채운다. 없으면 프로세스마다 달라져 재시작 시 로그인이 풀린다 —
    # 조용히 도는 것보다 그 편이 낫다.
    return os.environ.get("BOARDLENS_SECRET", "").encode() or _EPHEMERAL


_EPHEMERAL = secrets.token_bytes(32)


def issue_token(user_id: str, *, ttl: int = TOKEN_TTL_SECONDS) -> str:
    payload = f"{user_id}:{int(time.time()) + ttl}"
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode()


def read_token(token: str) -> str | None:
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        user_id, expiry, sig = raw.rsplit(":", 2)
    except Exception:
        return None
    expected = hmac.new(_secret(), f"{user_id}:{expiry}".encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(sig, expected):
        return None
    if int(expiry) < time.time():
        return None
    return user_id


# ── 공급자 ────────────────────────────────────


class AuthProvider(Protocol):
    def authenticate(self, session: Session, username: str, password: str) -> Principal | None: ...
    def load(self, session: Session, user_id: str) -> Principal | None: ...


def _principal(user: m.AppUser) -> Principal:
    return Principal(
        id=user.id, username=user.username, display_name=user.display_name,
        role=user.role, projects=tuple(user.projects or []),
    )


class LocalAuthProvider:
    """DB 안의 로컬 계정. 사내 AD/LDAP 이 정해지면 이 자리에 다른 구현체가 들어온다."""

    name = "local"

    def authenticate(self, session: Session, username: str, password: str) -> Principal | None:
        user = session.scalar(select(m.AppUser).where(m.AppUser.username == username))
        if user is None or not user.active or not verify_password(password, user.password_hash):
            return None
        return _principal(user)

    def load(self, session: Session, user_id: str) -> Principal | None:
        user = session.get(m.AppUser, user_id)
        return _principal(user) if user is not None and user.active else None


PROVIDER: AuthProvider = LocalAuthProvider()


def ensure_user(
    session: Session,
    *,
    username: str,
    display_name: str,
    role: str = "viewer",
    password: str | None = None,
    projects: list[str] | None = None,
) -> m.AppUser:
    user = session.scalar(select(m.AppUser).where(m.AppUser.username == username))
    if user is None:
        user = m.AppUser(id=username, username=username, display_name=display_name, role=role)
        session.add(user)
    user.display_name = display_name
    user.role = role
    user.projects = projects or []
    if password:
        user.password_hash = hash_password(password)
    session.flush()
    return user


def audit(
    session: Session,
    principal: Principal | None,
    action: str,
    target_type: str,
    target_id: str,
    *,
    ip: str | None = None,
    detail: dict | None = None,
) -> None:
    """원본 다운로드·권한 변경·업로드는 예외 없이 남긴다."""
    session.add(
        m.AuditLog(
            actor=principal.username if principal else "anonymous",
            action=action, target_type=target_type, target_id=target_id,
            ip=ip, detail=detail or {},
        )
    )
