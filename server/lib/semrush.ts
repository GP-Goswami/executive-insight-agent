import { debugLog, isDebugMode } from "./debug";

const SEMRUSH_API_BASE = "https://api.semrush.com/";

interface SemrushConfig {
  apiKey: string;
  database?: string;
}

interface DomainOverview {
  domain: string;
  organicKeywords: number;
  organicTraffic: number;
  organicCost: number;
  adwordsKeywords: number;
  adwordsTraffic: number;
  adwordsCost: number;
}

interface OrganicKeyword {
  keyword: string;
  position: number;
  previousPosition: number;
  positionDifference: number;
  searchVolume: number;
  cpc: number;
  url: string;
  trafficPercent: number;
  traffic: number;
  competition: number;
}

interface BacklinkOverview {
  totalBacklinks: number;
  referringDomains: number;
  referringIps: number;
  followLinks: number;
  nofollowLinks: number;
}

interface BacklinkData {
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  sourceTitle: string;
  firstSeen: string;
  lastSeen: string;
  type: string;
}

export class SemrushClient {
  private apiKey: string;
  private database: string;

  constructor(config: SemrushConfig) {
    this.apiKey = config.apiKey;
    this.database = config.database || "us";
  }

  private async request(params: Record<string, string>): Promise<string> {
    const queryParams = new URLSearchParams({
      key: this.apiKey,
      ...params,
    });

    const url = `${SEMRUSH_API_BASE}?${queryParams.toString()}`;
    
    debugLog("semrush", `Request: ${params.type} for ${params.domain || params.target || params.phrase || "unknown"}`);
    
    try {
      const response = await fetch(url);
      const text = await response.text();
      
      if (isDebugMode()) {
        debugLog("semrush", `Full response for ${params.type}: ${text.substring(0, 2000)}`);
      } else {
        debugLog("semrush", `Response for ${params.type}: ${text.substring(0, 200)}...`);
      }
      
      if (!response.ok) {
        throw new Error(`SEMrush API error: ${response.status} - ${text}`);
      }
      
      if (text.startsWith("ERROR")) {
        if (text.includes("NOTHING FOUND")) {
          throw new Error(`NOTHING FOUND: No data available for this query`);
        }
        if (text.includes("WRONG API KEY")) {
          throw new Error(`SEMrush API authentication failed. Check your SEMRUSH_API_KEY.`);
        }
        throw new Error(`SEMrush API error: ${text}`);
      }

      return text;
    } catch (error) {
      debugLog("semrush", `API error: ${error}`);
      throw error;
    }
  }

  private parseCSV(csv: string): Record<string, string>[] {
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].split(";").map(h => h.trim());
    const results: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(";");
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index]?.trim() || "";
      });
      results.push(row);
    }

    return results;
  }

  async getDomainOverview(domain: string): Promise<DomainOverview> {
    if (!domain || domain.trim() === "") {
      throw new Error("Domain is required for getDomainOverview");
    }

    const csv = await this.request({
      type: "domain_rank",
      domain: domain.trim(),
      database: this.database,
    });

    const rows = this.parseCSV(csv);
    if (rows.length === 0) {
      throw new Error(`No data found for domain: ${domain}`);
    }

    const row = rows[0];
    return {
      domain: row["Domain"] || row["Dn"] || domain,
      organicKeywords: parseInt(row["Organic Keywords"] || row["Or"] || "0"),
      organicTraffic: parseInt(row["Organic Traffic"] || row["Ot"] || "0"),
      organicCost: parseFloat(row["Organic Cost"] || row["Oc"] || "0"),
      adwordsKeywords: parseInt(row["Adwords Keywords"] || row["Ad"] || "0"),
      adwordsTraffic: parseInt(row["Adwords Traffic"] || row["At"] || "0"),
      adwordsCost: parseFloat(row["Adwords Cost"] || row["Ac"] || "0"),
    };
  }

  async getOrganicKeywords(
    domain: string,
    limit: number = 50
  ): Promise<OrganicKeyword[]> {
    if (!domain || domain.trim() === "") {
      throw new Error("Domain is required for getOrganicKeywords");
    }

    const csv = await this.request({
      type: "domain_organic",
      domain: domain.trim(),
      database: this.database,
      display_limit: limit.toString(),
    });

    const rows = this.parseCSV(csv);
    return rows.map((row) => ({
      keyword: row["Keyword"] || row["Ph"] || "",
      position: parseInt(row["Position"] || row["Po"] || "0"),
      previousPosition: parseInt(row["Previous Position"] || row["Pp"] || "0"),
      positionDifference: parseInt(row["Position Difference"] || row["Pd"] || "0"),
      searchVolume: parseInt(row["Search Volume"] || row["Nq"] || "0"),
      cpc: parseFloat(row["CPC"] || row["Cp"] || "0"),
      url: row["Url"] || row["Ur"] || "",
      trafficPercent: parseFloat(row["Traffic (%)"] || row["Tp"] || "0"),
      traffic: parseInt(row["Traffic"] || row["Tr"] || "0"),
      competition: parseFloat(row["Competition"] || row["Co"] || "0"),
    }));
  }

  async getBacklinksOverview(domain: string): Promise<BacklinkOverview> {
    if (!domain || domain.trim() === "") {
      throw new Error("Domain is required for getBacklinksOverview");
    }

    const reportTypes = [
      { type: "backlinks_overview", useExportColumns: false },
      { type: "backlinks_overview", useExportColumns: true },
    ];

    for (const attempt of reportTypes) {
      try {
        const params: Record<string, string> = {
          type: attempt.type,
          target: domain.trim(),
          target_type: "root_domain",
        };
        if (attempt.useExportColumns) {
          params.export_columns = "total,domains_num,ips_num,follows_num,nofollows_num";
        }

        debugLog("semrush", `Backlinks attempt: type=${attempt.type}, exportCols=${attempt.useExportColumns}`);
        const csv = await this.request(params);

        const rows = this.parseCSV(csv);
        if (rows.length === 0) {
          debugLog("semrush", `Backlinks: no rows parsed from response`);
          continue;
        }

        const row = rows[0];
        const result = {
          totalBacklinks: parseInt(row["total"] || row["Total"] || "0"),
          referringDomains: parseInt(row["domains_num"] || row["Domains"] || "0"),
          referringIps: parseInt(row["ips_num"] || row["IPs"] || "0"),
          followLinks: parseInt(row["follows_num"] || row["Follows"] || "0"),
          nofollowLinks: parseInt(row["nofollows_num"] || row["Nofollows"] || "0"),
        };
        debugLog("semrush", `Backlinks success: backlinks=${result.totalBacklinks}, domains=${result.referringDomains}`);
        return result;
      } catch (e: any) {
        const msg = e.message || "";
        if (msg.includes("query type not found") || msg.includes("WRONG API KEY")) {
          debugLog("semrush", `Backlinks attempt failed (${attempt.type}, cols=${attempt.useExportColumns}): ${msg}`);
          debugLog("semrush", `NOTE: "query type not found" means your SEMrush plan does not include the Backlinks API. This requires a Business plan with Backlinks API units.`);
          continue;
        }
        throw e;
      }
    }

    throw new Error(
      `SEMrush Backlinks API unavailable for "${domain}". ` +
      `The "query type not found" error indicates your SEMrush subscription plan does not include Backlinks API access. ` +
      `This feature requires a SEMrush Business plan with Backlinks API units purchased separately. ` +
      `Backlink data will fall back to DataForSEO if configured, or return 0.`
    );
  }

  async getBacklinks(domain: string, limit: number = 50): Promise<BacklinkData[]> {
    if (!domain || domain.trim() === "") {
      throw new Error("Domain is required for getBacklinks");
    }

    const csv = await this.request({
      type: "backlinks",
      target: domain.trim(),
      target_type: "root_domain",
      display_limit: limit.toString(),
      export_columns: "source_url,target_url,anchor,source_title,first_seen,last_seen,type",
    });

    const rows = this.parseCSV(csv);
    return rows.map((row) => ({
      sourceUrl: row["source_url"] || "",
      targetUrl: row["target_url"] || "",
      anchorText: row["anchor"] || "",
      sourceTitle: row["source_title"] || "",
      firstSeen: row["first_seen"] || "",
      lastSeen: row["last_seen"] || "",
      type: row["type"] || "",
    }));
  }

  async getKeywordOverview(keyword: string): Promise<{
    keyword: string;
    volume: number;
    cpc: number;
    competition: number;
    results: number;
  }> {
    if (!keyword || keyword.trim() === "") {
      throw new Error("Keyword is required for getKeywordOverview");
    }

    const csv = await this.request({
      type: "phrase_this",
      phrase: keyword.trim(),
      database: this.database,
      export_columns: "Ph,Nq,Cp,Co,Nr",
    });

    const rows = this.parseCSV(csv);
    if (rows.length === 0) {
      throw new Error(`No data found for keyword: ${keyword}`);
    }

    const row = rows[0];
    return {
      keyword: row["Ph"] || keyword,
      volume: parseInt(row["Nq"] || "0"),
      cpc: parseFloat(row["Cp"] || "0"),
      competition: parseFloat(row["Co"] || "0"),
      results: parseInt(row["Nr"] || "0"),
    };
  }

  async getDomainOrganicSummary(
    domain: string,
    database?: string
  ): Promise<{ totalKeywords: number; totalTrafficCost: number; totalTraffic: number }> {
    if (!domain || domain.trim() === "") {
      throw new Error("Domain is required for getDomainOrganicSummary");
    }

    const [organicCsv, rankCsv] = await Promise.all([
      this.request({
        type: "domain_organic",
        domain: domain.trim(),
        database: database || this.database,
        display_limit: "5000",
        export_columns: "Ph,Po,Nq,Cp,Tr,Tc",
      }),
      this.request({
        type: "domain_rank",
        domain: domain.trim(),
        database: database || this.database,
      }),
    ]);

    const organicRows = this.parseCSV(organicCsv);
    const rankRows = this.parseCSV(rankCsv);
    
    const totalKeywords = organicRows.length;
    debugLog("semrush", `domain_organic returned ${totalKeywords} keywords for ${domain}`);

    let totalTrafficCost = 0;
    let totalTraffic = 0;

    if (rankRows.length > 0) {
      const rankRow = rankRows[0];
      totalTraffic = parseInt(rankRow["Organic Traffic"] || rankRow["Ot"] || "0");
      totalTrafficCost = parseFloat(rankRow["Organic Cost"] || rankRow["Oc"] || "0");
      debugLog("semrush", `domain_rank: traffic=${totalTraffic}, cost=${totalTrafficCost}`);
    }

    return {
      totalKeywords,
      totalTrafficCost: Math.round(totalTrafficCost * 100) / 100,
      totalTraffic,
    };
  }

  async getDomainVsDomain(
    domain1: string,
    domain2: string
  ): Promise<{
    domain: string;
    commonKeywords: number;
    uniqueKeywords1: number;
    uniqueKeywords2: number;
  }> {
    if (!domain1 || !domain2 || domain1.trim() === "" || domain2.trim() === "") {
      throw new Error("Both domains are required for getDomainVsDomain");
    }

    const csv = await this.request({
      type: "domain_domains",
      domains: `${domain1.trim()}|or|${domain2.trim()}`,
      database: this.database,
      export_columns: "Ph,P0,P1,Nr,Cp",
      display_limit: "100",
    });

    const rows = this.parseCSV(csv);
    
    let common = 0;
    let unique1 = 0;
    let unique2 = 0;

    rows.forEach((row) => {
      const pos1 = parseInt(row["P0"] || "0");
      const pos2 = parseInt(row["P1"] || "0");
      if (pos1 > 0 && pos2 > 0) common++;
      else if (pos1 > 0) unique1++;
      else if (pos2 > 0) unique2++;
    });

    return {
      domain: domain1,
      commonKeywords: common,
      uniqueKeywords1: unique1,
      uniqueKeywords2: unique2,
    };
  }
}

let semrushClient: SemrushClient | null = null;
let lastApiKey: string | null = null;

export function getSemrushClient(): SemrushClient | null {
  const currentKey = process.env.SEMRUSH_API_KEY;
  if (!currentKey) {
    semrushClient = null;
    lastApiKey = null;
    return null;
  }

  if (!semrushClient || lastApiKey !== currentKey) {
    debugLog("semrush", lastApiKey ? "API key changed, creating new client" : "Initializing SEMrush client");
    semrushClient = new SemrushClient({
      apiKey: currentKey,
      database: process.env.SEMRUSH_DATABASE || "us",
    });
    lastApiKey = currentKey;
  }
  return semrushClient;
}

export function hasSemrushApiKey(): boolean {
  return !!process.env.SEMRUSH_API_KEY;
}

