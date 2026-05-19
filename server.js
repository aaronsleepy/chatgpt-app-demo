import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const gigWidgetHtml = readFileSync("public/gig-search-widget.html", "utf8");
const sellerWidgetHtml = readFileSync(
  "public/seller-search-widget.html",
  "utf8"
);

const KMONG_API = "https://api.kmong.com";
const KMONG_HEADERS = {
  accept: "application/json",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
};

const GIG_WIDGET_URI = "ui://widget/gig-search.html";
const SELLER_WIDGET_URI = "ui://widget/seller-search.html";

async function fetchJson(url) {
  const res = await fetch(url, { headers: KMONG_HEADERS });
  if (!res.ok) {
    throw new Error(`Kmong API ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

function pick(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

function normalizeGigListItem(raw) {
  const seller = raw.seller ?? raw.user ?? {};
  return {
    gigId: Number(raw.gigId ?? raw.gig_id ?? raw.id ?? 0),
    title: String(raw.title ?? raw.gigTitle ?? ""),
    price: Number(raw.price ?? raw.minPrice ?? 0),
    thumbnail: String(
      raw.thumbnail ?? raw.thumbnailUrl ?? raw.mainImage ?? raw.image ?? ""
    ),
    reviewAverage: Number(
      raw.reviewAverage ?? raw.ratingsAverage ?? raw.rating ?? 0
    ),
    reviewCount: Number(raw.reviewCount ?? raw.ratingsCount ?? 0),
    isPrime: Boolean(raw.isPrime ?? raw.prime ?? false),
    categoryName: String(
      raw.categoryName ?? raw.category?.name ?? raw.subCategoryName ?? ""
    ),
    seller: {
      nickname: String(seller.nickname ?? seller.userNickname ?? ""),
      grade: String(seller.grade ?? seller.sellerGrade ?? ""),
      thumbnail: String(
        seller.thumbnail ?? seller.profileImage ?? seller.thumbnailUrl ?? ""
      ),
    },
  };
}

function extractList(payload, keys = ["gigs", "items", "list", "data"]) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function searchGigs(keyword) {
  const params = new URLSearchParams({
    keyword,
    isPrime: "false",
    isFastReaction: "false",
    isCompany: "false",
    isNowContactable: "false",
    hasPortfolios: "false",
    page: "1",
    perPage: "10",
    sortType: "SCORE",
    service: "web",
    q: keyword,
  });
  const url = `${KMONG_API}/gig-app/gig/v1/gigs/search?${params.toString()}`;
  const payload = await fetchJson(url);
  const list = extractList(payload, ["gigs", "items", "list", "data"]).slice(
    0,
    10
  );
  return list.map(normalizeGigListItem);
}

function normalizeGigDetail(payload, gigId) {
  const root = payload?.data ?? payload ?? {};
  const modules = Array.isArray(root.modules) ? root.modules : [];
  const moduleByType = {};
  for (const m of modules) {
    if (m && typeof m === "object" && m.type) {
      moduleByType[m.type] = m;
    }
  }

  const head =
    moduleByType.HEAD?.data ??
    moduleByType.GIG_HEAD?.data ??
    moduleByType.TITLE?.data ??
    root.head ??
    {};
  const images =
    moduleByType.IMAGES?.data?.images ??
    moduleByType.IMAGE?.data?.images ??
    head.images ??
    root.images ??
    [];
  const sellerSrc =
    moduleByType.SELLER?.data ??
    moduleByType.SELLER_INFO?.data ??
    root.seller ??
    head.seller ??
    {};
  const packagesSrc =
    moduleByType.PACKAGE?.data?.packages ??
    moduleByType.PACKAGES?.data?.packages ??
    root.packages ??
    [];
  const descriptionHtml =
    moduleByType.DESCRIPTION?.data?.description ??
    moduleByType.GIG_DESCRIPTION?.data?.description ??
    root.description ??
    "";
  const categoryBreadcrumb =
    moduleByType.CATEGORY?.data?.breadcrumb ??
    head.categoryBreadcrumb ??
    root.categoryBreadcrumb ??
    [];

  const packagesObj = { STANDARD: null, DELUXE: null, PREMIUM: null };
  const normalizedPackages = Array.isArray(packagesSrc) ? packagesSrc : [];
  for (const pkg of normalizedPackages) {
    const key = String(pkg.type ?? pkg.name ?? "").toUpperCase();
    if (packagesObj[key] !== undefined) {
      packagesObj[key] = {
        price: Number(pkg.price ?? 0),
        days: Number(pkg.days ?? pkg.deliveryDays ?? 0),
        description: String(pkg.description ?? pkg.summary ?? ""),
      };
    }
  }

  const mainImage = String(
    head.mainImage ?? images?.[0]?.url ?? images?.[0] ?? ""
  );
  const normalizedImages = (Array.isArray(images) ? images : [])
    .map((img) => (typeof img === "string" ? img : img?.url ?? ""))
    .filter(Boolean);

  return {
    gigId: Number(head.gigId ?? root.gigId ?? gigId),
    title: String(head.title ?? root.title ?? ""),
    price: Number(head.price ?? root.price ?? 0),
    mainImage,
    images: normalizedImages,
    seller: {
      userId: Number(sellerSrc.userId ?? sellerSrc.id ?? 0),
      nickname: String(sellerSrc.nickname ?? sellerSrc.userNickname ?? ""),
      thumbnail: String(
        sellerSrc.thumbnail ?? sellerSrc.profileImage ?? ""
      ),
      grade: String(sellerSrc.grade ?? sellerSrc.sellerGrade ?? ""),
      ratingsAverage: Number(
        sellerSrc.ratingsAverage ?? sellerSrc.reviewAverage ?? 0
      ),
      ratingsCount: Number(
        sellerSrc.ratingsCount ?? sellerSrc.reviewCount ?? 0
      ),
      sellerDescription: String(
        sellerSrc.sellerDescription ?? sellerSrc.description ?? ""
      ),
    },
    packages: packagesObj,
    reviewAverage: Number(
      head.reviewAverage ?? head.ratingsAverage ?? root.reviewAverage ?? 0
    ),
    reviewCount: Number(
      head.reviewCount ?? head.ratingsCount ?? root.reviewCount ?? 0
    ),
    categoryBreadcrumb: (Array.isArray(categoryBreadcrumb)
      ? categoryBreadcrumb
      : []
    ).map((c) => (typeof c === "string" ? c : String(c?.name ?? ""))),
    descriptionHtml: String(descriptionHtml ?? ""),
    webUrl: `https://kmong.com/gig/${gigId}`,
  };
}

async function getGigDetail(gigId) {
  const url = `${KMONG_API}/gig-app/gig/v1/gigs/${gigId}/detail-modules`;
  const payload = await fetchJson(url);
  return normalizeGigDetail(payload, gigId);
}

function normalizeSellerListItem(raw) {
  return {
    nickname: String(raw.nickname ?? raw.userNickname ?? ""),
    thumbnail: String(
      raw.thumbnail ?? raw.profileImage ?? raw.thumbnailUrl ?? ""
    ),
    grade: String(raw.grade ?? raw.sellerGrade ?? ""),
    description: String(raw.description ?? raw.shortDescription ?? ""),
    specialties: (Array.isArray(raw.specialties)
      ? raw.specialties
      : Array.isArray(raw.tags)
        ? raw.tags
        : []
    )
      .map((s) => (typeof s === "string" ? s : String(s?.name ?? "")))
      .filter(Boolean)
      .slice(0, 5),
    reviewAverage: Number(raw.reviewAverage ?? raw.ratingsAverage ?? 0),
    reviewCount: Number(raw.reviewCount ?? raw.ratingsCount ?? 0),
    completedOrderCount: Number(
      raw.completedOrderCount ?? raw.finishedOrderCount ?? 0
    ),
    responseTime: String(raw.responseTime ?? raw.averageResponseTime ?? ""),
    area: String(raw.area ?? raw.activityArea ?? ""),
  };
}

async function searchSellers(keyword) {
  const params = new URLSearchParams({
    keyword,
    page: "1",
    perPage: "10",
    sortType: "SCORE",
    service: "web",
    q: keyword,
  });
  const url = `${KMONG_API}/gig-app/seller-profile/v2/seller-profiles/search?${params.toString()}`;
  const payload = await fetchJson(url);
  const list = extractList(payload, [
    "sellers",
    "sellerProfiles",
    "items",
    "list",
    "data",
  ]).slice(0, 10);
  return list.map(normalizeSellerListItem);
}

function normalizeSellerDetail(payload, nickname) {
  const root = payload?.data ?? payload ?? {};
  const sellerInfo = root.sellerInfo ?? root.seller ?? root;
  const profileInfo = root.profileInfo ?? root.profile ?? root;

  const toStringArray = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((v) => (typeof v === "string" ? v : String(v?.name ?? v?.title ?? "")))
      .filter(Boolean);

  const careers = toStringArray(profileInfo.careers ?? profileInfo.career);
  const educations = toStringArray(
    profileInfo.educations ?? profileInfo.education
  );
  const specialties = toStringArray(
    profileInfo.specialties ?? sellerInfo.specialties
  );
  const skills = toStringArray(profileInfo.skills ?? sellerInfo.skills);

  return {
    nickname: String(
      sellerInfo.nickname ?? sellerInfo.userNickname ?? nickname
    ),
    thumbnail: String(
      sellerInfo.thumbnail ?? sellerInfo.profileImage ?? ""
    ),
    grade: String(sellerInfo.grade ?? sellerInfo.sellerGrade ?? ""),
    area: String(
      profileInfo.area ?? profileInfo.activityArea ?? sellerInfo.area ?? ""
    ),
    description: String(
      profileInfo.description ??
        profileInfo.sellerDescription ??
        sellerInfo.description ??
        ""
    ),
    ratingsAverage: Number(
      sellerInfo.ratingsAverage ?? sellerInfo.reviewAverage ?? 0
    ),
    ratingsCount: Number(
      sellerInfo.ratingsCount ?? sellerInfo.reviewCount ?? 0
    ),
    satisfaction: Number(
      sellerInfo.satisfaction ?? sellerInfo.satisfactionRate ?? 0
    ),
    responseTime: String(
      sellerInfo.responseTime ?? sellerInfo.averageResponseTime ?? ""
    ),
    completedOrderCount: Number(
      sellerInfo.completedOrderCount ?? sellerInfo.finishedOrderCount ?? 0
    ),
    careerYears: Number(profileInfo.careerYears ?? 0),
    specialties,
    skills,
    careers,
    educations,
    webUrl: `https://kmong.com/@${encodeURIComponent(nickname)}`,
  };
}

async function getSellerDetail(nickname) {
  const url = `${KMONG_API}/gig-app/seller-profile/v1/seller-profiles?sellerNickname=${encodeURIComponent(
    nickname
  )}`;
  const payload = await fetchJson(url);
  return normalizeSellerDetail(payload, nickname);
}

const gigListItemSchema = z.object({
  gigId: z.number(),
  title: z.string(),
  price: z.number(),
  thumbnail: z.string(),
  reviewAverage: z.number(),
  reviewCount: z.number(),
  isPrime: z.boolean(),
  categoryName: z.string(),
  seller: z.object({
    nickname: z.string(),
    grade: z.string(),
    thumbnail: z.string(),
  }),
});

const gigSearchOutputSchema = {
  view: z.literal("list"),
  keyword: z.string(),
  gigs: z.array(gigListItemSchema),
};

const packageSchema = z
  .object({
    price: z.number(),
    days: z.number(),
    description: z.string(),
  })
  .nullable();

const gigDetailOutputSchema = {
  view: z.literal("detail"),
  gig: z.object({
    gigId: z.number(),
    title: z.string(),
    price: z.number(),
    mainImage: z.string(),
    images: z.array(z.string()),
    seller: z.object({
      userId: z.number(),
      nickname: z.string(),
      thumbnail: z.string(),
      grade: z.string(),
      ratingsAverage: z.number(),
      ratingsCount: z.number(),
      sellerDescription: z.string(),
    }),
    packages: z.object({
      STANDARD: packageSchema,
      DELUXE: packageSchema,
      PREMIUM: packageSchema,
    }),
    reviewAverage: z.number(),
    reviewCount: z.number(),
    categoryBreadcrumb: z.array(z.string()),
    descriptionHtml: z.string(),
    webUrl: z.string(),
  }),
};

const sellerListItemSchema = z.object({
  nickname: z.string(),
  thumbnail: z.string(),
  grade: z.string(),
  description: z.string(),
  specialties: z.array(z.string()),
  reviewAverage: z.number(),
  reviewCount: z.number(),
  completedOrderCount: z.number(),
  responseTime: z.string(),
  area: z.string(),
});

const sellerSearchOutputSchema = {
  view: z.literal("list"),
  keyword: z.string(),
  sellers: z.array(sellerListItemSchema),
};

const sellerDetailOutputSchema = {
  view: z.literal("detail"),
  seller: z.object({
    nickname: z.string(),
    thumbnail: z.string(),
    grade: z.string(),
    area: z.string(),
    description: z.string(),
    ratingsAverage: z.number(),
    ratingsCount: z.number(),
    satisfaction: z.number(),
    responseTime: z.string(),
    completedOrderCount: z.number(),
    careerYears: z.number(),
    specialties: z.array(z.string()),
    skills: z.array(z.string()),
    careers: z.array(z.string()),
    educations: z.array(z.string()),
    webUrl: z.string(),
  }),
};

function textReply(structured, message) {
  return {
    content: message ? [{ type: "text", text: message }] : [],
    structuredContent: structured,
  };
}

function errorReply(widgetView, message) {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: widgetView,
    isError: true,
  };
}

function createKmongServer() {
  const server = new McpServer({ name: "kmong-gpt-app", version: "0.1.0" });

  registerAppResource(
    server,
    "gig-search-widget",
    GIG_WIDGET_URI,
    {},
    async () => ({
      contents: [
        {
          uri: GIG_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: gigWidgetHtml,
        },
      ],
    })
  );

  registerAppResource(
    server,
    "seller-search-widget",
    SELLER_WIDGET_URI,
    {},
    async () => ({
      contents: [
        {
          uri: SELLER_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: sellerWidgetHtml,
        },
      ],
    })
  );

  registerAppTool(
    server,
    "search_gigs",
    {
      title: "크몽 서비스 검색",
      description:
        "키워드로 크몽의 서비스(gig)를 검색하여 상위 10개를 카드 그리드로 보여줍니다.",
      inputSchema: { keyword: z.string().min(1) },
      outputSchema: gigSearchOutputSchema,
      _meta: { ui: { resourceUri: GIG_WIDGET_URI } },
    },
    async (args) => {
      const keyword = args?.keyword?.trim?.() ?? "";
      const emptyView = { view: "list", keyword, gigs: [] };
      if (!keyword) {
        return errorReply(emptyView, "검색 키워드가 비어 있습니다.");
      }
      try {
        const gigs = await searchGigs(keyword);
        return textReply(
          { view: "list", keyword, gigs },
          `'${keyword}' 키워드로 ${gigs.length}개의 서비스를 찾았어요.`
        );
      } catch (error) {
        console.error("search_gigs failed:", error);
        return errorReply(
          emptyView,
          `서비스 검색에 실패했어요: ${error.message}`
        );
      }
    }
  );

  registerAppTool(
    server,
    "get_gig_detail",
    {
      title: "크몽 서비스 상세",
      description: "선택한 서비스의 상세 정보를 같은 위젯에 보여줍니다.",
      inputSchema: { gigId: z.number().int().positive() },
      outputSchema: gigDetailOutputSchema,
      _meta: { ui: { resourceUri: GIG_WIDGET_URI } },
    },
    async (args) => {
      const gigId = Number(args?.gigId);
      if (!Number.isFinite(gigId) || gigId <= 0) {
        return errorReply(
          { view: "detail", gig: null },
          "유효한 gigId가 필요합니다."
        );
      }
      try {
        const gig = await getGigDetail(gigId);
        return textReply(
          { view: "detail", gig },
          `'${gig.title}' 서비스 상세를 불러왔어요.`
        );
      } catch (error) {
        console.error("get_gig_detail failed:", error);
        return errorReply(
          { view: "detail", gig: null },
          `서비스 상세 조회에 실패했어요: ${error.message}`
        );
      }
    }
  );

  registerAppTool(
    server,
    "search_sellers",
    {
      title: "크몽 전문가 검색",
      description:
        "키워드로 크몽 전문가(seller)를 검색하여 상위 10명을 카드로 보여줍니다.",
      inputSchema: { keyword: z.string().min(1) },
      outputSchema: sellerSearchOutputSchema,
      _meta: { ui: { resourceUri: SELLER_WIDGET_URI } },
    },
    async (args) => {
      const keyword = args?.keyword?.trim?.() ?? "";
      const emptyView = { view: "list", keyword, sellers: [] };
      if (!keyword) {
        return errorReply(emptyView, "검색 키워드가 비어 있습니다.");
      }
      try {
        const sellers = await searchSellers(keyword);
        return textReply(
          { view: "list", keyword, sellers },
          `'${keyword}' 키워드로 ${sellers.length}명의 전문가를 찾았어요.`
        );
      } catch (error) {
        console.error("search_sellers failed:", error);
        return errorReply(
          emptyView,
          `전문가 검색에 실패했어요: ${error.message}`
        );
      }
    }
  );

  registerAppTool(
    server,
    "get_seller_detail",
    {
      title: "크몽 전문가 상세",
      description: "선택한 전문가의 프로필 상세를 같은 위젯에 보여줍니다.",
      inputSchema: { nickname: z.string().min(1) },
      outputSchema: sellerDetailOutputSchema,
      _meta: { ui: { resourceUri: SELLER_WIDGET_URI } },
    },
    async (args) => {
      const nickname = args?.nickname?.trim?.() ?? "";
      if (!nickname) {
        return errorReply(
          { view: "detail", seller: null },
          "유효한 nickname이 필요합니다."
        );
      }
      try {
        const seller = await getSellerDetail(nickname);
        return textReply(
          { view: "detail", seller },
          `'${seller.nickname}' 전문가 프로필을 불러왔어요.`
        );
      } catch (error) {
        console.error("get_seller_detail failed:", error);
        return errorReply(
          { view: "detail", seller: null },
          `전문가 상세 조회에 실패했어요: ${error.message}`
        );
      }
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res
      .writeHead(200, { "content-type": "text/plain" })
      .end("Kmong GPT App MCP server");
    return;
  }

  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createKmongServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(
    `Kmong GPT App MCP server listening on http://localhost:${port}${MCP_PATH}`
  );
});
