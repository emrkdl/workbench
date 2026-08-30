# PCB Design Workbench (BoardLens)

사내에 축적되는 PCB 설계 데이터(HKP)를 한곳에 적재하고, 웹에서 레이아웃을 열람하며,
리비전 간 변경을 기계적으로 비교하는 온프렘 시스템.

전체 설계는 [docs/design-spec.html](docs/design-spec.html) 을 볼 것. 아키텍처, 데이터 모델,
Diff 엔진 매칭 규칙, 폐쇄망 배포 방식이 전부 거기 있다.

## 지금 상태

Phase 0~5 를 전부 만들었다. **단 하나 비어 있는 것은 HKP 문법 자체**다 — 실물 파일을
받지 못했고, 문법을 추측해서 채우면 없는 것을 있는 것처럼 보이게 만드는 셈이라 그렇게 하지
않았다. 그 외의 경로(정규화·검증·적재·비교·화면·배포)는 전부 실제로 동작하며,
`cdm-json` 어댑터로 끝에서 끝까지 검증되어 있다.

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | CDM v1 스키마 + Pydantic·TypeScript 코드 생성 | ✅ |
| 0 | 목데이터 생성기 (보드 30 · 리비전 67 · 부품 57,356) | ✅ |
| 1 | 카탈로그 · 리비전 상세 7탭 | ✅ |
| 2 | 2D 뷰어 — **배치도**(부품 몸통·계열색·RefDes) + **동박**(.blg / WebGL2) | ✅ |
| 3 | Diff 엔진 + 비교 화면 4탭 | ✅ |
| 4 | 인사이트 · 부품 역검색 (부품 699종, 재사용률 67%) | ✅ |
| 5 | DB · 인제스트 · REST API · 권한 · 감사 · 배포 | ✅ |
| 5 | **HKP 문법** | ⬜ 실물 대기 |

### 두 가지 모드

프론트는 같은 코드로 두 곳을 본다:

```bash
npm run dev                                  # 목데이터 (기본)
VITE_API_BASE=http://localhost:8000 npm run dev   # 실제 bl-core
```

두 모드가 같은 계약을 지키는지는 `backend/tests/test_api.py` 가 지킨다.

## 구조

```
cdm/schema/          CDM·API 스키마 — 단일 정의(single source of truth)
cdm/codegen/         스키마 → Pydantic + TypeScript 생성기 (표준 라이브러리만 사용)
backend/boardlens/
  cdm/               생성된 모델 — 직접 고치지 말 것
  ingest/            인제스트 집계. 목데이터와 실제 파서가 공유하는 실코드
  units.py           단위 규약 (정수 나노미터)
tools/mockgen/       CDM Design 문서를 만들고 집계를 태워 API 픽스처를 뽑는다
web/                 React + TypeScript + Vite
```

## 실행

### 목데이터로 보기

```bash
python cdm/codegen/generate.py     # 스키마를 고쳤을 때만
python tools/mockgen/main.py       # → web/public/mock/
cd web && npm install && npm run dev
```

### 실제 백엔드로 보기

```bash
cd backend && pip install -e ".[dev]"
export BOARDLENS_DATABASE_URL="postgresql+psycopg://boardlens:...@localhost/boardlens"
export BOARDLENS_BLOB_ROOT=./var/blobs BOARDLENS_SECRET="$(openssl rand -hex 32)"

alembic upgrade head
python -m boardlens user admin --role admin --password ...
python -m boardlens ingest "boardlens/parser/fixtures/*.cdm.json"        --geometry-root ../web/public/mock
python -m boardlens serve

cd ../web && VITE_API_BASE=http://localhost:8000 npm run dev
```

`python -m boardlens status` 로 적재 현황을, `python -m boardlens worker` 로 큐를 돌린다.

### 시험

```bash
cd backend && python -m pytest      # 파서 골든 픽스처 · 인제스트 · API 계약 · 권한
cd web && npm run typecheck && npm run build
```

### 폐쇄망 배포

```bash
./deploy/bundle.sh 0.1.0     # 인터넷 되는 PC 에서 한 번
# → dist/boardlens-0.1.0.tar.gz 를 반입하고 서버에서 docker load + compose up
```

## 규칙

- **모델은 스키마에서만 나온다.** `backend/boardlens/cdm/` 과 `web/src/lib/cdm/` 은 생성물이다.
  고쳐야 하면 `cdm/schema/*.json` 을 고치고 `generate.py` 를 다시 돌린다.
  CI에서는 `python cdm/codegen/generate.py --check` 로 어긋남을 잡는다.
- **길이는 전부 정수 나노미터(nm), 각도는 1/1000도(mdeg).** mm·mil 변환은 화면에 찍기
  직전에만 한다. 부동소수로 두면 리비전 비교에서 안 움직인 부품이 "이동함"으로 잡힌다.
- **회로 연결은 `Net.pins` 한 곳에서만 선언한다.** 핀 쪽에 넷을 달아 두 곳에 두면 어긋난다.
- **뷰어는 두 그림을 그린다.** 배치도(부품 몸통)와 동박(패드·배선·플레인)은 답하는 질문이
  다르다 — "무엇이 어디 있나" 대 "어떻게 이어졌나". 사내 배치 도구(`D:/auto_place`)와 같은
  계열색을 써서, 두 화면을 오가는 사람이 색을 다시 배우지 않아도 되게 했다.
- **라우팅 배색과 형태는 사내 라우팅 엔진(`D:/PCB_auto_route`)의 뷰어를 따른다.** 배선 색은
  층 번호가 정하고(L1 빨강 … L6 파랑), 비아는 색이 **종류**를 말하는 도넛이다 — 바깥은 패드,
  안쪽은 뚫린 구멍. 같은 보드를 두 도구에서 보는 사람이 색을 다시 배우지 않아도 된다.
- **동박은 종류별로 그린다 — 층 순서가 아니라.** 플레인 전부 → 배선 전부 → 패드 전부 →
  비아 전부. 층 순서대로 그리면 위층 플레인이 아래층 배선을 통째로 덮어 라우팅이 사라진다.
- **SVG 좌표에 나노미터 원값을 넣지 않는다.** 보드 하나가 1억 단위라 렌더러가 원(circle)을
  약 2²⁵에서 잘라버린다 — 폴리곤은 멀쩡히 그려지는데 점만 좌상단에 뭉치는 형태로 나타나
  타입 검사로도 빌드로도 안 잡힌다. 표시 좌표계는 긴 변을 1000으로 정규화해서 쓴다.
- **폐쇄망 전제.** 런타임에 외부 CDN·웹폰트를 참조하지 않는다. 빌드 산출물이 외부를
  가리키지 않는지 확인할 것.

## HKP 파서를 붙이려면

`backend/boardlens/parser/hkp.py` 의 `SECTIONS` 표와 레코드 핸들러만 채우면 된다.
문법과 무관한 부분 — 줄 단위 섹션 디스패치, 라인 번호를 실은 오류 보고, 단위 변환,
원점 정규화, 스키마 검증, 골든 픽스처 대조 — 는 이미 있다. CDM 이 확정되어 있으므로
DB·API·화면 어느 쪽도 바뀌지 않는다.

확인이 필요한 것:

1. **배선 기하가 파일에 들어 있는가** — 없으면 뷰어를 거버 기반으로 다시 설계해야 한다
2. 섹션 구조와 머리말 표기
3. 길이 단위와 원점 규약

나머지 미해결 항목은 설계 문서 §13 참조.
