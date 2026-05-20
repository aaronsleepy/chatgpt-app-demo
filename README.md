# Kmong GPT App

크몽(kmong.com)의 서비스(gig)와 전문가(seller)를 ChatGPT 안에서 검색·열람할 수 있게 해주는 **MCP Apps** 서버 데모입니다. ChatGPT가 도구를 호출하면 서버가 크몽 공개 API를 호출해 데이터를 정규화하고, 동봉된 위젯(HTML)으로 카드 그리드와 상세 화면을 렌더링합니다.

## 기능

- `search_gigs` — 키워드로 크몽 서비스 상위 10개 검색
- `get_gig_detail` — 선택한 gigId의 상세 정보 조회
- `search_sellers` — 키워드로 크몽 전문가 상위 10명 검색
- `get_seller_detail` — 선택한 nickname의 전문가 프로필 조회

각 도구는 결과를 두 개의 인라인 위젯(서비스 검색 / 전문가 검색)에 list ↔ detail 뷰로 렌더링합니다.

## 요구 사항

- Node.js 20 이상
- 외부 네트워크 접근 (api.kmong.com, 이미지 CDN)

## 설치 및 실행

```bash
npm install
npm start
```

기본 포트는 `8787`이며 `PORT` 환경 변수로 변경할 수 있습니다.

```
Kmong GPT App MCP server listening on http://localhost:8787/mcp
```

- 헬스 체크: `GET /` → `Kmong GPT App MCP server`
- MCP 엔드포인트: `POST /mcp` (Streamable HTTP transport, JSON 응답 모드)

## 디렉토리 구조

```
.
├── server.js                          # MCP 서버, 도구/리소스 등록, 크몽 API 어댑터
├── public/
│   ├── gig-search-widget.html         # 서비스 검색/상세 위젯
│   └── seller-search-widget.html      # 전문가 검색/상세 위젯
├── package.json
└── README.md
```

## 동작 개요

1. ChatGPT가 MCP 엔드포인트(`/mcp`)로 `tools/call`을 보냄
2. `server.js`가 `api.kmong.com`을 호출해 검색/상세 데이터를 받음
3. 위젯 CSP에서 외부 이미지 로딩이 막히는 것을 우회하기 위해 썸네일·갤러리 이미지를 base64 data URI로 인라인 (LRU 캐시 500개)
4. 정규화된 `structuredContent`(`view: "list" | "detail"`)와 사용자에게 보여줄 텍스트를 함께 응답
5. 위젯이 같은 iframe 안에서 list ↔ detail 뷰를 전환하며 렌더링. 카드 클릭 시 위젯이 MCP Apps 브리지(`postMessage` JSON-RPC)로 `get_*_detail`을 호출

## 위젯 리소스

| URI | 용도 |
| --- | --- |
| `ui://widget/gig-search.html` | `search_gigs`, `get_gig_detail` 응답 렌더링 |
| `ui://widget/seller-search.html` | `search_sellers`, `get_seller_detail` 응답 렌더링 |

## 참고

- 크몽 공개 API 응답 구조는 변경될 수 있어 `server.js`의 `normalize*` 함수들이 여러 키 패턴을 fallback으로 처리합니다.
- 이 프로젝트는 ChatGPT의 MCP Apps 환경에서 동작하도록 만든 데모이며, 인증/세션이 필요한 API는 사용하지 않습니다.
