const fs = require('fs');
let file = fs.readFileSync('client/src/pages/dashboard/report-preview.tsx', 'utf8');

const replacement = `  return (
    <div className="space-y-8 max-w-[900px] mx-auto pb-10" data-testid="report-preview-page">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-border/40 pb-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Preview Report</p>
            <h1 className="text-2xl font-bold tracking-tight">SEO Performance Report</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {report.domain}
              <span className="mx-2 text-border">|</span>
              {report.dateRange.start} to {report.dateRange.end}
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={isFetching} className="gap-2" data-testid="button-regenerate">
              <RefreshCw className={\`h-3.5 w-3.5 \${isFetching ? "animate-spin" : ""}\`} /> Regenerate
            </Button>
            <Button
              size="sm"
              onClick={handleGenerateAiReport}
              disabled={aiLoading || !domain}
              className="gap-2 bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white"
              data-testid="button-generate-ai-report"
            >
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {aiLoading ? "Generating..." : "Generate AI Report"}
            </Button>
            <Button size="sm" onClick={handleDownloadPdf} disabled={isDownloading} className="gap-2" data-testid="button-download-pdf">
              {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
              Download PDF
            </Button>
          </div>
        </div>
        <DateRangePicker
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onApply={handleApply}
        />
      </div>

      {isFetching && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="report-fetching">
          <Loader2 className="h-4 w-4 animate-spin" />
          Updating report data...
        </div>
      )}

      {/* 1. KPI SNAPSHOT */}
      <section data-testid="kpi-grid">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">1. KPI Snapshot</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Users" value={m.traffic.users.toLocaleString()} icon={Users} testId="kpi-users" />
          <KpiCard title="Sessions" value={m.traffic.sessions.toLocaleString()} icon={MousePointerClick} testId="kpi-sessions" />
          <KpiCard title="Conversions" value={m.conversions.current.toLocaleString()} icon={CheckCircle2} testId="kpi-conversions" />
          <div className="hidden lg:block"></div>
          <KpiCard title="Clicks" value={m.search.clicks.toLocaleString()} icon={Search} testId="kpi-clicks" />
          <KpiCard title="Impressions" value={m.search.impressions.toLocaleString()} icon={Eye} testId="kpi-impressions" />
          <KpiCard title="CTR" value={searchValid ? \`\${m.search.ctr}%\` : "N/A"} icon={Percent} testId="kpi-ctr" subtitle={!searchValid ? "Insufficient data" : undefined} />
          <KpiCard title="Avg Position" value={searchValid ? formatPosition(m.search.avgPosition) : "N/A"} icon={Target} testId="kpi-position" subtitle={!searchValid ? "Insufficient data" : undefined} />
        </div>
      </section>

      {/* 2. EXECUTIVE SUMMARY */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">2. Executive Summary</h2>
        <Card className="border-border/60 bg-card/80">
          <CardContent className="p-6">
            <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap font-medium" data-testid="text-executive-summary">
              {report.summary}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 3. KEY INSIGHTS */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">3. Key Insights</h2>
        <Card className="border-border/60 bg-card/80">
          <CardContent className="p-6 space-y-6">
            {risks.length > 0 && (
              <InsightGroup title="Risks" icon={<AlertTriangle className="h-4 w-4 text-red-400" />} items={risks} color="red" />
            )}
            {positives.length > 0 && (
              <InsightGroup title="Opportunities" icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />} items={positives} color="green" />
            )}
            {neutrals.length > 0 && (
              <InsightGroup title="Observations" icon={<Info className="h-4 w-4 text-slate-400" />} items={neutrals} color="slate" />
            )}
            {risks.length === 0 && positives.length === 0 && neutrals.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No insights available for this reporting period.</p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* 4. TRAFFIC TREND */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">4. Traffic Trend</h2>
        {!hasAnyChart ? (
          <Card className="border-border/60 bg-card/80">
            <CardContent className="py-12 text-center">
              <BarChart3 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-chart-data">—</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/60 bg-card/80">
            <CardHeader className="pb-2 border-b border-border/40">
              <CardTitle className="text-sm font-semibold">Daily Users and Sessions (GA4)</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="overflow-x-auto mb-6 max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border/40">
                      <th className="text-left py-2 px-4 text-muted-foreground font-medium text-xs">Date</th>
                      <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Users</th>
                      <th className="text-right py-2 px-4 text-muted-foreground font-medium text-xs">Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.dailyTrends.ga4Daily.map((d, i) => (
                      <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors">
                        <td className="py-2 px-4 font-medium text-foreground/90">{d.date}</td>
                        <td className="text-right py-2 px-4 font-mono text-foreground/80">{d.users.toLocaleString()}</td>
                        <td className="text-right py-2 px-4 font-mono text-foreground/80">{d.sessions.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={report.dailyTrends.ga4Daily.map(d => ({ ...d, date: d.date.slice(5) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))", fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="users" stroke="#2563eb" strokeWidth={2} dot={false} name="Users" />
                    <Line type="monotone" dataKey="sessions" stroke="#7c3aed" strokeWidth={2} dot={false} name="Sessions" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* 5. TOP PAGES TABLE */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">5. Top Pages</h2>
          <Badge variant="outline" className="text-[10px] font-normal">{report.topPagesSource === "gsc" ? "Search Console" : "GA4"}</Badge>
        </div>
        {report.topPages.length > 0 ? (
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="report-top-pages-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">Page</th>
                      {report.topPagesSource === "gsc" ? (
                        <>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Clicks</th>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Impressions</th>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">CTR</th>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Position</th>
                        </>
                      ) : (
                        <>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Sessions</th>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Users</th>
                          <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Conversions</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {report.topPages.slice(0, 10).map((p: any, i: number) => (
                      <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors" data-testid={\`row-top-page-\${i}\`}>
                        <td className="py-2.5 px-4 font-medium truncate max-w-[300px] text-foreground/90">{p.page}</td>
                        {report.topPagesSource === "gsc" ? (
                          <>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{p.clicks?.toLocaleString()}</td>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{p.impressions?.toLocaleString()}</td>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{p.ctr}%</td>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{p.position}</td>
                          </>
                        ) : (
                          <>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{p.sessions?.toLocaleString()}</td>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{p.users?.toLocaleString()}</td>
                            <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{p.conversions?.toLocaleString()}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : (
           <Card className="border-border/60 bg-card/80 py-10 text-center text-muted-foreground">
             <p>—</p>
           </Card>
        )}
      </section>

      {/* 6. KEYWORD PERFORMANCE */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">6. Keyword Performance (Top 10)</h2>
          {keywordSource && <Badge variant="outline" className="text-[10px] font-normal">{keywordSource}</Badge>}
        </div>
        {!keywordSource ? (
          <Card className="border-border/60 bg-card/80 py-10 text-center text-muted-foreground">
            <p>Keyword data unavailable. Connect SEMrush or DataForSEO for ranking data.</p>
          </Card>
        ) : (
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">Keyword</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Clicks</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Impressions</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">CTR</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Position</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">Impact Analysis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top10Keywords.map((k: any, i: number) => (
                      <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors">
                        <td className="py-2.5 px-4 font-medium text-foreground/90">{k.keyword}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{k.clicks?.toLocaleString() || "—"}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{k.impressions?.toLocaleString() || "—"}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{k.ctr ? \`\${k.ctr}%\` : "—"}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{k.position}</td>
                        <td className="py-2.5 px-4 text-foreground/80 text-xs italic opacity-80">{getImpactAnalysis(k.position)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* 7. BACKLINKS */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">7. Backlinks</h2>
          {backlinksSource && <Badge variant="outline" className="text-[10px] font-normal">{backlinksSource}</Badge>}
        </div>
        {!backlinksSource ? (
          <Card className="border-border/60 bg-card/80 py-10 text-center text-muted-foreground">
             <p>Backlink data unavailable. Configure SEMrush or DataForSEO API.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <KpiCard title="Total Backlinks" value={backlinksToUse.total_backlinks?.toLocaleString() || "—"} icon={LinkIcon} testId="kpi-backlinks" />
            <KpiCard title="Referring Domains" value={backlinksToUse.referring_domains?.toLocaleString() || "—"} icon={Search} testId="kpi-ref-domains" />
          </div>
        )}
      </section>

      {/* 8. WHAT CHANGED */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">8. What Changed</h2>
        <Card className="border-border/60 bg-card/80">
          <CardContent className="p-6">
            <div className="space-y-3">
              <DeltaRow
                label="Traffic Growth"
                value={m.traffic.growthRate}
                display={m.traffic.growthRate > 0 ? \`+\${m.traffic.growthRate}%\` : m.traffic.growthRate < 0 ? \`\${m.traffic.growthRate}%\` : "No change"}
              />
              <DeltaRow
                label="Keyword Net Growth"
                value={m.keywords.netGrowth}
                display={m.keywords.netGrowth > 0 ? \`+\${m.keywords.netGrowth} keywords\` : m.keywords.netGrowth < 0 ? \`\${m.keywords.netGrowth} keywords\` : "Stable"}
              />
              {searchValid && (
                <DeltaRow
                  label="CTR vs Benchmark"
                  value={m.search.ctrGap <= 0 ? 1 : -1}
                  display={m.search.ctrGap <= 0 ? \`+\${Math.abs(m.search.ctrGap)}% above target\` : \`-\${Math.abs(m.search.ctrGap)}% below target\`}
                />
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 9. AI VISIBILITY */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">9. AI Visibility</h2>
          {report.aiReferrers && report.aiReferrers.length > 0 && (
            <Badge variant="outline" className="text-[10px] font-normal gap-1">
              <Bot className="h-3 w-3" />
              {report.aiReferrers.length} source{report.aiReferrers.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        {report.aiReferrers && report.aiReferrers.length > 0 ? (
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-0">
              <div className="grid grid-cols-2 gap-4 p-4 border-b border-border/30">
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Total AI Users</p>
                  <p className="text-xl font-semibold mt-0.5" data-testid="ai-total-users">{totalAiUsers.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Total AI Sessions</p>
                  <p className="text-xl font-semibold mt-0.5" data-testid="ai-total-sessions">{totalAiSessions.toLocaleString()}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="report-ai-referrers-table">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">AI Source</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Users</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">Sessions</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.aiReferrers.map((ref, i) => (
                      <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors" data-testid={\`row-ai-referrer-\${i}\`}>
                        <td className="py-2.5 px-4 font-medium text-foreground/90">{ref.source}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{ref.totalUsers.toLocaleString()}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{ref.sessions.toLocaleString()}</td>
                        <td className="text-right py-2.5 px-4 font-mono text-foreground/80">{ref.percentOfTotal != null ? \`\${ref.percentOfTotal}%\` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/60 bg-card/80 py-10 text-center text-muted-foreground">
             <p>—</p>
          </Card>
        )}
      </section>

      {/* 10. DATA AVAILABILITY STATUS */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">10. Data Availability Status</h2>
        {report.missingData && report.missingData.length > 0 ? (
          <Card className="border-amber-500/20 bg-amber-950/20">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-semibold text-amber-400 mb-1">Missing / Degraded Data Connections</h4>
                  <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
                    {report.missingData.map((note: string, i: number) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/60 bg-card/80 p-4 flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="text-sm text-foreground/80">All data sources successfully connected and synced.</span>
          </Card>
        )}
      </section>

      {/* AI REPORT SECTION */}`;

const targetStart = "  return (\n    <div className=\"space-y-8 max-w-[900px] mx-auto pb-10\" data-testid=\"report-preview-page\">\n      {/* Header */}";
const targetEnd = "      {/* AI REPORT SECTION */}";

const startIndex = file.indexOf(targetStart);
const endIndex = file.indexOf(targetEnd);

if (startIndex !== -1 && endIndex !== -1) {
  file = file.slice(0, startIndex) + replacement + file.slice(endIndex + targetEnd.length);
  fs.writeFileSync('client/src/pages/dashboard/report-preview.tsx', file);
  console.log("Success");
} else {
  console.log("Error finding bounds", !!(startIndex!==-1), !!(endIndex!==-1));
}
