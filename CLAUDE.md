# CLAUDE.md

이 문서는 Claude Code가 이 저장소에서 작업할 때 참고할 컨텍스트입니다.

## 프로젝트 한 줄 요약

ChatGPT의 **MCP Apps**에서 호출되는 Node.js MCP 서버. 크몽의 공개 API(`api.kmong.com`)를 어댑팅해 서비스/전문가 검색·상세 조회 결과를 인라인 위젯(HTML)에 렌더링한다.

## 스택 / 의존성

- Node.js 20+, ESM (`"type": "module"`)
- `@modelcontextprotocol/sdk` — `McpServer`, `StreamableHTTPServerTransport`
- `@modelcontextprotocol/ext-apps` — `registerAppTool`, `registerAppResource`, `RESOURCE_MIME_TYPE`
- `zod` — 입력/출력 스키마
- 빌드 도구 없음. `node server.js`로 바로 실행.

## 실행

```bash
npm install
npm start              # PORT=8787 기본
PORT=9000 npm start
```

- 헬스: `GET /`
- MCP: `POST /mcp` (CORS 허용, `enableJsonResponse: true`, 세션 생성 안 함 — 매 요청마다 새 서버/트랜스포트)

## 아키텍처

```
ChatGPT ──(MCP, HTTP)──► server.js
                          ├─ fetchJson(api.kmong.com/...)
                          ├─ normalize*()  →  structuredContent
                          ├─ inlineImagesIn*()  →  base64 data URI (CSP 우회)
                          └─ 위젯 리소스 2종 등록 (ui://widget/...)
                                  ▲
                                  └ 위젯이 postMessage JSON-RPC로 tools/call
```

### 도구 / 위젯 매핑

| Tool | View | Widget URI |
| --- | --- | --- |
| `search_gigs(keyword)` | list | `ui://widget/gig-search.html` |
| `get_gig_detail(gigId)` | detail | `ui://widget/gig-search.html` |
| `search_sellers(keyword)` | list | `ui://widget/seller-search.html` |
| `get_seller_detail(nickname)` | detail | `ui://widget/seller-search.html` |

각 도구의 `outputSchema`는 `view: "list" | "detail"`을 discriminator로 사용하며, 같은 위젯이 두 뷰를 모두 렌더한다.

### 크몽 API 엔드포인트 (참고)

- 서비스 검색: `GET /gig-app/gig/v1/gigs/search?keyword=...&perPage=10&sortType=SCORE...`
- 서비스 상세: `GET /gig-app/gig/v1/gigs/{gigId}/detail-modules` — `data.TOP/LEFT/RIGHT/COMMON` 모듈 구조
- 전문가 검색: `GET /gig-app/seller-profile/v2/seller-profiles/search?...` — 응답 wrapper `sellerProfilePage.items[]`
- 전문가 상세: `GET /gig-app/seller-profile/v1/seller-profiles?sellerNickname=...`

요청에는 브라우저 user-agent와 `accept-language: ko-KR`을 함께 보낸다 (`KMONG_HEADERS`).

### 응답 정규화

`normalizeGigListItem`, `normalizeGigDetail`, `normalizeSellerListItem`, `normalizeSellerDetail` 네 함수가 API 응답을 위젯 스키마에 맞춰 평탄화한다. 크몽 API가 키를 자주 바꾸기 때문에 모든 필드는 여러 fallback 키를 `??` 체인으로 시도한다 (`raw.gigId ?? raw.gig_id ?? raw.id`). 이 fallback들을 함부로 줄이지 말 것.

`normalizeGigDetail`은 특히 까다롭다:
- `TOP[0]` 또는 `design_type === "HERO_SECTION_COMMON"`에서 타이틀/이미지 갤러리
- `RIGHT`의 `PACKAGE_PANEL`과 `COMMON.package`를 머지해서 STANDARD/DELUXE/PREMIUM 패키지 구성
- `LEFT`의 `TEXT_HTML` 모듈에서 상세 설명 HTML

### 이미지 인라인화

ChatGPT의 위젯 iframe CSP가 `img-src`를 제한해 크몽 CDN 이미지를 직접 표시하지 못한다. 모든 썸네일/메인 이미지/갤러리 이미지를 `toImageDataUri()`로 받아 base64 `data:` URI로 변환해 응답에 박는다.

- 캐시: `imageDataUriCache` — LRU, 최대 500개
- MIME 추정: response의 `content-type` 우선, 없으면 확장자(`.png/.webp/.gif/.svg`)로 추정, 기본 `image/jpeg`
- 실패 시 빈 문자열 반환 (위젯이 placeholder 처리)

### 위젯 → 서버 RPC

위젯은 다음 흐름으로 동작한다:

1. `window.parent.postMessage(...)` 로 `ui/initialize` 요청 후 `ui/notifications/initialized` 발송
2. 카드 클릭 시 `tools/call` 메서드로 `get_gig_detail` / `get_seller_detail` 호출
3. 호스트가 보내주는 `ui/notifications/tool-result` 이벤트로 list ↔ detail 전환
4. detail 뷰의 "← 목록으로" 버튼은 캐시된 list 상태로 복귀(서버 재호출 없음)

이 브리지 코드는 `gig-search-widget.html` / `seller-search-widget.html` 하단에 인라인되어 있다. SDK 없이 raw JSON-RPC로 구현되어 있으니 수정 시 양쪽 위젯에 같은 변경을 반영할 것.

## 관례

- **에러 처리**: 도구에서 외부 호출이 실패하면 빈 `view`(`{ view: "list", keyword, gigs: [] }` 등)와 사람 친화적 한국어 에러 메시지를 `errorReply`로 반환한다. 위젯이 `isError`를 보고 빨간 박스를 그리도록 설계되어 있다.
- **언어**: 사용자에게 보이는 텍스트(`textReply`의 두 번째 인자, 위젯 카피)는 한국어.
- **로깅**: `console.error`만 사용. 정상 흐름은 로그하지 않음.
- **세션 없음**: `sessionIdGenerator: undefined` — 매 요청에 새 `McpServer`/`Transport` 인스턴스를 만든다. 글로벌 상태(예: `imageDataUriCache`)는 모듈 스코프에 보관.

## 자주 하는 작업 가이드

- **검색 결과 개수 변경**: `searchGigs`/`searchSellers`의 `perPage`와 `.slice(0, 10)`을 함께 수정.
- **새 필드 추가**: `normalize*` → `zod` 스키마(`*OutputSchema`) → 위젯 렌더링 함수 세 곳을 모두 업데이트.
- **새 도구 추가**: `createKmongServer` 안에서 `registerAppTool` 호출. 같은 위젯을 재사용하려면 `_meta.ui.resourceUri`를 기존 URI로 지정.
- **위젯 디버깅**: 위젯은 ChatGPT iframe 안에서만 의미가 있다. 로컬에서 HTML을 그냥 열어보면 부모 메시지가 오지 않아 list 뷰가 빈 상태로만 보인다.
- **이미지 안 뜸**: 거의 항상 CSP 또는 크몽 CDN 응답 문제. `toImageDataUri` 로그 확인.

## 하지 말 것

- 비기능 리팩터링 PR(이름만 바꾸기 등)은 위젯/서버 양쪽 스키마를 깨기 쉬우니 피한다.
- 크몽 API에 인증 헤더를 붙이거나 비공개 엔드포인트로 바꾸지 말 것 — 이 데모는 공개 API만 사용한다.
- 위젯에 외부 스크립트/이미지 URL을 추가하지 말 것 (CSP에 막힘).
