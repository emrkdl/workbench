#!/usr/bin/env bash
# 폐쇄망 반입 번들 만들기.
#
# 인터넷이 되는 개발 PC 에서 한 번 돌리면 tar 하나가 나온다. 그 tar 만 사내망으로
# 옮기면 서버는 인터넷을 한 번도 보지 않는다.
#
#   ./deploy/bundle.sh 0.1.0
#   → dist/boardlens-0.1.0.tar.gz
#
# 서버에서:
#   tar xzf boardlens-0.1.0.tar.gz && cd boardlens-0.1.0
#   docker load -i images.tar
#   cp .env.example .env && vi .env      # 비밀번호와 시크릿 채우기
#   docker compose up -d
set -euo pipefail

VERSION="${1:-0.1.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/boardlens-$VERSION"
rm -rf "$OUT" && mkdir -p "$OUT"

echo "== 1/5 모델·타입 생성 =="
python "$ROOT/cdm/codegen/generate.py"

echo "== 2/5 프론트 빌드 =="
# 같은 오리진에 얹으므로 API 주소는 상대 경로다. 빌드 산출물이 외부를 참조하지 않는지
# 아래 검사에서 확인한다.
( cd "$ROOT/web" && npm ci --offline --no-audit && VITE_API_BASE="" npm run build )

echo "== 3/5 외부 참조 검사 =="
if grep -rEl 'https?://(?!localhost)' "$ROOT/web/dist/assets" 2>/dev/null | head -1 | grep -q .; then
  echo "  빌드 산출물이 외부 주소를 참조합니다. 폐쇄망에서 깨집니다." >&2
  grep -rEoh 'https?://[^"'\'' )]+' "$ROOT/web/dist/assets" | sort -u | head -20 >&2
  exit 1
fi
echo "  외부 참조 없음"

echo "== 4/5 파이썬 휠 내려받기 =="
rm -rf "$ROOT/wheelhouse" && mkdir -p "$ROOT/wheelhouse"
pip download --dest "$ROOT/wheelhouse" "$ROOT/backend"

echo "== 5/5 이미지 빌드 및 저장 =="
docker build -f "$ROOT/deploy/Dockerfile.core" -t "boardlens/core:$VERSION" "$ROOT"
docker build -f "$ROOT/deploy/Dockerfile.web"  -t "boardlens/web:$VERSION"  "$ROOT"
docker save "boardlens/core:$VERSION" "boardlens/web:$VERSION" postgres:16-alpine -o "$OUT/images.tar"

cp "$ROOT/deploy/docker-compose.yml" "$OUT/"
cat > "$OUT/.env.example" <<ENV
# 서버에서 .env 로 복사해 채우세요.
BOARDLENS_VERSION=$VERSION
BOARDLENS_PORT=8080
POSTGRES_PASSWORD=
# openssl rand -hex 32 로 만드세요. 비우면 재시작할 때마다 로그인이 풀립니다.
BOARDLENS_SECRET=
ENV
cp "$ROOT/README.md" "$ROOT/docs/design-spec.html" "$OUT/" 2>/dev/null || true

tar czf "$ROOT/dist/boardlens-$VERSION.tar.gz" -C "$ROOT/dist" "boardlens-$VERSION"
echo
echo "완료: dist/boardlens-$VERSION.tar.gz"
du -h "$ROOT/dist/boardlens-$VERSION.tar.gz"
