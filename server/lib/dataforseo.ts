import { debugLog, isDebugMode } from "./debug";

const BASE_URL = "https://api.dataforseo.com/v3";

function getCredentials() {
  return {
    login: process.env.DATAFORSEO_LOGIN,
    password: process.env.DATAFORSEO_PASSWORD,
  };
}

function getAuthHeader(): string {
  const { login, password } = getCredentials();
  if (!login || !password) {
    throw new Error("DataForSEO credentials not configured. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to secrets.");
  }
  const credentials = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${credentials}`;
}

export function isDataForSEOConfigured(): boolean {
  const { login, password } = getCredentials();
  return !!(login && password);
}

async function makeRequest(endpoint: string, data?: any[]): Promise<any> {
  const url = `${BASE_URL}${endpoint}`;
  const options: RequestInit = {
    method: data ? "POST" : "GET",
    headers: {
      "Authorization": getAuthHeader(),
      "Content-Type": "application/json",
    },
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  debugLog("dataforseo", `Request: ${options.method} ${endpoint}`);

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    debugLog("dataforseo", `Error response: ${response.status} - ${errorText}`);
    
    if (response.status === 401) {
      throw new Error("DataForSEO API authentication failed. Check your DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.");
    }
    throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  debugLog("dataforseo", `Response status_code: ${result.status_code}, tasks: ${result.tasks?.length || 0}`);
  
  if (isDebugMode()) {
    debugLog("dataforseo", `Full response: ${JSON.stringify(result).substring(0, 2000)}`);
  }

  return result;
}

export interface DataForSEOKeyword {
  keyword: string;
  searchVolume: number;
  cpc: number;
  competition: number;
  competitionLevel: string;
  trend: number[];
}

export interface DataForSEOBacklink {
  url: string;
  anchor: string;
  domainRank: number;
  pageRank: number;
  isDofollow: boolean;
  firstSeen: string;
}

export interface DataForSEODomainMetrics {
  domain: string;
  domainRank: number;
  organicTraffic: number;
  organicKeywords: number;
  backlinks: number;
  referringDomains: number;
}

export async function getKeywordData(keywords: string[], location: string = "United States"): Promise<DataForSEOKeyword[]> {
  if (!isDataForSEOConfigured()) {
    throw new Error("DataForSEO not configured");
  }

  if (!keywords || keywords.length === 0) {
    throw new Error("At least one keyword is required");
  }

  const data = [{
    keywords: keywords,
    location_name: location,
    language_name: "English",
  }];

  try {
    const result = await makeRequest("/keywords_data/google_ads/search_volume/live", data);
    
    if (result.tasks?.[0]?.result) {
      return result.tasks[0].result.map((item: any) => ({
        keyword: item.keyword,
        searchVolume: item.search_volume || 0,
        cpc: item.cpc || 0,
        competition: item.competition || 0,
        competitionLevel: item.competition_level || "N/A",
        trend: item.monthly_searches?.map((m: any) => m.search_volume) || [],
      }));
    }
    return [];
  } catch (error) {
    console.error("DataForSEO keyword data error:", error);
    throw error;
  }
}

export async function getDomainBacklinks(domain: string, limit: number = 100): Promise<DataForSEOBacklink[]> {
  if (!isDataForSEOConfigured()) {
    throw new Error("DataForSEO not configured");
  }

  if (!domain || domain.trim() === "") {
    throw new Error("Domain is required for getDomainBacklinks");
  }

  const data = [{
    target: domain,
    limit: limit,
    order_by: ["rank,desc"],
    filters: ["dofollow", "=", true],
  }];

  try {
    const result = await makeRequest("/backlinks/backlinks/live", data);
    
    if (result.tasks?.[0]?.result?.[0]?.items) {
      return result.tasks[0].result[0].items.map((item: any) => ({
        url: item.url_from || "",
        anchor: item.anchor || "",
        domainRank: item.domain_from_rank || 0,
        pageRank: item.page_from_rank || 0,
        isDofollow: item.dofollow || false,
        firstSeen: item.first_seen || "",
      }));
    }
    return [];
  } catch (error) {
    console.error("DataForSEO backlinks error:", error);
    throw error;
  }
}

export async function getDomainMetrics(domain: string): Promise<DataForSEODomainMetrics | null> {
  if (!isDataForSEOConfigured()) {
    throw new Error("DataForSEO not configured");
  }

  if (!domain || domain.trim() === "") {
    throw new Error("Domain is required for getDomainMetrics");
  }

  const data = [{
    target: domain,
  }];

  try {
    const result = await makeRequest("/backlinks/summary/live", data);
    
    if (result.tasks?.[0]?.result?.[0]) {
      const item = result.tasks[0].result[0];
      return {
        domain: domain,
        domainRank: item.rank || 0,
        organicTraffic: item.organic_traffic || 0,
        organicKeywords: item.organic_keywords_count || 0,
        backlinks: item.backlinks || 0,
        referringDomains: item.referring_domains || 0,
      };
    }
    return null;
  } catch (error) {
    console.error("DataForSEO domain metrics error:", error);
    throw error;
  }
}

export async function getSerpResults(keyword: string, location: string = "United States"): Promise<any[]> {
  if (!isDataForSEOConfigured()) {
    throw new Error("DataForSEO not configured");
  }

  if (!keyword || keyword.trim() === "") {
    throw new Error("Keyword is required for getSerpResults");
  }

  const data = [{
    keyword: keyword,
    location_name: location,
    language_name: "English",
    device: "desktop",
    os: "windows",
  }];

  try {
    const result = await makeRequest("/serp/google/organic/live/regular", data);
    
    if (result.tasks?.[0]?.result?.[0]?.items) {
      return result.tasks[0].result[0].items
        .filter((item: any) => item.type === "organic")
        .map((item: any, index: number) => ({
          position: item.rank_absolute || index + 1,
          url: item.url || "",
          title: item.title || "",
          description: item.description || "",
          domain: item.domain || "",
        }));
    }
    return [];
  } catch (error) {
    console.error("DataForSEO SERP error:", error);
    throw error;
  }
}

export async function getReferringDomains(domain: string, limit: number = 100): Promise<any[]> {
  if (!isDataForSEOConfigured()) {
    throw new Error("DataForSEO not configured");
  }

  if (!domain || domain.trim() === "") {
    throw new Error("Domain is required for getReferringDomains");
  }

  const data = [{
    target: domain,
    limit: limit,
    order_by: ["rank,desc"],
  }];

  try {
    const result = await makeRequest("/backlinks/referring_domains/live", data);
    
    if (result.tasks?.[0]?.result?.[0]?.items) {
      return result.tasks[0].result[0].items.map((item: any) => ({
        domain: item.domain || "",
        rank: item.rank || 0,
        backlinks: item.backlinks || 0,
        firstSeen: item.first_seen || "",
        lostDate: item.lost_date || null,
      }));
    }
    return [];
  } catch (error) {
    console.error("DataForSEO referring domains error:", error);
    throw error;
  }
}

// DataForSEO Labs Endpoints (Primary for SEO Data)

export async function getDomainRankings(domain: string, limit: number = 100): Promise<any[]> {
  if (!isDataForSEOConfigured()) throw new Error("DataForSEO not configured");
  
  const data = [{
    target: domain,
    limit: limit,
    order_by: ["metrics.organic.etv,desc"],
  }];

  try {
    const result = await makeRequest("/dataforseo_labs/google/ranked_keywords/live", data);
    if (result.tasks?.[0]?.result?.[0]?.items) {
      return result.tasks[0].result[0].items.map((item: any) => ({
        keyword: item.keyword_data?.keyword || "",
        position: item.ranked_keywords?.[0]?.rank_absolute || 0,
        searchVolume: item.keyword_data?.keyword_info?.search_volume || 0,
        cpc: item.keyword_data?.keyword_info?.cpc || 0,
        url: item.ranked_keywords?.[0]?.url || "",
        estimatedTraffic: item.metrics?.organic?.etv || 0,
      }));
    }
    return [];
  } catch (error) {
    console.error("DataForSEO rankings error:", error);
    return [];
  }
}

export async function getDomainTopPages(domain: string, limit: number = 10): Promise<any[]> {
  if (!isDataForSEOConfigured()) throw new Error("DataForSEO not configured");

  const data = [{
    target: domain,
    limit: limit,
    order_by: ["metrics.organic.etv,desc"],
  }];

  try {
    const result = await makeRequest("/dataforseo_labs/google/relevant_pages/live", data);
    if (result.tasks?.[0]?.result?.[0]?.items) {
      return result.tasks[0].result[0].items.map((item: any) => ({
        page: item.page_address || "",
        estimatedTraffic: item.metrics?.organic?.etv || 0,
        keywordsCount: item.metrics?.organic?.count || 0,
      }));
    }
    return [];
  } catch (error) {
    console.error("DataForSEO top pages error:", error);
    return [];
  }
}

export async function getDomainCompetitors(domain: string, limit: number = 5): Promise<any[]> {
  if (!isDataForSEOConfigured()) throw new Error("DataForSEO not configured");

  const data = [{
    target: domain,
    limit: limit,
  }];

  try {
    const result = await makeRequest("/dataforseo_labs/google/competitors_domain/live", data);
    if (result.tasks?.[0]?.result?.[0]?.items) {
      return result.tasks[0].result[0].items.map((item: any) => ({
        domain: item.domain || "",
        intersection: item.intersections || 0,
        competitorMetrics: item.competitor_metrics?.organic || {},
      }));
    }
    return [];
  } catch (error) {
    console.error("DataForSEO competitors error:", error);
    return [];
  }
}
