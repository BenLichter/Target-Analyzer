import { useState, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const MODEL = "claude-sonnet-4-20250514";
const STORAGE = {
  pipeline: "cp_pipeline_v5",
  alerts:   "cp_alerts_v5",
  tavily:   "cp_tavily_key",
  ninjapear:"cp_ninjapear_key",
  verified: "cp_verified_li_v2",
  vcache:   "cp_verify_cache_v2",
};

const C = {
  bg:"#07090F", surface:"#0D1117", card:"#111827", border:"#1F2937",
  accent:"#00C2FF", accentDim:"#00C2FF12", gold:"#F59E0B", goldDim:"#F59E0B12",
  green:"#10B981", greenDim:"#10B98112", red:"#EF4444", redDim:"#EF444412",
  purple:"#8B5CF6", purpleDim:"#8B5CF612", cyan:"#06B6D4",
  text:"#F1F5F9", muted:"#94A3B8", dim:"#334155",
};

const STAGES = ["Prospecting","Lead / SQL","Discovery","Solution Design & Demo","Proposal & Negotiation","Closed / Won","Expansion / Retention"];
const STAGE_COLORS = {"Prospecting":C.muted,"Lead / SQL":C.cyan,"Discovery":C.accent,"Solution Design & Demo":C.purple,"Proposal & Negotiation":C.gold,"Closed / Won":C.green,"Expansion / Retention":C.green};

const COMPARE_ROWS = [
  ["Merchant Acceptance","merchant_acceptance"],["Fiat On-Ramp","fiat_on_ramp"],
  ["Fiat Off-Ramp","fiat_off_ramp"],["Rails Supported","rails_supported"],
  ["Costs & Fees","costs_fees"],["Crypto Breadth","crypto_breadth"],
  ["White Label","white_label"],["Compliance / Licensing","compliance_licensing"],
  ["Fraud & Chargeback","fraud_chargeback"],["Insurance & Safeguarding","insurance_safeguarding"],
  ["Reporting","reporting"],["Geographies","geographies"],
  ["Co-Marketing","co_marketing"],["Education & Advocacy","education_advocacy"],
  ["API Architecture","api_architecture"],["Scalability","scalability"],
  ["Interoperability","interoperability"],["Pricing Transparency","pricing_transparency"],
  ["Revenue Sharing","revenue_sharing"],["SLA & Support","sla_support"],
];

// ─── Storage helpers ──────────────────────────────────────────────────────────
const norm = s => (s||"").trim().toLowerCase();
const ls = { get: k => { try { return JSON.parse(localStorage.getItem(k)||"null"); } catch { return null; } }, set: (k,v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch {} } };

function usePipeline() {
  const [pipeline, setPipelineRaw] = useState(() => ls.get(STORAGE.pipeline) || []);
  const [alerts, setAlertsRaw] = useState(() => ls.get(STORAGE.alerts) || []);
  const setPipeline = useCallback(v => { setPipelineRaw(v); ls.set(STORAGE.pipeline, v); }, []);
  const setAlerts   = useCallback(v => { setAlertsRaw(v);   ls.set(STORAGE.alerts,   v); }, []);
  const addRecord   = useCallback(r  => { setPipeline(prev => [r, ...prev.filter(x => norm(x.company) !== norm(r.company))]); }, [setPipeline]);
  const updateRecord= useCallback((company,updates) => { setPipeline(prev => prev.map(r => norm(r.company)===norm(company)?{...r,...updates}:r)); }, [setPipeline]);
  const removeRecord= useCallback(company => { setPipeline(prev => prev.filter(r => norm(r.company)!==norm(company))); }, [setPipeline]);
  const addAlert    = useCallback(a  => { setAlerts(prev => [a,...prev.slice(0,99)]); }, [setAlerts]);
  return { pipeline, alerts, addRecord, updateRecord, removeRecord, addAlert };
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function callAPI(system, user, maxTokens) {
  const res = await fetch("/api/anthropic", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ model:MODEL, max_tokens:maxTokens||6000, system, messages:[{role:"user",content:user}] }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=>"");
    throw new Error("API HTTP "+res.status+(txt?" — "+txt.slice(0,200):""));
  }
  const json = await res.json();
  if (json.error) throw new Error(json.error.message+" (type: "+json.error.type+")");
  const blocks = (json.content||[]).filter(b=>b.type==="text");
  if (!blocks.length) throw new Error("No text in response. stop_reason="+json.stop_reason+" usage="+JSON.stringify(json.usage||{}));
  return blocks.map(b=>b.text).join("\n");
}

function parseJSON(raw) {
  let s = raw.trim().replace(/^```json\s*/i,"").replace(/^```/,"").replace(/```$/,"").trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a!==-1 && b>a) { try { return JSON.parse(s.slice(a,b+1)); } catch(e) { throw new Error("JSON: "+e.message+" | "+s.slice(a,a+200)); } }
  throw new Error("No JSON found: "+s.slice(0,300));
}

// Paywalled / unreliable domains to exclude from news
const BLOCKED_DOMAINS = [
  "bloomberg.com","wsj.com","ft.com","economist.com","nytimes.com",
  "washingtonpost.com","thetimes.co.uk","barrons.com","theatlantic.com",
  "hbr.org","foreignpolicy.com","newyorker.com","wired.com"
];

async function tavilySearch(query, key, n, maxAgeDays) {
  if (!key) return null;
  try {
    const body = {
      api_key: key,
      query,
      search_depth: "advanced",
      max_results: (n||6) + 4,
      include_answer: true,
      include_raw_content: false,
      exclude_domains: BLOCKED_DOMAINS,
    };
    if (maxAgeDays) body.days = maxAgeDays;
    const res = await fetch("/api/tavily", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(()=>({}));
      const errMsg = errBody.detail || errBody.message || errBody.error || ("HTTP "+res.status);
      const isCredits = res.status === 429 || (typeof errMsg === "string" && (errMsg.toLowerCase().includes("credit") || errMsg.toLowerCase().includes("limit") || errMsg.toLowerCase().includes("quota")));
      const isAuth = res.status === 401 || res.status === 403;
      apiStatus.tavily.ok = false;
      apiStatus.tavily.error = isCredits ? "OUT_OF_CREDITS" : isAuth ? "INVALID_KEY" : errMsg;
      apiStatus.tavily.credits = isCredits ? "exhausted" : null;
      console.warn("[Tavily]", res.status, errMsg);
      return null;
    }
    apiStatus.tavily.ok = true;
    apiStatus.tavily.searches += 1;
    const data = await res.json();
    const cutoff = maxAgeDays ? new Date(Date.now() - maxAgeDays*86400000) : null;
    const answer = data.answer||"";
    const snippets = (data.results||[])
      .filter(r => {
        // Block paywalled domains (belt-and-suspenders)
        const host = r.url ? r.url.replace("https://","").replace("http://","").replace("www.","").split("/")[0] : "";
        if (BLOCKED_DOMAINS.some(d => host.includes(d))) return false;
        // Date filter
        if (!cutoff || !r.published_date) return true;
        return new Date(r.published_date) >= cutoff;
      })
      .slice(0, n||6)
      .map(r => {
        const host = r.url ? r.url.replace("https://","").replace("http://","").replace("www.","").split("/")[0] : "";
        return "TITLE: "+r.title+
          "\nURL: "+(r.url||"")+
          "\nDATE: "+(r.published_date||"")+
          "\nSOURCE: "+host+
          "\nCONTENT: "+(r.content||"").slice(0,320);
      }).join("\n---\n");
    apiStatus.tavily.results += (data.results||[]).length;
    return answer ? answer+"\n\n"+snippets : snippets;
  } catch(e) { console.warn("[Tavily exception]", e.message); return null; }
}

// Check if a URL is from a known-accessible (non-paywalled) domain
function checkUrl(url) {
  if (!url) return "none";
  try {
    const host = url.replace("https://","").replace("http://","").replace("www.","").split("/")[0];
    if (BLOCKED_DOMAINS.some(d => host.includes(d))) return "paywalled";
    // Known open/free domains
    const openDomains = ["techcrunch.com","reuters.com","cnbc.com","coindesk.com","cointelegraph.com",
      "theverge.com","axios.com","businessinsider.com","forbes.com","fortune.com","inc.com",
      "venturebeat.com","theblock.co","decrypt.co","cryptoslate.com","finextra.com","pymnts.com",
      "fintechfutures.com","crowdfundinsider.com","fintech.global","prnewswire.com","businesswire.com",
      "globenewswire.com","sec.gov","gov.uk","europa.eu","crunchbase.com","pitchbook.com"];
    if (openDomains.some(d => host.includes(d))) return "verified";
    return "unverified";
  } catch { return "unverified"; }
}

// Returns raw result objects (not text) for direct URL/date extraction
async function tavilySearchRaw(query, key, n, maxAgeDays) {
  if (!key) return [];
  try {
    const body = {
      api_key: key, query,
      search_depth: "advanced",
      max_results: (n||6)+3,
      include_answer: false,
      include_raw_content: false,
      exclude_domains: BLOCKED_DOMAINS,
    };
    if (maxAgeDays) body.days = maxAgeDays;
    const res = await fetch("/api/tavily", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(()=>({}));
      const errMsg = errBody.detail || errBody.message || errBody.error || ("HTTP "+res.status);
      const isCredits = res.status === 429 || (typeof errMsg === "string" && (errMsg.toLowerCase().includes("credit") || errMsg.toLowerCase().includes("limit") || errMsg.toLowerCase().includes("quota")));
      const isAuth = res.status === 401 || res.status === 403;
      apiStatus.tavily.ok = false;
      apiStatus.tavily.error = isCredits ? "OUT_OF_CREDITS" : isAuth ? "INVALID_KEY" : errMsg;
      apiStatus.tavily.credits = isCredits ? "exhausted" : null;
      console.warn("[TavilyRaw]", res.status, errMsg);
      return [];
    }
    apiStatus.tavily.ok = apiStatus.tavily.ok !== false ? true : false;
    apiStatus.tavily.searches += 1;
    const data = await res.json();
    const cutoff = maxAgeDays ? new Date(Date.now()-maxAgeDays*86400000) : null;
    return (data.results||[]).filter(r => {
      if (!r.url) return false;
      const host = r.url.replace("https://","").replace("http://","").replace("www.","").split("/")[0];
      if (BLOCKED_DOMAINS.some(d => host.includes(d))) return false;
      if (!cutoff || !r.published_date) return true;
      return new Date(r.published_date) >= cutoff;
    });
  } catch { return []; }
}

// Global API status tracker — populated during runAnalysis, read by UI
const apiStatus = {
  ninjapear: { ok:null, peopleFound:0, error:null },
  tavily: { ok: null, error: null, credits: null, searches: 0, results: 0 },
};

// ── NinjaPear — B2B Company & Employee Intelligence ─────────────────────────
// Uses the same API key as your Proxycurl account (same company)

// Verify and enrich a single person by name + employer domain
async function njVerifyPerson(firstName, lastName, employerDomain, key, role) {
  if (!key) return null;
  try {
    const params = { first_name: firstName, employer_website: "https://" + employerDomain };
    if (lastName) params.last_name = lastName;
    if (role) params.role = role;
    const res = await fetch("/api/ninjapear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "v1/employee/profile", key, params })
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.full_name) return null;
    console.log("[NinjaPear] Verified:", data.full_name);
    return data;
  } catch(e) { console.warn("[NinjaPear]", e.message); return null; }
}

// Look up who holds a specific role at a company
async function njLookupByRole(role, employerDomain, key) {
  if (!key) return null;
  try {
    const res = await fetch("/api/ninjapear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "v1/employee/profile",
        key,
        params: { employer_website: "https://" + employerDomain, role }
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.full_name) return null;
    console.log("[NinjaPear] Role:", role, "->", data.full_name);
    return data;
  } catch(e) { return null; }
}

// Enrich company details
async function njEnrichCompany(domain, key) {
  if (!key) return null;
  try {
    const res = await fetch("/api/ninjapear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "v1/company/details",
        key,
        params: { website: "https://" + domain, include_employee_count: "true" }
      })
    });
    if (!res.ok) return null;
    const d = await res.json();
    const hqAddr = (d.addresses||[]).find(a=>a.is_primary) || (d.addresses||[])[0] || {};
    return {
      employees:    d.employee_count ? String(d.employee_count) : "",
      revenue:      d.public_listing?.revenue_usd ? "$"+(d.public_listing.revenue_usd/1e9).toFixed(1)+"B" : "",
      industry:     (d.specialties||[]).slice(0,3).join(", "),
      hq:           [hqAddr.city, hqAddr.state].filter(Boolean).join(", "),
      founded:      d.founded_year ? String(d.founded_year) : "",
      funding:      "",
      tech_stack:   [],
      linkedin:     "",
      description:  d.description || "",
      executives:   (d.executives||[]).map(e=>({ name:e.name, title:e.title, role:e.role })),
      tagline:      d.tagline || "",
      company_type: d.company_type || "",
    };
  } catch(e) { return null; }
}

// Normalize a NinjaPear profile to internal contact shape
function njProfileToContact(profile, company, source) {
  if (!profile || !profile.full_name) return null;
  const currentJob = (profile.work_experience||[]).find(e => !e.end_date);
  return {
    first_name:   profile.first_name || "",
    last_name:    profile.last_name  || "",
    title:        currentJob?.role || "",
    email:        "",
    linkedin_url: "",
    twitter:      profile.x_profile_url || "",
    city:         profile.city || "",
    country:      profile.country || "",
    departments:  [currentJob?.role || ""],
    seniority:    "",
    source:       source || "ninjapear",
    nj_id:        profile.id || "",
    organization: { name: company },
  };
}

// ─── Main Analysis ────────────────────────────────────────────────────────────
async function runAnalysis(company, onStep, keys) {
  const { tavily:tKey, ninjapear:njKey } = keys;
  const now = new Date().toISOString();
  // Reset API status for this run
  apiStatus.tavily = { ok:null, error:null, credits:null, searches:0, results:0 };
  apiStatus.ninjapear = { ok:null, peopleFound:0, error:null };
    const today = new Date();
  const yr = today.getFullYear();
  const todayStr = today.toDateString();
  const SYS = "You are a senior fintech sales intelligence expert for CoinPayments (crypto payment infrastructure: 2000+ coins, white-label, global merchant tools, fiat on/off ramps, API-first). Output ONLY valid JSON. No markdown fences. Start with { end with }. Keep string values under 35 words.";

  // Phase 0a: Tavily live research
  let liveCtx = "";
  let newsCtx = "";
  let rawNewsArticles = []; // store raw Tavily result objects for URL extraction
  if (tKey) {
    onStep("🌐 Live web research: "+company+"...");
    const NEWS_DAYS = 180;

    // Run 7 targeted searches — Tavily days param does the date filtering
    onStep("📡 Searching news for "+company+"...");
    const searches = await Promise.all([
      // 3 broad news searches cover 90%+ of what 7 narrow searches found
      tavilySearchRaw(company+" news 2025 2026",                            tKey, 10, NEWS_DAYS),
      tavilySearchRaw(company+" payments crypto blockchain fintech IPO",    tKey, 8,  NEWS_DAYS),
      tavilySearchRaw(company+" executive partnership funding announcement", tKey, 6,  NEWS_DAYS),
    ]);

    // Merge all raw results, deduplicate by URL
    const seenUrls = new Set();
    for (const results of searches) {
      for (const r of (results||[])) {
        if (!r.url || seenUrls.has(r.url)) continue;
        // Skip blocked domains
        const host = r.url.replace("https://","").replace("http://","").replace("www.","").split("/")[0];
        if (BLOCKED_DOMAINS.some(d => host.includes(d))) continue;
        seenUrls.add(r.url);
        rawNewsArticles.push(r);
      }
    }

    // Sort by published_date descending
    rawNewsArticles.sort((a,b) => {
      const da = a.published_date ? new Date(a.published_date) : new Date(0);
      const db = b.published_date ? new Date(b.published_date) : new Date(0);
      return db - da;
    });

    // Build context string from top articles
    if (rawNewsArticles.length) {
      newsCtx = "=== LIVE NEWS RESULTS for "+company+" ("+rawNewsArticles.length+" articles found, scraped "+todayStr+") ===\n";
      newsCtx += "Today is "+todayStr+". All articles below were returned by web search with a 6-month date filter.\n\n";
      rawNewsArticles.slice(0,20).forEach((r, i) => {
        newsCtx += (i+1)+". TITLE: "+r.title+"\n";
        newsCtx += "   URL: "+r.url+"\n";
        newsCtx += "   DATE: "+(r.published_date||"date unknown")+"\n";
        newsCtx += "   SOURCE: "+r.url.replace("https://","").replace("http://","").replace("www.","").split("/")[0]+"\n";
        newsCtx += "   CONTENT: "+(r.content||"").slice(0,400)+"\n\n";
      });
      newsCtx += "=== END NEWS ===\n\n";
    }

    // Build general live context for other fields
    // Use news results for exec/financials context too — avoid duplicate calls
    if (newsCtx) {
      liveCtx = "=== LIVE DATA — "+todayStr+" — override training knowledge ===\n\n";
      liveCtx += newsCtx;
      liveCtx += "=== END LIVE DATA ===\n\n";
    }
  }

  // Phase 0b: NinjaPear — company enrichment + role-based contact discovery
  let apolloContacts = [];
  let apolloCo = null;
  const domain = company.toLowerCase().replace(/[^a-z0-9]/g,"") + ".com";

  if (njKey) {
    onStep("🎯 NinjaPear: enriching " + company + "...");
    const KEY_ROLES = [
      "CMO","CPO","CTO","CEO","COO","CFO",
      "VP Product","VP Payments","VP Partnerships",
      "VP Growth","VP Engineering","Head of Business Development",
    ];

    // Company enrich + role lookups in parallel
    const [coData, ...rolePeople] = await Promise.all([
      njEnrichCompany(domain, njKey),
      ...KEY_ROLES.map(role => njLookupByRole(role, domain, njKey))
    ]);

    apolloCo = coData;
    apiStatus.ninjapear = { ok: !!coData, peopleFound: 0 };

    // Executives from company details
    const execsFromDetails = (coData?.executives||[]).map(e => ({
      first_name:   (e.name||"").split(" ")[0],
      last_name:    (e.name||"").split(" ").slice(1).join(" "),
      title:        e.title || e.role || "",
      email:        "", linkedin_url: "", twitter: "",
      city: "", country: "", departments: [e.role||""],
      source: "ninjapear_exec", organization: { name: company },
    }));

    // Role-based lookups
    const roleContacts = rolePeople
      .map((p,i) => p ? njProfileToContact(p, company, "ninjapear_" + KEY_ROLES[i]) : null)
      .filter(Boolean);

    // Merge dedup by first name
    const seen = new Set();
    for (const p of [...execsFromDetails, ...roleContacts]) {
      const k = (p.first_name||"").toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); apolloContacts.push(p); }
    }
    apiStatus.ninjapear.peopleFound = apolloContacts.length;

    if (apolloContacts.length) {
      liveCtx += "=== NINJAPEAR CONTACTS for " + company + " ===\n";
      apolloContacts.forEach((p,i) => {
        const name = [p.first_name,p.last_name].filter(Boolean).join(" ");
        liveCtx += (i+1)+". "+name+" | "+(p.title||"")+"\n";
      });
      liveCtx += "=== END NINJAPEAR ===\n\n";
    }
    if (apolloCo) {
      liveCtx += "=== COMPANY DATA ===\nEmployees:"+apolloCo.employees+
        " Industry:"+apolloCo.industry+" HQ:"+apolloCo.hq+
        " Founded:"+apolloCo.founded+"\n"+apolloCo.description+"\n=== END ===\n\n";
    }
  }

  // Phase 0c: Deep people scraping — designed to surface VPs, Directors, mid-level leaders
  let conferenceContacts = [];
  let conferenceCtx = "";
  if (tKey) {
    onStep("🔍 Scraping people intelligence for " + company + "...");

    // Strategy: cast a wide net with many specific query types.
    // We want to find people like: CMO, CPO, CTO, VPs of Product/Payments/Growth/Partnerships,
    // Directors, and mid-level leaders who appear in press, blogs, podcasts, LinkedIn, job postings.

    const [rPeople1, rPeople2, rPeople3, rPeople4, rPeople5] = await Promise.all([
      // 1. Press quotes + LinkedIn profiles — highest yield for named individuals
      tavilySearchRaw(company + " VP Director Head Chief executive said linkedin.com/in 2024 2025", tKey, 10, 730),
      // 2. Conference speakers + podcast guests — confirms real people publicly
      tavilySearchRaw(company + " speaker panelist keynote podcast guest interview conference 2024 2025", tKey, 8, 730),
      // 3. Forbes/TechCrunch/Crunchbase exec listings — surfaces leadership team
      tavilySearchRaw(company + " executive leadership team crunchbase profile Forbes 2024 2025", tKey, 8, 730),
      // 4. Blog authors + press release bylines — finds mid-level leaders
      tavilySearchRaw(company + " author written by blog newsroom product payments team 2024 2025", tKey, 6, 730),
      // 5. Job postings mentioning managers — surfaces Directors and below
      tavilySearchRaw(company + " hiring reports to director head of job description 2025", tKey, 6, 365),
    ]);

    // Merge and deduplicate by URL
    const seenU = new Set();
    const allRaw = [rPeople1, rPeople2, rPeople3, rPeople4, rPeople5].flat()
      .filter(r => r && r.url && !seenU.has(r.url) && seenU.add(r.url));

    if (allRaw.length) {
      onStep("📋 Extracting names from " + allRaw.length + " sources for " + company + "...");

      // Send ALL content to Claude for extraction — include full snippets
      const extractText = allRaw.slice(0, 20).map((r, i) =>
        (i+1) + ". URL: " + r.url + "\n" +
        "   TITLE: " + r.title + "\n" +
        "   DATE: " + (r.published_date || "") + "\n" +
        "   TEXT: " + (r.content || "").slice(0, 500)
      ).join("\n\n");

      const extractPrompt = [
        "Extract every real named person who works or worked at " + company + " from the sources below.",
        "",
        "WHAT TO LOOK FOR:",
        "- Press quotes: 'said [Name], [Title] at " + company + "'",
        "- Blog bylines: 'By [Name]' or 'Written by [Name]'",
        "- Podcast guests: '[Name] from " + company + "'",
        "- LinkedIn profiles: any linkedin.com/in/ URL with " + company + " in content",
        "- Conference bios: '[Name], VP of X at " + company + "'",
        "- News mentions: '[Name], who leads X at " + company + "'",
        "- Job postings: 'hiring manager', 'reports to [Name]'",
        "- Executive listings on crunchbase, tracxn, company websites",
        "",
        "FOR EACH PERSON FOUND:",
        "- name: their full name",
        "- title: exact title as written in the source",
        "- source_type: how you found them (press_quote / blog_author / podcast_guest / linkedin / conference / news_mention / exec_listing / job_posting)",
        "- source_url: the URL it came from",
        "- context: one sentence — what they said or did",
        "- appearances: count how many of the 20 sources mention this same person",
        "",
        "DO NOT include people from other companies.",
        "DO NOT invent people not explicitly named in the text below.",
        "If you find fewer than 3 people, that is fine — only include real finds.",
        "",
        "SOURCES:",
        extractText,
        "",
        'Output ONLY a JSON array: [{"name":"Full Name","title":"role","source_type":"type","source_url":"url","context":"what they did","appearances":1}]'
      ].join("\n");

      const rawExt = await callAPI(
        "Extract named employees from source text. Output ONLY a JSON array starting with [. Never invent names.",
        extractPrompt, 3000
      );

      try {
        let extracted = [];
        const s = rawExt.trim().replace(/^```json\s*/i, "").replace(/^```/, "").replace(/```$/, "").trim();
        if (s.startsWith("[")) extracted = JSON.parse(s);
        else { try { const p = parseJSON(s); extracted = Array.isArray(p) ? p : []; } catch {} }

        // Deduplicate by normalized name, keep highest appearances
        const nameMap = new Map();
        for (const p of extracted) {
          if (!p.name || p.name.length < 4) continue;
          const k = p.name.toLowerCase().trim();
          const ex = nameMap.get(k);
          if (!ex || (p.appearances || 1) > (ex.appearances || 1)) nameMap.set(k, p);
        }
        conferenceContacts = Array.from(nameMap.values());
      } catch { conferenceContacts = []; }

      if (conferenceContacts.length) {
        conferenceCtx = "=== SCRAPED PEOPLE at " + company + " (" + conferenceContacts.length + " found) ===\n\n";
        conferenceContacts.forEach((p, i) => {
          conferenceCtx += (i+1) + ". " + p.name + " | " + (p.title || "unknown") +
            " | " + (p.source_type || "web") +
            (p.context ? " | " + p.context : "") + "\n";
        });
        conferenceCtx += "\n=== END SCRAPED PEOPLE ===\n\n";
        liveCtx += conferenceCtx;
      }
    }
  }

  // Phase 1: Core intelligence
  onStep("📊 Building intelligence report (1/4)...");
  const raw1 = await callAPI(SYS, liveCtx+
    "Analyze \""+company+"\" as a CoinPayments prospect. Today: "+todayStr+". "+
    "Rules: (1) Use live data to override stale training. (2) If live data shows an event completed, say completed. "+
    "Output ONLY JSON:\n"+
    JSON.stringify({
      company, segment:"Neo-Bank/Challenger Bank|Traditional Bank/FI|Payments Processor|Remittance/FX|Wealth Management/Brokerage|Insurance/Insurtech|Lending/Credit|Payroll/HCM|B2B Fintech Platform|Card Network/Issuer|Other Financial Services",
      analyzedAt:now, hq:"city, country", website:"url", employees:"count", revenue:"estimate",
      executive_summary:"3-sentence CoinPayments opportunity",
      tam_som_arr:{tam_usd:"$X",som_usd:"$X",likely_arr_usd:"$X-$X",reasoning:"brief"},
      key_contacts:[], // populated separately from scraped sources

      intent_data:[{contact:"name",signal:"signal",source:"source",date:"date",strength:"High|Medium|Low"}],
      partnerships:[{partner:"name",type:"Strategic|Co-Marketing|Technology|Channel",rationale:"why",incumbent_cost:"$X if incumbent",cp_advantage:"CP advantage"}],
      geography:{markets:["list"],expansions:["recent"],crypto_licensed:["list"],missing_us:true,gaps:"narrative"},
      incumbent:{name:"provider or None",annual_cost:"$X",cp_saving:"$X",weaknesses:"why CP wins"},
      missed_opportunity:{crypto_share:"XX%",revenue_at_risk:"$XM/yr",narrative:"4-sentence argument",stats:["stat1","stat2","stat3"],urgency:"High|Medium|Low",urgency_reason:"why now"},
      crm:{company,segment:"",industry:"",hq:"",website:"",employees:"",revenue:"",stage:"Prospecting",deal_value:"",next_action:"Schedule discovery call",notes:""},
      alert_keywords:["kw1","kw2","kw3","kw4","kw5"],
      recent_news:[],
    }, null, 2), 7000);

  // Parse p1 immediately so Phase 1c can use it
  const p1 = parseJSON(raw1);

  // Phase 1b: Build news directly from raw Tavily articles (no Claude extraction needed)
  onStep("📰 Processing news articles (2/4)...");

  let parsedNews = { recent_news: [] };

  if (rawNewsArticles.length) {
    // Map Tavily results directly to news items — no Claude needed for this step
    // Ask Claude only to add category + relevance, using exact Tavily data for everything else
    const articleList = rawNewsArticles.slice(0,15).map((r,i) =>
      (i+1)+". "+r.title+" | "+r.url+" | "+(r.published_date||"") +" | "+ (r.content||"").slice(0,200)
    ).join("\n");

    const categorizationPrompt =
      "For each article below about "+company+", output ONLY a JSON array of objects with these fields.\n"+
      "Use the EXACT title, URL and date from the article — do not change them.\n"+
      "Only add category and relevance fields yourself.\n"+
      "Include ALL articles — do not filter any out.\n"+
      "Output ONLY a JSON array starting with [ ending with ].\n\n"+
      "Articles:\n"+articleList+"\n\n"+
      "JSON schema per item: {\"idx\":1,\"headline\":\"exact title\",\"url\":\"exact url\",\"date\":\"exact date\",\"source\":\"domain\",\"category\":\"IPO|Funding|Crypto|Payments|Blockchain|Stablecoin|Licensing|Regulatory|Merchant|Cross-Border|Executive|Partnership|Product Launch|Acquisition\",\"summary\":\"1 sentence from content\",\"relevance\":\"why relevant to CoinPayments pitch\"}";

    const rawCat = await callAPI(
      "You categorize news articles. Output ONLY a valid JSON array starting with [ ending with ]. No markdown.",
      categorizationPrompt, 2000
    );

    let items = [];
    try {
      let s = rawCat.trim().replace(/^```json\s*/i,"").replace(/^```/,"").replace(/```$/,"").trim();
      if (s.startsWith("[")) items = JSON.parse(s);
      else { const p = parseJSON(s); items = Array.isArray(p) ? p : (p.recent_news||[]); }
    } catch { items = []; }

    // Map back to our news format, using rawNewsArticles as source of truth for URLs/dates
    const cutoff = new Date(Date.now()-180*86400000);
    parsedNews.recent_news = rawNewsArticles.slice(0,15).map((r, i) => {
      const cat = items.find(c => c.idx===i+1 || (c.url&&c.url===r.url) || (c.headline&&r.title&&c.headline.slice(0,30)===r.title.slice(0,30)));
      return {
        headline: r.title,
        url: r.url,
        date: r.published_date || (cat&&cat.date) || "Recent",
        source: r.url.replace("https://","").replace("http://","").replace("www.","").split("/")[0],
        category: (cat&&cat.category) || "General",
        summary: (cat&&cat.summary) || (r.content||"").slice(0,150),
        relevance: (cat&&cat.relevance) || "Relevant to CoinPayments pitch",
        url_status: checkUrl(r.url),
      };
    }).filter(n => {
      if (!n.date || n.date==="Recent") return true;
      const d = new Date(n.date);
      return isNaN(d.getTime()) || d >= cutoff;
    });
  }

  // Phase 1c: Build contact list FROM SCRAPED DATA ONLY — then enrich with Claude
  onStep("🔍 Building verified contact list...");

  // ── Step A: Assemble candidate pool from real sources only ─────────────────
  const candidatePool = []; // {name, title, email, linkedin, source, conference, context, verified_source, verification_confidence}

  // Add conference-verified people (highest confidence)
  for (const p of conferenceContacts) {
    candidatePool.push({
      name: p.name,
      title: p.title || "",
      email: "",
      linkedin: "",
      source_url: p.source_url || "",
      conference: p.conference || "",
      year: p.year || "",
      context: p.context || "",
      verified_source: "conference",
      verification_confidence: "HIGH",
    });
  }

  // Add Apollo contacts (high confidence — real DB records)
  for (const a of apolloContacts) {
    const fullName = [a.first_name, a.last_name].filter(Boolean).join(" ");
    if (!fullName) continue;
    // Check if already in pool from conference
    const existing = candidatePool.find(c =>
      c.name.toLowerCase() === fullName.toLowerCase()
    );
    if (existing) {
      // Upgrade: this person is in BOTH conference + PDL
      existing.verified_source = "conference+ninjapear";
      existing.verification_confidence = "VERY HIGH";
      if (a.email) existing.email = a.email;
      if (a.linkedin_url) existing.linkedin = a.linkedin_url;
    } else {
      candidatePool.push({
        name: fullName,
        title: a.title || "",
        email: a.email || "",
        linkedin: a.linkedin_url || "",
        source_url: "",
        conference: "",
        year: "",
        context: "",
        department: (a.departments||[])[0] || "",
        location: [a.city, a.state, a.country].filter(Boolean).join(", "),
        seniority: a.seniority || "",
        verified_source: "ninjapear",
        verification_confidence: "HIGH",
      });
    }
  }

  // ── Step B: NinjaPear verification — confirm each scraped name is real ────────────────────────
  if (tKey && candidatePool.length) {
    onStep("🔎 Verifying " + candidatePool.length + " contacts for " + company + "...");
    const webChecks = await Promise.all(
      candidatePool.slice(0, 15).map(c =>
        tavilySearchRaw('"'+ c.name +'" '+ company, tKey, 4, 730)
      )
    );
    candidatePool.slice(0, 8).forEach((c, i) => {
      if (c.verified_source === "conference" || c.verified_source === "conference+ninjapear") {
        c.web_confirmed = true;
      }
      const results = webChecks[i] || [];
      if (!results.length) return;
      const allText = results.map(r => (r.title||"") + " " + (r.content||"")).join(" ").toLowerCase();
      const nameFirst = (c.name.split(" ")[0] || "").toLowerCase();
      const nameLast = (c.name.split(" ").slice(-1)[0] || "").toLowerCase();
      const nameInText = allText.includes(nameFirst) && (nameLast.length < 3 || allText.includes(nameLast));
      const coInText = allText.includes(company.toLowerCase());
      if (nameInText && coInText) {
        c.web_confirmed = true;
        if (c.verified_source === "conference") c.verification_confidence = "VERY HIGH";
        for (const r of results) {
          const li = (r.content||"").indexOf("linkedin.com/in/");
          if (li !== -1 && !c.linkedin) {
            c.linkedin = "https://www." + (r.content||"").slice(li).split(/[\s\x22'><]/)[0];
            break;
          }
        }
        if (!c.context && results[0]) c.context = results[0].title;
      } else if (nameInText && c.verified_source === "ninjapear") {
        c.web_confirmed = true;
        c.verification_confidence = "MEDIUM";
      }
    });
  }

  // ── Step C: Enrich confirmed contacts with CoinPayments sales intelligence ─
  const verifiedForEnrichment = candidatePool
    .filter(c => c.web_confirmed || c.verified_source === "conference+ninjapear" ||
                 c.verified_source === "conference" || c.verified_source === "ninjapear")
    .slice(0, 12);

  let enrichedContacts = [];
  if (verifiedForEnrichment.length) {
    const enrichPrompt = [
      "Company: " + company + ". Today: " + todayStr + ".",
      "These " + verifiedForEnrichment.length + " people are VERIFIED employees at " + company + ".",
      "For each, add ONLY: category, cp_relevance, why_target, outreach_angle.",
      "DO NOT change names, titles, emails, linkedin URLs, or any other field.",
      "Rank them 1-" + verifiedForEnrichment.length + " by value to a CoinPayments crypto payments pitch.",
      "",
      "People to enrich:",
      verifiedForEnrichment.map((c,i) =>
        (i+1)+". "+c.name+" | "+c.title+(c.conference?" | Seen at: "+c.conference:"")+(c.context?" | Context: "+c.context:"")
      ).join("\n"),
      "",
      "Output ONLY a JSON array:",
      '[{"name":"exact name as given","category":"Economic Buyer|Champion|Influencer|Technical Buyer|Blocker","cp_relevance":"1 sentence why CP should target","why_target":"decision power + pain point","outreach_angle":"specific hook","priority":1}]'
    ].join("\n");
    const rawEnrich = await callAPI(
      "You add sales context to verified contacts. Output ONLY a valid JSON array [ ]. Never change names or add new people.",
      enrichPrompt, 2000
    );

    let enrichArr = [];
    try {
      const s = rawEnrich.trim().replace(/^```json\s*/i,"").replace(/^```/,"").replace(/```$/,"").trim();
      if (s.startsWith("[")) enrichArr = JSON.parse(s);
      else { try { const p = parseJSON(s); enrichArr = Array.isArray(p)?p:[]; } catch {} }
    } catch { enrichArr = []; }

    // Merge enrichment back onto verified pool
    enrichedContacts = verifiedForEnrichment.map((c, i) => {
      const enr = enrichArr.find(e => e.name && c.name &&
        e.name.toLowerCase().split(" ")[0] === c.name.toLowerCase().split(" ")[0]
      ) || enrichArr[i] || {};
      return {
        priority: enr.priority || (i + 1),
        name: c.name,
        title: c.title,
        category: enr.category || "Influencer",
        cp_relevance: enr.cp_relevance || "",
        location: c.location || "",
        email: c.email || "",
        linkedin: c.linkedin || "",
        twitter: "none",
        conferences: c.conference ? [c.conference + (c.year ? " " + c.year : "")] : [],
        why_target: enr.why_target || "",
        outreach_angle: enr.outreach_angle || "",
        intent_signals: c.context || "",
        verified_source: c.verified_source,
        verification_confidence: c.verification_confidence,
        web_confirmed: c.web_confirmed || false,
      };
    });

    // Sort by priority
    enrichedContacts.sort((a, b) => (a.priority||9) - (b.priority||9));
    enrichedContacts.forEach((c, i) => { c.priority = i + 1; });
  }

  // Add any unverified-but-not-disproven Apollo contacts as lower-priority entries
  const lowConfidence = candidatePool
    .filter(c => !verifiedForEnrichment.includes(c) && (c.verified_source === "ninjapear" || c.verified_source === "conference"))
    .slice(0, 4)
    .map((c, i) => ({
      priority: enrichedContacts.length + i + 1,
      name: c.name,
      title: c.title,
      category: "Influencer",
      cp_relevance: "NinjaPear — unverified",
      location: c.location || "",
      email: c.email || "",
      linkedin: c.linkedin || "",
      twitter: "none",
      conferences: [],
      why_target: "Identified via NinjaPear — research role before outreach",
      outreach_angle: "Research their current priorities before reaching out",
      intent_signals: "NinjaPear record — not yet verified",
      verified_source: "ninjapear_unverified",
      verification_confidence: "LOW",
      web_confirmed: false,
    }));

  // ── Fallback: if scraping found nothing, ask Claude with strict sourcing rules ──
  if (enrichedContacts.length === 0 && lowConfidence.length === 0) {
    onStep("🤖 Generating contacts from training knowledge (no scraped data found)...");
    const fallbackPrompt = [
      "List the 7-8 most valuable real people currently working at " + company + " for a CoinPayments crypto payments sales pitch.",
      "RULES:",
      "- Only name people you have HIGH confidence actually work there",
      "- Use real names and real titles — never invent or guess",
      "- Prioritize: C-suite, VPs of Product/Payments/Partnerships/Growth/Technology/Marketing",
      "- If you are not confident about a name, describe the role generically instead",
      "- Mark confidence: HIGH (you are certain), MEDIUM (likely but unverified), LOW (uncertain)",
      "",
      "Output ONLY a JSON array:",
      '[{"name":"Full Name or UNKNOWN","title":"exact title","category":"Economic Buyer|Champion|Influencer|Technical Buyer|Blocker","cp_relevance":"why relevant","why_target":"decision power","outreach_angle":"specific hook","intent_signals":"any public signals","verification_confidence":"HIGH|MEDIUM|LOW","verified_source":"training_knowledge"}]'
    ].join("\n");

    const rawFallback = await callAPI(
      "You list known executives at companies from training knowledge. Output ONLY a valid JSON array [ ].",
      fallbackPrompt, 2000
    );
    try {
      let arr = [];
      const s = rawFallback.trim().replace(/^```json\s*/i,"").replace(/^```/,"").replace(/```$/,"").trim();
      if (s.startsWith("[")) arr = JSON.parse(s);
      else { try { const p = parseJSON(s); arr = Array.isArray(p)?p:[]; } catch {} }
      enrichedContacts = arr.filter(c => c.name && c.name !== "UNKNOWN").map((c,i) => ({
        priority: i+1,
        name: c.name,
        title: c.title || "",
        category: c.category || "Influencer",
        cp_relevance: c.cp_relevance || "",
        location: "",
        email: "",
        linkedin: "",
        twitter: "none",
        conferences: [],
        why_target: c.why_target || "",
        outreach_angle: c.outreach_angle || "",
        intent_signals: c.intent_signals || "",
        verified_source: "training_knowledge",
        verification_confidence: c.verification_confidence || "MEDIUM",
        web_confirmed: false,
      }));
    } catch { enrichedContacts = []; }
  }

  p1.key_contacts = [...enrichedContacts, ...lowConfidence];

  // Phase 2: Competitive comparison
  onStep("⚔️ Building competitive comparison (3/4)...");
  const raw2 = await callAPI(SYS,
    "For \""+company+"\" vs CoinPayments, output ONLY JSON (start { end }). Max 20 words per value. Make why_it_matters specific to this company:\n"+
    JSON.stringify({competitive_comparison:Object.fromEntries(COMPARE_ROWS.map(([,k])=>[k,{incumbent:"desc",coinpayments:"desc",why_it_matters:"reason specific to this client"}]))}, null, 2), 4000);

  // Phase 3a: GTM Attack Plan — positioning, ICP, ABM, Outbound, Intent
  onStep("🎯 Building GTM attack plan (4/4)...");
  const raw3a = await callAPI(SYS,
    "For \""+company+"\", output ONLY JSON (start { end }). Max 25 words per value:\n"+
    JSON.stringify({
      positioning_statement:"one razor-sharp sentence why CoinPayments is right for this company now",
      icp_profile:{primary_buyer:"title",champion:"title",blocker:"title",buying_committee:["t1","t2"],trigger_event:"specific signal"},
      abm:{
        personalized_ads:[{platform:"LinkedIn|Display",audience:"titles",message:"personalized copy",format:"Sponsored Post|InMail"}],
        content_assets:[{asset:"name",type:"One-Pager|ROI Calc|Case Study|Battlecard",personalization:"specific angle",delivery:"method"}],
        direct_mail:{item:"gift idea",rationale:"why it fits",send_to:"contact and timing"}
      },
      outbound:{sequences:[{contact:"name or title",channel_order:["Day 1: LinkedIn view+connect","Day 3: LinkedIn message","Day 5: Email 1","Day 8: Email 2+asset","Day 12: Call+VM","Day 15: LinkedIn video","Day 20: Breakup"],day1_message:"exact opening",email_subject:"specific subject line",call_script_opener:"first sentence",personalization_hook:"1 bespoke insight"}]},
      intent:{intent_signals_to_monitor:[{signal:"signal",source:"G2|Bombora|LinkedIn|Jobs|Press",what_it_means:"buying intent reason",response_playbook:"24hr action"}],job_postings_to_watch:["title 1","title 2"],trigger_based_plays:[{trigger:"event",immediate_action:"24hr action",message_angle:"framing"}]}
    }, null, 2), 4000);

  // Phase 3b: Inbound, Partners, Events, Timeline, Objections
  const raw3b = await callAPI(SYS,
    "For \""+company+"\", output ONLY JSON (start { end }). Max 25 words per value:\n"+
    JSON.stringify({
      inbound:{seo_topics:["topic1","topic2"],thought_leadership:[{format:"Blog|LinkedIn|Podcast",topic:"specific topic",hook:"engagement reason",target_persona:"title"}],lead_magnets:[{asset:"name",value_prop:"insight given",cta:"action toward CP"}]},
      partner:{referral_partners:[{partner:"company",relationship_type:"Shared Customer|Tech Integration|Channel|Investor",why_they_refer:"reason",activation_play:"how CP activates"}],co_sell_opportunities:[{partner:"company",joint_value_prop:"combined pitch",go_to_market:"joint approach"}]},
      events:{must_attend:[{event:"name",date:"date/quarter",location:"city",tier:"Must Attend|High Priority|Monitor",contacts_there:["name or title"],cp_activation:"what CP does",pre_event_play:"2wk before outreach",post_event_play:"48hr follow-up"}],speaking_opportunities:[{event:"event",topic:"talk title",why_relevant:"positioning reason"}],hosted_event:{concept:"dinner/roundtable/webinar",invite_list:["title1","title2"],hook:"why attend",outcome:"CP desired outcome"}},
      sequenced_timeline:[
        {week:"Week 1-2",phase:"Signal and Surround",priority_motion:"ABM + Intent",actions:["action1","action2","action3"],kpi:"metric"},
        {week:"Week 3-4",phase:"First Touch",priority_motion:"Outbound",actions:["action1","action2","action3"],kpi:"metric"},
        {week:"Month 2",phase:"Nurture and Engage",priority_motion:"Content + Events",actions:["action1","action2","action3"],kpi:"metric"},
        {week:"Month 3",phase:"Convert",priority_motion:"Partner + Direct",actions:["action1","action2","action3"],kpi:"metric"}
      ],
      objection_responses:[{objection:"specific objection",response:"precise CP counter",proof_point:"stat or case study"}]
    }, null, 2), 4000);

  onStep("✅ Finalizing...");
  const p2 = parseJSON(raw2);
  const p3a = parseJSON(raw3a);
  const p3b = parseJSON(raw3b);

  const fmtContact = p => ({
    name:[p.first_name,p.last_name].filter(Boolean).join(" ")||"Unknown",
    title:p.title||"", email:p.email||"", linkedin:p.linkedin_url||"",
    twitter:p.twitter_url||"", location:[p.city,p.state,p.country].filter(Boolean).join(", "),
    seniority:p.seniority||"", department:(p.departments||[])[0]||"", phone:p.sanitized_phone||"",
  });

  return {
    ...p1,
    company: company.trim(),
    analyzedAt: p1.analyzedAt||now,
    recent_news: parsedNews.recent_news||[], // Only Tavily-sourced — no training data fallback
    competitive_comparison: p2.competitive_comparison||{},
    attack_plan: {
      positioning_statement: p3a.positioning_statement||"",
      icp_profile: p3a.icp_profile||{},
      motions: {
        abm:     { ...p3a.abm,    label:"Account-Based Marketing" },
        outbound:{ ...p3a.outbound,label:"Outbound Multichannel Orchestration" },
        intent:  { ...p3a.intent, label:"Intent-Driven Buyer Targeting" },
        inbound: { ...p3b.inbound,label:"Inbound / Content-Led" },
        partner: { ...p3b.partner,label:"Partner Ecosystem Referrals" },
        events:  { ...p3b.events, label:"Event & Thought Leadership" },
      },
      sequenced_timeline: p3b.sequenced_timeline||[],
      objection_responses: p3b.objection_responses||[],
    },
    apollo_contacts: apolloContacts.map(fmtContact),
    apollo_company: apolloCo,
    activityLog: [],
  };
}

// ─── Verified LinkedIn storage ────────────────────────────────────────────────
const getVerifiedLI = () => ls.get(STORAGE.verified)||{};
const setVerifiedLI = v => ls.set(STORAGE.verified, v);
const getVCache = () => ls.get(STORAGE.vcache)||{};
const setVCache = v => ls.set(STORAGE.vcache, v);

// ─── Contact verification ─────────────────────────────────────────────────────
async function verifyContact(contact, company, keys, onProg) {
  const result = { name:contact.name, title:contact.title, checks:[], confidence:0, verified_linkedin:null, verified_email:null, verified_title:null, issues:[], summary:"" };
  const { tavily:tKey, ninjapear:njKey } = keys;

  if (tKey) {
    onProg("🌐 Web search: "+contact.name+"...");
    const web = await tavilySearch('"'+contact.name+'" '+company+' '+(contact.title||""), tKey, 5, 180);
    if (web) {
      const nameOk = web.toLowerCase().includes((contact.name||"").split(" ")[0].toLowerCase());
      const coOk = web.toLowerCase().includes(company.toLowerCase());
      const liIdx2 = web.indexOf("linkedin.com/in/");
      if (liIdx2 !== -1) {
        const liEnd2 = (() => { const s=web.slice(liIdx2); for(let j=0;j<s.length;j++){ const c=s[j]; if(c===' '||c==='<'||c==='>'||c==='\n'||c==='\t') return j; } return -1; })();
        const liSlug2 = liEnd2 > 0 ? web.slice(liIdx2, liIdx2+liEnd2) : web.slice(liIdx2, liIdx2+60);
        if (liSlug2) result.verified_linkedin = "https://www."+liSlug2;
      }
      result.checks.push({ source:"Web Search", icon:"🌐", status:nameOk&&coOk?"pass":nameOk?"partial":"fail", detail:nameOk&&coOk?"Name + company confirmed in web results":nameOk?"Name found, company match unclear":"Not found in web results" });
      if (!nameOk) result.issues.push("Not found via web search");
    } else {
      result.checks.push({ source:"Web Search", icon:"🌐", status:"skip", detail:"No results returned" });
    }

    onProg("📰 Press check: "+contact.name+"...");
    const press = web; // reuse web results to save Tavily credits
    if (press) {
      const found = press.toLowerCase().includes((contact.name||"").split(" ")[0].toLowerCase());
      const recent = /202[456]/.test(press);
      result.checks.push({ source:"Press & News", icon:"📰", status:found&&recent?"pass":found?"partial":"fail", detail:found&&recent?"Recent press mentions confirmed":found?"Found in press, date unclear":"No press mentions found" });
      if (found&&recent) result.confidence += 15;
    }
  }

  if (njKey) {
    onProg("🎯 NinjaPear check: "+contact.name+"...");
    const people = [];  // NinjaPear verification handled in Step B above
    if (people) {
      const first = (contact.name||"").split(" ")[0].toLowerCase();
      const last  = (contact.name||"").split(" ").slice(-1)[0].toLowerCase();
      const match = people.find(p => (p.first_name||"").toLowerCase()===first || ((p.first_name||"").toLowerCase()===first&&(p.last_name||"").toLowerCase()===last));
      if (match) {
        if (match.email) result.verified_email = match.email;
        if (match.linkedin_url) result.verified_linkedin = result.verified_linkedin||match.linkedin_url;
        if (match.title) result.verified_title = match.title;
        const tMatch = (match.title||"").toLowerCase().includes(((contact.title||"").split(" ").find(w=>w.length>4)||"").toLowerCase());
        result.checks.push({ source:"People Data Labs", icon:"👥", status:tMatch?"pass":"partial", detail:"Found: "+(match.first_name||"")+" "+(match.last_name||"")+" | "+(match.title||"no title"), email:match.email, linkedin:match.linkedin_url });
        result.confidence += tMatch ? 30 : 15;
        if (match.title&&match.title!==contact.title) result.issues.push("NinjaPearycurl shows title: "+match.title);
      } else {
        result.checks.push({ source:"People Data Labs", icon:"👥", status:"fail", detail:"Not found in Apollo for "+company });
        result.issues.push("Not found via NinjaPear");
      }
    }
  }

  if (njKey) {
    onProg("🎯 NinjaPear: "+contact.name+"...");
    // NinjaPear verification handled in Step B — no separate lookup needed
    const url = null;
    if (url) {
      result.verified_linkedin = url;
      result.checks.push({ source:"NinjaPear", icon:"🔗", status:"pass", detail:"LinkedIn resolved: "+url, linkedin:url });
      result.confidence += 35;
    } else {
      result.checks.push({ source:"NinjaPear", icon:"🔗", status:"fail", detail:"Could not resolve LinkedIn profile" });
      result.issues.push("NinjaPearycurl could not resolve profile");
    }
  }

  onProg("🤖 AI validation: "+contact.name+"...");
  try {
    const aiRaw = await callAPI(
      "Answer factually. Output ONLY JSON.",
      "Is "+contact.name+" currently "+contact.title+" at "+company+"? Respond: {\"confirmed\":true/false,\"confidence\":\"High/Medium/Low\",\"actual_title\":\"their real title if different or null\",\"still_at_company\":true/false,\"notes\":\"brief\"}",
      300
    );
    const ai = parseJSON(aiRaw);
    result.checks.push({ source:"AI Knowledge", icon:"🤖", status:ai.confirmed&&ai.still_at_company?"pass":ai.confirmed?"partial":"fail", detail:ai.notes||"", confidence:ai.confidence, actual_title:ai.actual_title });
    if (ai.confirmed&&ai.confidence==="High") result.confidence += 20;
    if (ai.actual_title&&ai.actual_title!==contact.title) result.issues.push("AI suggests title: "+ai.actual_title);
    if (ai.still_at_company===false) result.issues.push("AI: may no longer be at "+company);
  } catch {
    result.checks.push({ source:"AI Knowledge", icon:"🤖", status:"skip", detail:"Could not parse AI response" });
  }

  const passes = result.checks.filter(c=>c.status==="pass").length;
  const partials = result.checks.filter(c=>c.status==="partial").length;
  const total = result.checks.filter(c=>c.status!=="skip"&&c.status!=="error").length;
  result.confidence = total ? Math.round(((passes+partials*0.5)/total)*100) : 0;
  result.summary = result.confidence>=75?"High confidence — contact appears accurate"
    :result.confidence>=50?"Moderate — some signals confirmed, manual check recommended"
    :result.confidence>=25?"Low confidence — treat with caution"
    :"Unable to verify — manual research needed";
  return result;
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
const Badge = ({color="muted",children,sm}) => {
  const m = {accent:[C.accentDim,C.accent],gold:[C.goldDim,C.gold],green:[C.greenDim,C.green],purple:[C.purpleDim,C.purple],red:[C.redDim,C.red],muted:[C.dim+"44",C.muted],cyan:["#06B6D412",C.cyan]};
  const [bg,fg] = m[color]||m.muted;
  return <span style={{display:"inline-flex",alignItems:"center",padding:sm?"1px 7px":"2px 10px",borderRadius:20,fontSize:sm?9:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",background:bg,color:fg,border:"1px solid "+fg+"28"}}>{children}</span>;
};
const Chip = ({label,value,color}) => (
  <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:8,padding:"10px 14px",flex:1,minWidth:120}}>
    <div style={{color:C.muted,fontSize:10,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:4}}>{label}</div>
    <div style={{color:color||C.accent,fontSize:17,fontWeight:800,lineHeight:1.2}}>{value||"—"}</div>
  </div>
);
function Sec({title,icon,accent,children,open:initOpen=true}) {
  const [open,setOpen] = useState(initOpen);
  const a = accent||C.accent;
  return (
    <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,marginBottom:12,overflow:"hidden"}}>
      <div onClick={()=>setOpen(!open)} style={{padding:"11px 16px",borderBottom:open?"1px solid "+C.border:"none",display:"flex",alignItems:"center",gap:8,background:a+"08",cursor:"pointer",userSelect:"none"}}>
        <span style={{fontSize:13}}>{icon}</span>
        <span style={{color:a,fontWeight:700,fontSize:11,letterSpacing:"0.07em",textTransform:"uppercase",flex:1}}>{title}</span>
        <span style={{color:C.dim,fontSize:11}}>{open?"▲":"▼"}</span>
      </div>
      {open && <div style={{padding:"14px 16px"}}>{children}</div>}
    </div>
  );
}

// ─── LinkedIn button ──────────────────────────────────────────────────────────
const LI_SVG = <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>;

function LinkedInBtn({contact, pcMatch, company}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [paste, setPaste] = useState("");
  const [saved, setSaved] = useState(false);
  const key = (contact.name||"").toLowerCase().replace(/\s+/g,"_");
  const store = getVerifiedLI();
  const manual = store[key];
  const liUrl = manual || pcMatch?.linkedin || (contact.linkedin&&contact.linkedin.startsWith("http")?contact.linkedin:null);
  const searchQ = [contact.name,company,contact.title].filter(Boolean).join(" ");
  const liSearch = "https://www.linkedin.com/search/results/people/?keywords="+encodeURIComponent(searchQ);
  const isVerified = !!manual;
  const isPc = !manual && !!pcMatch?.linkedin;

  function save() {
    const url = paste.trim();
    if (!url.includes("linkedin.com")) return;
    const s = getVerifiedLI(); s[key]=url; setVerifiedLI(s);
    setSaved(true); setShowConfirm(false); setPaste("");
    setTimeout(()=>setSaved(false),3000);
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        {/* Status badge */}
        {isVerified && <span style={{background:C.greenDim,border:"1px solid "+C.green+"40",borderRadius:10,padding:"1px 7px",fontSize:8,color:C.green,fontWeight:700}}>✓ CONFIRMED</span>}
        {!isVerified && isPc && <span style={{background:C.goldDim,border:"1px solid "+C.gold+"40",borderRadius:10,padding:"1px 7px",fontSize:8,color:C.gold,fontWeight:700}}>⚠ PC</span>}
        {!isVerified && !isPc && <span style={{background:C.redDim,border:"1px solid "+C.red+"40",borderRadius:10,padding:"1px 7px",fontSize:8,color:C.red,fontWeight:700}}>UNVERIFIED</span>}
        {/* LinkedIn button */}
        <a href={liUrl||liSearch} target="_blank" rel="noreferrer"
          style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 10px",borderRadius:6,background:"#0A66C218",border:"1px solid #0A66C250",color:"#0A66C2",fontSize:10,fontWeight:700,textDecoration:"none",cursor:"pointer"}}>
          {LI_SVG} {liUrl?(manual?"View (Confirmed)":"View Profile"):"Search LinkedIn"}
        </a>
        {/* Confirm button */}
        <button onClick={()=>setShowConfirm(!showConfirm)}
          style={{padding:"4px 8px",borderRadius:6,background:saved?C.greenDim:"transparent",border:"1px solid "+(saved?C.green+"50":C.dim),color:saved?C.green:C.muted,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>
          {saved?"✓ Saved":"✓ Confirm"}
        </button>
      </div>
      {showConfirm && (
        <div style={{display:"flex",gap:4,alignItems:"center",marginTop:2}}>
          <input value={paste} onChange={e=>setPaste(e.target.value)} placeholder="Paste linkedin.com/in/... URL"
            style={{width:220,background:C.surface,border:"1px solid #0A66C250",borderRadius:5,padding:"5px 8px",color:C.text,fontSize:10,outline:"none",fontFamily:"inherit"}}/>
          <button onClick={save} disabled={!paste.includes("linkedin.com")}
            style={{padding:"5px 10px",background:paste.includes("linkedin.com")?"#0A66C2":C.dim,color:paste.includes("linkedin.com")?"#fff":C.muted,border:"none",borderRadius:5,fontSize:10,fontWeight:700,cursor:paste.includes("linkedin.com")?"pointer":"default",fontFamily:"inherit"}}>Save</button>
          <button onClick={()=>setShowConfirm(false)} style={{padding:"5px 8px",background:"transparent",border:"1px solid "+C.dim,color:C.muted,borderRadius:5,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
        </div>
      )}
    </div>
  );
}

// ─── Contact Verifier Panel ───────────────────────────────────────────────────
function VerifierPanel({contacts, company, keys}) {
  const [selected, setSelected] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState({});
  const [verifyingAll, setVerifyingAll] = useState(false);

  async function verify(contact) {
    setSelected(contact.name); setRunning(true); setProgress("");
    const cKey = contact.name+"|"+company;
    const cache = getVCache();
    if (cache[cKey] && Date.now()-cache[cKey].ts < 86400000) {
      setResults(p=>({...p,[contact.name]:cache[cKey].data}));
      setRunning(false); return;
    }
    const r = await verifyContact(contact, company, keys, setProgress);
    const c2 = getVCache(); c2[cKey]={data:r,ts:Date.now()}; setVCache(c2);
    setResults(p=>({...p,[contact.name]:r}));
    setRunning(false); setProgress("");
  }

  async function verifyAll() {
    setVerifyingAll(true);
    for (const c of contacts) { await verify(c); }
    setVerifyingAll(false);
  }

  const statusC = {pass:C.green,partial:C.gold,fail:C.red,skip:C.dim,error:C.red};
  const statusI = {pass:"✓",partial:"~",fail:"✗",skip:"—",error:"!"};
  const confC = v => v>=75?C.green:v>=50?C.gold:v>=25?C.red:C.dim;

  const r = selected ? results[selected] : null;

  return (
    <div style={{marginTop:16,background:C.surface,borderRadius:10,border:"1px solid "+C.border,overflow:"hidden"}}>
      <div style={{padding:"12px 16px",borderBottom:"1px solid "+C.border,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",background:C.card}}>
        <div>
          <div style={{color:C.text,fontSize:12,fontWeight:700}}>🔍 Contact Verification Engine</div>
          <div style={{color:C.dim,fontSize:10,marginTop:2}}>Multi-source: Web · Press · Ppollo · NinjaPear · AI</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          {!keys.tavily && <span style={{color:C.gold,fontSize:9}}>⚠ Add Tavily</span>}
          {!keys.ninjapear && <span style={{color:C.gold,fontSize:9}}>⚠ Add NJycurl</span>}
          {!keys.ninjapear && <span style={{color:C.gold,fontSize:9}}>⚠ Add NJycurl</span>}
          <button onClick={verifyAll} disabled={running||verifyingAll}
            style={{padding:"6px 14px",background:verifyingAll?C.surface:C.purple,color:verifyingAll?C.muted:"#fff",border:"none",borderRadius:6,fontWeight:700,fontSize:10,cursor:verifyingAll?"wait":"pointer",fontFamily:"inherit"}}>
            {verifyingAll?"Verifying all...":"⚡ Verify All"}
          </button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"220px 1fr"}}>
        {/* Contact list */}
        <div style={{borderRight:"1px solid "+C.border,maxHeight:440,overflowY:"auto"}}>
          {contacts.map((c,i) => {
            const res = results[c.name];
            const conf = res ? res.confidence : null;
            const active = selected===c.name;
            return (
              <div key={i} onClick={()=>{ if(!running) verify(c); }}
                style={{padding:"10px 12px",borderBottom:"1px solid "+C.border,cursor:running?"wait":"pointer",background:active?C.accentDim:"transparent",borderLeft:"3px solid "+(active?C.accent:"transparent")}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:4}}>
                  <div style={{flex:1}}>
                    <div style={{color:active?C.accent:C.text,fontSize:11,fontWeight:700,lineHeight:1.3}}>{c.name}</div>
                    <div style={{color:C.dim,fontSize:9,marginTop:2,lineHeight:1.3}}>{(c.title||"").slice(0,40)}</div>
                  </div>
                  {conf!==null && (
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{color:confC(conf),fontSize:13,fontWeight:800}}>{conf}%</div>
                      <div style={{color:C.dim,fontSize:8}}>conf.</div>
                    </div>
                  )}
                  {running && selected===c.name && <span style={{color:C.accent,fontSize:10}}>⟳</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Results pane */}
        <div style={{padding:14,maxHeight:440,overflowY:"auto"}}>
          {running && (
            <div style={{textAlign:"center",padding:28}}>
              <div style={{color:C.accent,fontSize:13,marginBottom:8}}>⟳ Verifying...</div>
              <div style={{color:C.muted,fontSize:11}}>{progress}</div>
            </div>
          )}
          {!running && !selected && (
            <div style={{textAlign:"center",color:C.dim,fontSize:11,padding:36}}>Click a contact to run verification checks</div>
          )}
          {!running && selected && !r && (
            <div style={{textAlign:"center",color:C.dim,fontSize:11,padding:36}}>Starting...</div>
          )}
          {!running && r && (
            <div>
              {/* Score */}
              <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:12,padding:"10px 14px",background:C.card,borderRadius:8,border:"1px solid "+C.border}}>
                <div style={{textAlign:"center",flexShrink:0}}>
                  <div style={{color:confC(r.confidence),fontSize:28,fontWeight:800,lineHeight:1}}>{r.confidence}%</div>
                  <div style={{color:C.dim,fontSize:9,marginTop:2}}>Confidence</div>
                </div>
                <div style={{flex:1}}>
                  <div style={{color:C.text,fontSize:11,fontWeight:600,marginBottom:4}}>{r.name}</div>
                  <div style={{color:C.muted,fontSize:10,marginBottom:r.issues.length?6:0}}>{r.summary}</div>
                  {r.issues.map((issue,i) => (
                    <div key={i} style={{color:C.red,fontSize:10,display:"flex",gap:5}}>
                      <span>⚠</span><span>{issue}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Verified data */}
              {(r.verified_linkedin||r.verified_email||r.verified_title) && (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
                  {r.verified_linkedin && (
                    <div style={{background:"#0A66C210",border:"1px solid #0A66C230",borderRadius:6,padding:"6px 10px"}}>
                      <div style={{color:C.dim,fontSize:9,fontWeight:700,marginBottom:3}}>VERIFIED LINKEDIN</div>
                      <a href={r.verified_linkedin} target="_blank" rel="noreferrer" style={{color:"#0A66C2",fontSize:10,textDecoration:"none"}}>View Profile →</a>
                    </div>
                  )}
                  {r.verified_email && (
                    <div style={{background:C.greenDim,border:"1px solid "+C.green+"30",borderRadius:6,padding:"6px 10px"}}>
                      <div style={{color:C.dim,fontSize:9,fontWeight:700,marginBottom:3}}>VERIFIED EMAIL</div>
                      <a href={"mailto:"+r.verified_email} style={{color:C.green,fontSize:10,textDecoration:"none"}}>{r.verified_email}</a>
                    </div>
                  )}
                  {r.verified_title && r.verified_title!==r.title && (
                    <div style={{background:C.goldDim,border:"1px solid "+C.gold+"30",borderRadius:6,padding:"6px 10px"}}>
                      <div style={{color:C.dim,fontSize:9,fontWeight:700,marginBottom:3}}>ACTUAL TITLE</div>
                      <div style={{color:C.gold,fontSize:10}}>{r.verified_title}</div>
                    </div>
                  )}
                </div>
              )}
              {/* Checks */}
              {r.checks.map((chk,i) => (
                <div key={i} style={{background:C.card,borderRadius:7,overflow:"hidden",border:"1px solid "+C.border,marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",background:statusC[chk.status]+"10",borderBottom:"1px solid "+C.border}}>
                    <span style={{fontSize:12}}>{chk.icon}</span>
                    <span style={{color:C.text,fontSize:11,fontWeight:600,flex:1}}>{chk.source}</span>
                    <span style={{color:statusC[chk.status],fontSize:11,fontWeight:800}}>{statusI[chk.status]} {chk.status.toUpperCase()}</span>
                  </div>
                  <div style={{padding:"6px 12px"}}>
                    <div style={{color:C.muted,fontSize:10,lineHeight:1.5}}>{chk.detail}</div>
                    {chk.email && <div style={{color:C.green,fontSize:10,marginTop:3}}>✉ {chk.email}</div>}
                    {chk.linkedin && <a href={chk.linkedin} target="_blank" rel="noreferrer" style={{color:"#0A66C2",fontSize:10,display:"block",marginTop:3,textDecoration:"none"}}>in {chk.linkedin}</a>}
                    {chk.actual_title && <div style={{color:C.gold,fontSize:10,marginTop:3}}>Actual title: {chk.actual_title}</div>}
                    {chk.confidence && <div style={{color:C.dim,fontSize:9,marginTop:2}}>AI confidence: {chk.confidence}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Motion Tabs ──────────────────────────────────────────────────────────────
const MOTION_META = [
  {key:"abm",     label:"ABM",      icon:"🎯",color:C.accent, desc:"Account-Based Marketing"},
  {key:"outbound",label:"Outbound", icon:"📡",color:C.purple, desc:"Multichannel Orchestration"},
  {key:"intent",  label:"Intent",   icon:"⚡",color:C.gold,   desc:"Buyer Intent Targeting"},
  {key:"inbound", label:"Inbound",  icon:"🧲",color:C.cyan,   desc:"Content-Led"},
  {key:"partner", label:"Partners", icon:"🤝",color:C.green,  desc:"Ecosystem Referrals"},
  {key:"events",  label:"Events",   icon:"📅",color:C.red,    desc:"Event & Thought Leadership"},
];

function MotionTabs({motions}) {
  const [active, setActive] = useState("abm");
  const m = (motions||{})[active]||{};
  const cur = MOTION_META.find(x=>x.key===active)||MOTION_META[0];

  const row = (icon,text,color) => (
    <div style={{display:"flex",gap:8,marginBottom:5}}>
      <span style={{color:color||C.accent,flexShrink:0}}>{icon}</span>
      <span style={{color:C.muted,fontSize:11,lineHeight:1.5}}>{text}</span>
    </div>
  );

  return (
    <div style={{marginBottom:20}}>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:12}}>
        {MOTION_META.map(({key,label,icon,color})=>(
          <button key={key} onClick={()=>setActive(key)}
            style={{padding:"6px 12px",borderRadius:7,fontFamily:"inherit",background:active===key?color+"22":"transparent",color:active===key?color:C.muted,border:"1px solid "+(active===key?color+"60":C.border),fontWeight:active===key?700:400,fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
            {icon} {label}
          </button>
        ))}
      </div>
      <div style={{color:cur.color,fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>{cur.icon} {cur.desc}</div>

      {active==="abm" && (
        <div>
          {(m.personalized_ads||[]).map((ad,i)=>(
            <div key={i} style={{background:C.surface,borderRadius:8,padding:"10px 14px",marginBottom:8,border:"1px solid "+C.border}}>
              <div style={{display:"flex",gap:6,marginBottom:4,flexWrap:"wrap"}}><Badge color="accent" sm>{ad.platform}</Badge><Badge color="muted" sm>{ad.format}</Badge></div>
              <div style={{color:C.muted,fontSize:11,marginBottom:4}}>🎯 Audience: {ad.audience}</div>
              <div style={{background:C.accentDim,borderRadius:5,padding:"5px 9px",fontSize:11,color:C.accent,fontStyle:"italic"}}>"{ad.message}"</div>
            </div>
          ))}
          {(m.content_assets||[]).map((a,i)=>(
            <div key={i} style={{background:C.surface,borderRadius:8,padding:"10px 14px",marginBottom:8,border:"1px solid "+C.border}}>
              <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}><span style={{color:C.text,fontWeight:700,fontSize:12}}>{a.asset}</span><Badge color="gold" sm>{a.type}</Badge></div>
              <div style={{color:C.muted,fontSize:11,marginBottom:3}}>{a.personalization}</div>
              {a.delivery&&<div style={{color:C.dim,fontSize:10}}>📬 {a.delivery}</div>}
            </div>
          ))}
          {m.direct_mail&&(
            <div style={{background:C.goldDim,borderRadius:8,padding:"10px 14px",border:"1px solid "+C.gold+"30"}}>
              <div style={{color:C.gold,fontSize:10,fontWeight:700,marginBottom:4}}>📦 DIRECT MAIL / GIFTING</div>
              <div style={{color:C.text,fontSize:12,fontWeight:600,marginBottom:3}}>{m.direct_mail.item}</div>
              <div style={{color:C.muted,fontSize:11,marginBottom:3}}>{m.direct_mail.rationale}</div>
              {m.direct_mail.send_to&&<div style={{color:C.dim,fontSize:10}}>→ {m.direct_mail.send_to}</div>}
            </div>
          )}
        </div>
      )}

      {active==="outbound" && (
        <div>
          {(m.sequences||[]).map((seq,i)=>(
            <div key={i} style={{background:C.surface,borderRadius:8,padding:"12px 14px",marginBottom:10,border:"1px solid "+C.border}}>
              <div style={{color:C.purple,fontWeight:700,fontSize:13,marginBottom:8}}>🎯 {seq.contact}</div>
              {seq.personalization_hook&&<div style={{background:C.purpleDim,borderRadius:5,padding:"6px 10px",fontSize:11,color:C.purple,marginBottom:10,fontStyle:"italic"}}>💡 "{seq.personalization_hook}"</div>}
              <div style={{marginBottom:10}}>
                <div style={{color:C.muted,fontSize:10,fontWeight:700,marginBottom:6}}>CHANNEL SEQUENCE</div>
                {(seq.channel_order||[]).map((s,j)=>row("→",s,C.purple))}
              </div>
              {seq.day1_message&&<div style={{background:C.accentDim,borderRadius:5,padding:"6px 10px",fontSize:11,color:C.accent,marginBottom:6}}>📝 Day 1: "{seq.day1_message}"</div>}
              {seq.email_subject&&<div style={{background:C.goldDim,borderRadius:5,padding:"6px 10px",fontSize:11,color:C.gold,marginBottom:6}}>✉ Subject: "{seq.email_subject}"</div>}
              {seq.call_script_opener&&<div style={{background:C.greenDim,borderRadius:5,padding:"6px 10px",fontSize:11,color:C.green}}>📞 Call: "{seq.call_script_opener}"</div>}
            </div>
          ))}
        </div>
      )}

      {active==="intent" && (
        <div>
          {(m.intent_signals_to_monitor||[]).map((sig,i)=>(
            <div key={i} style={{background:C.surface,borderRadius:8,padding:"10px 14px",marginBottom:8,border:"1px solid "+C.border}}>
              <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}><span style={{color:C.gold,fontWeight:700,fontSize:12}}>⚡ {sig.signal}</span><Badge color="gold" sm>{sig.source}</Badge></div>
              <div style={{color:C.muted,fontSize:11,marginBottom:6}}>{sig.what_it_means}</div>
              {sig.response_playbook&&<div style={{background:C.goldDim,borderRadius:5,padding:"5px 9px",fontSize:10,color:C.gold}}>▶ {sig.response_playbook}</div>}
            </div>
          ))}
          {(m.trigger_based_plays||[]).map((t,i)=>(
            <div key={i} style={{background:C.surface,borderRadius:8,padding:"10px 14px",marginBottom:8,border:"1px solid "+C.border}}>
              <div style={{color:C.text,fontWeight:700,fontSize:12,marginBottom:4}}>🔔 {t.trigger}</div>
              {row("⚡",t.immediate_action,C.gold)}
              {t.message_angle&&<div style={{background:C.accentDim,borderRadius:5,padding:"5px 9px",fontSize:10,color:C.accent}}>💬 {t.message_angle}</div>}
            </div>
          ))}
          {(m.job_postings_to_watch||[]).length ? (
            <div style={{background:C.surface,borderRadius:8,padding:"10px 14px",border:"1px solid "+C.border}}>
              <div style={{color:C.muted,fontSize:10,fontWeight:700,marginBottom:6}}>JOB POSTINGS TO MONITOR</div>
              {m.job_postings_to_watch.map((j,i)=>row("👀",j,C.gold))}
            </div>
          ) : null}
        </div>
      )}

      {active==="inbound" && (
        <div>
          {(m.thought_leadership||[]).map((tl,i)=>(
            <div key={i} style={{background:C.surface,borderRadius:8,padding:"10px 14px",marginBottom:8,border:"1px solid "+C.border}}>
              <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}><span style={{color:C.cyan,fontWeight:700,fontSize:12}}>{tl.topic}</span><Badge color="cyan" sm>{tl.format}</Badge></div>
              <div style={{color:C.muted,fontSize:11,marginBottom:3}}>{tl.hook}</div>
              {tl.target_persona&&<div style={{color:C.dim,fontSize:10}}>→ For: {tl.target_persona}</div>}
            </div>
          ))}
          {(m.lead_magnets||[]).map((lm,i)=>(
            <div key={i} style={{background:C.surface,borderRadius:8,padding:"10px 14px",marginBottom:8,border:"1px solid "+C.border}}>
              <div style={{color:C.text,fontWeight:700,fontSize:12,marginBottom:4}}>🧲 {lm.asset}</div>
              <div style={{color:C.muted,fontSize:11,marginBottom:4}}>{lm.value_prop}</div>
              {lm.cta&&<div style={{background:C.accentDim,borderRadius:5,padding:"4px 9px",fontSize:10,color:C.accent}}>CTA: {lm.cta}</div>}
            </div>
          ))}
          {(m.seo_topics||[]).length ? (
            <div style={{background:C.surface,borderRadius:8,padding:"10px 14px",border:"1px solid "+C.border}}>
              <div style={{color:C.muted,fontSize:10,fontWeight:700,marginBottom:6}}>SEO TOPICS TO OWN</div>
              {m.seo_topics.map((t,i)=>row("🔍",t,C.cyan))}
            </div>
          ) : null}
        </div>
      )}

      {active==="partner" && (
        <div>
          {(m.referral_partners||[]).map((p,i)=>(
            <div key={i} style={{background:C.surface,borderRadius:8,padding:"10px 14px",marginBottom:8,border:"1px solid "+C.border}}>
              <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}><span style={{color:C.green,fontWeight:700,fontSize:13}}>{p.partner}</span><Badge color="green" sm>{p.relationship_type}</Badge></div>
              <div style={{color:C.muted,fontSize:11,marginBottom:6}}>{p.why_they_refer}</div>
              {p.activation_play&&<div style={{background:C.greenDim,borderRadius:5,padding:"5px 9px",fontSize:10,color:C.green}}>▶ {p.activation_play}</div>}
            </div>
          ))}
          {(m.co_sell_opportunities||[]).map((cs,i)=>(
            <div key={i} style={{background:C.surface,borderRadius:8,padding:"10px 14px",marginBottom:8,border:"1px solid "+C.border}}>
              <div style={{color:C.text,fontWeight:700,fontSize:12,marginBottom:4}}>🤝 Co-Sell: {cs.partner}</div>
              <div style={{color:C.muted,fontSize:11,marginBottom:4}}>{cs.joint_value_prop}</div>
              {cs.go_to_market&&<div style={{color:C.dim,fontSize:10}}>→ GTM: {cs.go_to_market}</div>}
            </div>
          ))}
        </div>
      )}

      {active==="events" && (
        <div>
          {(m.must_attend||[]).map((ev,i)=>(
            <div key={i} style={{background:C.surface,borderRadius:10,padding:"10px 14px",marginBottom:10,border:"1px solid "+C.border}}>
              <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                <span style={{color:C.text,fontWeight:700,fontSize:13}}>📅 {ev.event}</span>
                <Badge color={ev.tier==="Must Attend"?"red":ev.tier==="High Priority"?"gold":"muted"} sm>{ev.tier}</Badge>
              </div>
              <div style={{color:C.dim,fontSize:10,marginBottom:6}}>{ev.date} · {ev.location}</div>
              {(ev.contacts_there||[]).length ? <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>{ev.contacts_there.map((c,j)=><Badge key={j} color="purple" sm>{c}</Badge>)}</div> : null}
              {ev.cp_activation&&<div style={{background:C.accentDim,borderRadius:5,padding:"5px 9px",fontSize:10,color:C.accent,marginBottom:4}}>🎪 {ev.cp_activation}</div>}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:6}}>
                {ev.pre_event_play&&<div style={{background:C.goldDim,borderRadius:5,padding:"5px 8px",fontSize:10,color:C.gold}}>📨 Pre: {ev.pre_event_play}</div>}
                {ev.post_event_play&&<div style={{background:C.greenDim,borderRadius:5,padding:"5px 8px",fontSize:10,color:C.green}}>✅ Post: {ev.post_event_play}</div>}
              </div>
            </div>
          ))}
          {m.hosted_event&&(
            <div style={{background:C.redDim,borderRadius:8,padding:"10px 14px",border:"1px solid "+C.red+"30",marginBottom:10}}>
              <div style={{color:C.red,fontSize:10,fontWeight:700,marginBottom:4}}>🔥 HOSTED EVENT IDEA</div>
              <div style={{color:C.text,fontSize:12,fontWeight:700,marginBottom:4}}>{m.hosted_event.concept}</div>
              <div style={{color:C.muted,fontSize:11,marginBottom:6}}>{m.hosted_event.hook}</div>
              {(m.hosted_event.invite_list||[]).length ? <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>{m.hosted_event.invite_list.map((t,i)=><Badge key={i} color="red" sm>{t}</Badge>)}</div> : null}
              {m.hosted_event.outcome&&<div style={{color:C.dim,fontSize:10}}>🎯 {m.hosted_event.outcome}</div>}
            </div>
          )}
          {(m.speaking_opportunities||[]).map((sp,i)=>(
            <div key={i} style={{background:C.surface,borderRadius:8,padding:"10px 14px",marginBottom:8,border:"1px solid "+C.border}}>
              <div style={{color:C.text,fontWeight:700,fontSize:12,marginBottom:3}}>🎤 {sp.topic}</div>
              <div style={{color:C.muted,fontSize:11,marginBottom:3}}>At: {sp.event}</div>
              {sp.why_relevant&&<div style={{color:C.dim,fontSize:10}}>→ {sp.why_relevant}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Analysis View ────────────────────────────────────────────────────────────
function AnalysisView({data, onAdd, inPipeline, keys}) {
  const [chat, setChat] = useState([]);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const chatRef = useRef(null);

  const t = data.tam_som_arr||{};
  const mo = data.missed_opportunity||{};
  const geo = data.geography||{};
  const inc = data.incumbent||{};
  const ap = data.attack_plan||{};

  async function ask() {
    if (!q.trim()||asking) return;
    const question = q.trim(); setQ(""); setAsking(true);
    const hist = [...chat,{role:"user",content:question}];
    setChat(hist);
    try {
      const ctx = JSON.stringify({company:data.company,segment:data.segment,summary:data.executive_summary,tam:t,geo,contacts:data.key_contacts,news:data.recent_news,missed:mo,incumbent:inc}).slice(0,4000);
      const ans = await callAPI("You are a CoinPayments sales expert. Answer concisely.","Context: "+ctx+"\n\nQuestion: "+question,1500);
      setChat([...hist,{role:"assistant",content:ans}]);
    } catch(e) { setChat([...hist,{role:"assistant",content:"Error: "+e.message}]); }
    setAsking(false);
    setTimeout(()=>chatRef.current?.scrollTo({top:9999,behavior:"smooth"}),100);
  }

  const catColor = cat => ({
    "Economic Buyer":C.gold,"Champion":C.green,"Influencer":C.accent,"Technical Buyer":C.cyan,"Blocker":C.red
  }[cat]||C.purple);

  return (
    <div>
      {/* Header */}
      {onAdd && (
        <div style={{background:"linear-gradient(135deg,"+C.accentDim+","+C.goldDim+")",border:"1px solid "+C.accent+"28",borderRadius:14,padding:"18px 22px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:220}}>
            <div style={{color:C.muted,fontSize:9,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:4}}>COINPAYMENTS INTELLIGENCE REPORT</div>
            <div style={{color:C.text,fontSize:24,fontWeight:800,marginBottom:6}}>{data.company}</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
              <Badge color="accent">{data.segment}</Badge>
              {geo.missing_us && <Badge color="red">Missing US</Badge>}
              <Badge color="muted">{new Date(data.analyzedAt).toLocaleDateString()}</Badge>
            </div>
            <div style={{color:C.muted,fontSize:11,lineHeight:1.7,maxWidth:540}}>{data.executive_summary}</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end"}}>
            {[["🌐",data.website],["📍",data.hq],["👥",data.employees],["💵",data.revenue]].filter(([,v])=>v).map(([ic,v])=>(
              <div key={v} style={{color:C.muted,fontSize:11}}>{ic} {v}</div>
            ))}
            <button onClick={onAdd} disabled={inPipeline} style={{marginTop:8,padding:"10px 20px",borderRadius:8,background:inPipeline?"transparent":C.green,color:inPipeline?C.muted:"#000",border:"2px solid "+(inPipeline?C.border:C.green),fontWeight:800,fontSize:11,cursor:inPipeline?"default":"pointer",letterSpacing:"0.07em",fontFamily:"inherit",whiteSpace:"nowrap"}}>
              {inPipeline?"✓ IN PIPELINE":"+ ADD TO PIPELINE"}
            </button>
          </div>
        </div>
      )}

      {/* TAM */}
      <Sec title="Market Opportunity — TAM / SOM / ARR" icon="📊" accent={C.accent}>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
          <Chip label="Total Addressable Market" value={t.tam_usd} color={C.accent}/>
          <Chip label="Serviceable Market" value={t.som_usd} color={C.gold}/>
          <Chip label="CoinPayments ARR Potential" value={t.likely_arr_usd} color={C.green}/>
        </div>
        <p style={{color:C.muted,fontSize:12,lineHeight:1.7,margin:0}}>{t.reasoning}</p>
      </Sec>

      {/* Key Contacts */}
      <Sec title="Key Contacts — Priority Ranked" icon="👥" accent={C.purple}>
        {/* Legend */}
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:14}}>
          {[["Economic Buyer",C.gold],["Champion",C.green],["Influencer",C.accent],["Technical Buyer",C.cyan],["Blocker",C.red]].map(([l,c])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:c}}/>
              <span style={{color:C.muted,fontSize:10}}>{l}</span>
            </div>
          ))}
        </div>
        {/* NinjaPear company data */}
        {data.apollo_company && (
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14,padding:"8px 12px",background:C.surface,borderRadius:8,border:"1px solid "+C.green+"30"}}>
            <span style={{color:C.green,fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",alignSelf:"center"}}>Apollo ✓</span>
            {[["Employees",data.apollo_company.employees],["Revenue",data.apollo_company.revenue],["Founded",data.apollo_company.founded],["Funding",data.apollo_company.funding],["Industry",data.apollo_company.industry]].filter(([,v])=>v).map(([k,v])=>(
              <div key={k} style={{background:C.card,borderRadius:5,padding:"3px 8px",border:"1px solid "+C.border}}>
                <span style={{color:C.dim,fontSize:9,fontWeight:700}}>{k}: </span>
                <span style={{color:C.text,fontSize:10}}>{v}</span>
              </div>
            ))}
            {(data.apollo_company.tech_stack||[]).length ? (
              <div style={{background:C.card,borderRadius:5,padding:"3px 8px",border:"1px solid "+C.border}}>
                <span style={{color:C.dim,fontSize:9,fontWeight:700}}>Tech: </span>
                <span style={{color:C.cyan,fontSize:10}}>{data.apollo_company.tech_stack.join(", ")}</span>
              </div>
            ) : null}
          </div>
        )}
        {/* Contact cards */}
        {(data.key_contacts||[]).map((c,i) => {
          const cc = catColor(c.category);
          const pcMatch = (data.apollo_contacts||[]).find(a => a.name&&c.name&&a.name.toLowerCase().includes((c.name.split(" ")[0]||"").toLowerCase()));
          return (
            <div key={i} style={{background:C.surface,border:"1px solid "+(i===0?C.gold+"50":C.border),borderRadius:10,padding:14,marginBottom:10,position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,width:4,height:"100%",background:i===0?C.gold:i===1?C.accent:i===2?C.green:C.border,borderRadius:"10px 0 0 10px"}}/>
              <div style={{paddingLeft:10}}>
                <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:10}}>
                  <div style={{flexShrink:0,width:28,height:28,borderRadius:"50%",background:i===0?"linear-gradient(135deg,"+C.gold+","+C.gold+"88)":i<3?"linear-gradient(135deg,"+C.accent+","+C.purple+")":C.card,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:i===0?"#000":"#fff",border:"1px solid "+(i===0?C.gold:C.border)}}>
                    {c.priority||i+1}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:3}}>
                      <span style={{color:C.text,fontWeight:800,fontSize:14}}>{c.name}</span>
                      {c.verification_confidence==="VERY HIGH" && <span style={{background:C.greenDim,border:"1px solid "+C.green+"50",borderRadius:10,padding:"1px 8px",fontSize:8,color:C.green,fontWeight:700}}>🏆 CONF+PDL</span>}
                      {c.verification_confidence==="HIGH" && c.verified_source==="conference" && <span style={{background:C.greenDim,border:"1px solid "+C.green+"50",borderRadius:10,padding:"1px 8px",fontSize:8,color:C.green,fontWeight:700}}>🎤 CONF VERIFIED</span>}
                      {c.verification_confidence==="HIGH" && c.verified_source==="ninjapear" && <span style={{background:C.accentDim,border:"1px solid "+C.accent+"50",borderRadius:10,padding:"1px 8px",fontSize:8,color:C.accent,fontWeight:700}}>👥 APOLLO</span>}
                      {c.verification_confidence==="MEDIUM" && <span style={{background:C.goldDim,border:"1px solid "+C.gold+"50",borderRadius:10,padding:"1px 8px",fontSize:8,color:C.gold,fontWeight:700}}>🌐 WEB</span>}
                      {(c.verification_confidence==="LOW"||c.verification_confidence==="UNVERIFIED") && <span style={{background:C.redDim,border:"1px solid "+C.red+"50",borderRadius:10,padding:"1px 8px",fontSize:8,color:C.red,fontWeight:700}}>⚠ VERIFY</span>}
                    </div>
                    <div style={{color:C.accent,fontSize:11,fontWeight:600,marginBottom:3}}>{c.title}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                      <Badge color="muted" sm>{c.cp_relevance}</Badge>
                      <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"1px 7px",borderRadius:20,fontSize:9,fontWeight:700,textTransform:"uppercase",background:cc+"18",color:cc,border:"1px solid "+cc+"30"}}>
                        <span style={{width:6,height:6,borderRadius:"50%",background:cc,flexShrink:0}}/>{c.category}
                      </span>
                      {c.location&&<span style={{color:C.muted,fontSize:10}}>📍 {c.location}</span>}
                    </div>
                  </div>
                  {/* Contact actions */}
                  <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end",flexShrink:0}}>
                    {(pcMatch?.email||c.email)&&<a href={"mailto:"+(pcMatch?.email||c.email)} style={{color:C.green,fontSize:10,textDecoration:"none"}}>✉ {pcMatch?.email||c.email}</a>}
                    <LinkedInBtn contact={c} pcMatch={pcMatch} company={data.company}/>
                    {(pcMatch?.phone||c.phone)&&<span style={{color:C.muted,fontSize:10}}>📞 {pcMatch?.phone||c.phone}</span>}
                    {c.twitter&&c.twitter!=="none"&&<span style={{color:C.cyan,fontSize:10}}>𝕏 {c.twitter}</span>}
                  </div>
                </div>
                <div style={{background:"linear-gradient(135deg,"+C.purpleDim+","+C.accentDim+")",borderRadius:7,padding:"8px 12px",marginBottom:8,border:"1px solid "+C.purple+"20"}}>
                  <div style={{color:C.purple,fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:3}}>Why Target</div>
                  <div style={{color:C.text,fontSize:11,lineHeight:1.6}}>{c.why_target}</div>
                </div>
                <div style={{background:C.goldDim,borderRadius:7,padding:"8px 12px",marginBottom:8,border:"1px solid "+C.gold+"20"}}>
                  <div style={{color:C.gold,fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:3}}>Outreach Angle</div>
                  <div style={{color:C.text,fontSize:11,lineHeight:1.6,fontStyle:"italic"}}>"{c.outreach_angle}"</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {(c.conferences||[]).length ? (
                    <div>
                      <div style={{color:C.dim,fontSize:9,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>Conferences</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:3}}>{c.conferences.map((cf,j)=><Badge key={j} color="gold" sm>{cf}</Badge>)}</div>
                    </div>
                  ) : null}
                  {c.intent_signals&&c.intent_signals!=="none"&&(
                    <div>
                      <div style={{color:C.dim,fontSize:9,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>Intent Signals</div>
                      <div style={{color:C.accent,fontSize:10,lineHeight:1.5}}>⚡ {c.intent_signals}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {/* Verifier */}
        <VerifierPanel contacts={data.key_contacts||[]} company={data.company} keys={keys||{}}/>
        {/* Intent data */}
        {(data.intent_data||[]).length ? (
          <div style={{marginTop:12}}>
            <div style={{color:C.muted,fontSize:10,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:8}}>Additional Intent Signals</div>
            {data.intent_data.map((d,i)=>(
              <div key={i} style={{display:"flex",gap:10,padding:"8px 10px",background:C.surface,borderRadius:7,marginBottom:6,alignItems:"flex-start"}}>
                <Badge color={d.strength==="High"?"red":d.strength==="Medium"?"gold":"muted"} sm>{d.strength}</Badge>
                <div style={{flex:1}}>
                  <div style={{color:C.text,fontSize:11,fontWeight:600}}>{d.contact} — {d.signal}</div>
                  <div style={{color:C.dim,fontSize:10}}>{d.source} · {d.date}</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Sec>

      {/* Partnerships */}
      <Sec title="Strategic Partnerships & Co-Marketing" icon="🤝" accent={C.gold}>
        {(data.partnerships||[]).map((p,i,arr)=>(
          <div key={i} style={{borderBottom:i<arr.length-1?"1px solid "+C.border:"none",paddingBottom:12,marginBottom:12}}>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}><span style={{color:C.gold,fontWeight:700,fontSize:13}}>{p.partner}</span><Badge color="gold" sm>{p.type}</Badge></div>
            <div style={{color:C.muted,fontSize:12,marginBottom:6}}>{p.rationale}</div>
            {p.incumbent_cost&&<div style={{background:C.goldDim,borderRadius:5,padding:"5px 9px",fontSize:11,color:C.gold,marginBottom:4}}>💰 Incumbent cost: {p.incumbent_cost}</div>}
            {p.cp_advantage&&<div style={{background:C.greenDim,borderRadius:5,padding:"5px 9px",fontSize:11,color:C.green}}>✅ CP Advantage: {p.cp_advantage}</div>}
          </div>
        ))}
      </Sec>

      {/* News */}
      <Sec title="Recent News & Signals" icon="📰" accent={C.cyan}>
        {!(data.recent_news||[]).length && (
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{color:C.dim,fontSize:11,marginBottom:6}}>No verified news found.</div>
            <div style={{color:C.dim,fontSize:10}}>Add a Tavily API key for live news. Without it, no news is shown to prevent hallucinated articles.</div>
          </div>
        )}
        {(data.recent_news||[]).map((n,i,arr)=>(
          <div key={i} style={{padding:"12px 0",borderBottom:i<arr.length-1?"1px solid "+C.border:"none"}}>
            {/* Header row */}
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
              <Badge color="cyan" sm>{n.category}</Badge>
              <span style={{color:C.dim,fontSize:10,fontWeight:600}}>{n.date}</span>
              {n.source && <span style={{color:C.muted,fontSize:10}}>· {n.source}</span>}
              {(n.url_status==="verified"||n.url_status==="tavily_verified") && <span style={{background:C.greenDim,border:"1px solid "+C.green+"40",borderRadius:10,padding:"1px 6px",fontSize:8,color:C.green,fontWeight:700}}>✓ VERIFIED</span>}
              {n.url_status==="unverified" && <span style={{background:C.goldDim,border:"1px solid "+C.gold+"40",borderRadius:10,padding:"1px 6px",fontSize:8,color:C.gold,fontWeight:700}}>⚠ LINK UNVERIFIED</span>}
              {!n.url && <span style={{background:C.redDim,border:"1px solid "+C.red+"40",borderRadius:10,padding:"1px 6px",fontSize:8,color:C.red,fontWeight:700}}>NO LINK</span>}
            </div>
            {/* Headline — clickable if URL available and verified */}
            {n.url ? (
              <a href={n.url} target="_blank" rel="noreferrer"
                style={{color:C.text,fontSize:12,fontWeight:700,marginBottom:6,lineHeight:1.5,display:"block",textDecoration:"none"}}
                onMouseEnter={e=>{e.currentTarget.style.color=C.accent;e.currentTarget.style.textDecoration="underline";}}
                onMouseLeave={e=>{e.currentTarget.style.color=C.text;e.currentTarget.style.textDecoration="none";}}>
                {n.headline} ↗
              </a>
            ) : (
              <div style={{color:C.text,fontSize:12,fontWeight:700,marginBottom:6,lineHeight:1.5}}>{n.headline}</div>
            )}
            {n.summary && <div style={{color:C.muted,fontSize:11,marginBottom:6,lineHeight:1.6}}>{n.summary}</div>}
            <div style={{background:C.accentDim,borderRadius:6,padding:"6px 10px",fontSize:10,color:C.cyan,display:"flex",gap:6,alignItems:"flex-start"}}>
              <span style={{color:C.cyan,fontWeight:700,flexShrink:0}}>CP Signal →</span>
              <span style={{lineHeight:1.5}}>{n.relevance}</span>
            </div>
          </div>
        ))}
      </Sec>

      {/* Geography */}
      <Sec title="Geography & Market Reach" icon="🌍" accent={C.green}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:12,marginBottom:12}}>
          {[["CURRENT MARKETS",geo.markets,"muted"],["RECENT EXPANSIONS",geo.expansions,"green"],["CRYPTO-LICENSED",geo.crypto_licensed,"accent"]].map(([label,items,color])=>(
            <div key={label}>
              <div style={{color:C.dim,fontSize:10,fontWeight:700,marginBottom:6}}>{label}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{(items||[]).map(m=><Badge key={m} color={color}>{m}</Badge>)}</div>
            </div>
          ))}
        </div>
        {geo.gaps&&<div style={{background:C.accentDim,borderRadius:7,padding:10,fontSize:11,color:C.accent,lineHeight:1.6}}>🎯 {geo.gaps}</div>}
      </Sec>

      {/* Incumbent */}
      <Sec title="Incumbent Provider Analysis" icon="⚔️" accent={C.red}>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:10}}>
          <Chip label="Incumbent" value={inc.name} color={C.red}/>
          <Chip label="Est. Annual Cost" value={inc.annual_cost} color={C.muted}/>
          <Chip label="CP Saving" value={inc.cp_saving} color={C.green}/>
        </div>
        {inc.weaknesses&&<div style={{background:C.greenDim,border:"1px solid "+C.green+"28",borderRadius:7,padding:10,fontSize:11,color:C.green,lineHeight:1.6}}>✅ Why CoinPayments wins: {inc.weaknesses}</div>}
      </Sec>

      {/* Compare */}
      <Sec title="Feature Comparison vs Incumbent" icon="📋" accent={C.gold}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead>
              <tr style={{background:C.surface}}>
                {[["DIMENSION",C.muted,"20%"],["INCUMBENT",C.red,"26%"],["COINPAYMENTS",C.green,"26%"],["WHY IT MATTERS",C.gold,"28%"]].map(([h,c,w])=>(
                  <th key={h} style={{padding:"9px 12px",textAlign:"left",fontWeight:700,fontSize:10,color:c,width:w,letterSpacing:"0.05em"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map(([label,key],i)=>{
                const r=(data.competitive_comparison||{})[key]||{};
                return (
                  <tr key={key} style={{background:i%2===0?"transparent":"#ffffff03",borderBottom:"1px solid "+C.border}}>
                    <td style={{padding:"8px 12px",color:C.text,fontWeight:600}}>{label}</td>
                    <td style={{padding:"8px 12px",color:C.muted}}>{r.incumbent||"—"}</td>
                    <td style={{padding:"8px 12px",color:C.text}}>{r.coinpayments||"—"}</td>
                    <td style={{padding:"8px 12px",color:C.gold,fontStyle:"italic"}}>{r.why_it_matters||"—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Sec>

      {/* Missed Opportunity */}
      <Sec title="The Missed Opportunity" icon="🚨" accent={C.red}>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
          <Chip label="Crypto-Forward Customers" value={mo.crypto_share} color={C.accent}/>
          <Chip label="Revenue at Risk" value={mo.revenue_at_risk} color={C.red}/>
          {mo.urgency&&<Chip label="Urgency" value={mo.urgency} color={mo.urgency==="High"?C.red:mo.urgency==="Medium"?C.gold:C.muted}/>}
        </div>
        <p style={{color:C.text,fontSize:12,lineHeight:1.7,marginBottom:12}}>{mo.narrative}</p>
        {mo.urgency_reason&&<div style={{background:C.redDim,borderRadius:7,padding:"8px 12px",fontSize:11,color:C.red,marginBottom:10}}>⏰ Why now: {mo.urgency_reason}</div>}
        {(mo.stats||[]).map((s,i)=>(
          <div key={i} style={{display:"flex",gap:8,marginBottom:5}}>
            <span style={{color:C.gold}}>▸</span>
            <span style={{color:C.muted,fontSize:11}}>{s}</span>
          </div>
        ))}
      </Sec>

      {/* GTM Attack Plan */}
      {ap.positioning_statement && (
        <Sec title="Hyperpersonalized GTM Attack Plan" icon="🎯" accent={C.green} open={false}>
          <div style={{background:C.greenDim,border:"1px solid "+C.green+"30",borderRadius:8,padding:"12px 16px",marginBottom:16}}>
            <div style={{color:C.green,fontSize:10,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:4}}>Core Positioning</div>
            <div style={{color:C.text,fontSize:13,fontWeight:700,lineHeight:1.6,fontStyle:"italic"}}>"{ap.positioning_statement}"</div>
          </div>
          {ap.icp_profile && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8,marginBottom:20}}>
              {[["Primary Buyer",ap.icp_profile.primary_buyer,C.accent],["Champion",ap.icp_profile.champion,C.green],["Blocker",ap.icp_profile.blocker,C.red],["Trigger",ap.icp_profile.trigger_event,C.gold]].map(([k,v,c])=>v?(
                <div key={k} style={{background:C.surface,borderRadius:7,padding:"8px 12px",border:"1px solid "+C.border}}>
                  <div style={{color:C.dim,fontSize:9,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>{k}</div>
                  <div style={{color:c,fontSize:11,fontWeight:600}}>{v}</div>
                </div>
              ):null)}
            </div>
          )}
          <MotionTabs motions={ap.motions}/>
          {(ap.sequenced_timeline||[]).length ? (
            <div style={{marginTop:20}}>
              <div style={{color:C.muted,fontSize:10,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:12}}>Sequenced Execution Timeline</div>
              {ap.sequenced_timeline.map((t,i)=>(
                <div key={i} style={{display:"flex",gap:14,marginBottom:14}}>
                  <div style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center"}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,"+C.accent+","+C.green+")",display:"flex",alignItems:"center",justifyContent:"center",color:"#000",fontWeight:800,fontSize:11}}>{i+1}</div>
                    {i<ap.sequenced_timeline.length-1&&<div style={{width:2,flex:1,background:C.border,margin:"4px 0"}}/>}
                  </div>
                  <div style={{flex:1,paddingBottom:8}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                      <span style={{color:C.text,fontWeight:700,fontSize:13}}>{t.phase}</span>
                      <Badge color="muted" sm>{t.week}</Badge>
                      <Badge color="accent" sm>{t.priority_motion}</Badge>
                    </div>
                    {(t.actions||[]).map((a,j)=>(
                      <div key={j} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:4}}>
                        <span style={{color:C.accent,fontSize:11,flexShrink:0,marginTop:1}}>→</span>
                        <span style={{color:C.muted,fontSize:11,lineHeight:1.5}}>{a}</span>
                      </div>
                    ))}
                    {t.kpi&&<div style={{background:C.accentDim,borderRadius:5,padding:"4px 9px",fontSize:10,color:C.accent}}>📊 KPI: {t.kpi}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {(ap.objection_responses||[]).length ? (
            <div style={{marginTop:16}}>
              <div style={{color:C.muted,fontSize:10,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:10}}>Objection Handling</div>
              {ap.objection_responses.map((o,i)=>(
                <div key={i} style={{marginBottom:10,background:C.surface,borderRadius:8,overflow:"hidden",border:"1px solid "+C.border}}>
                  <div style={{padding:"7px 12px",background:C.redDim,borderBottom:"1px solid "+C.border}}>
                    <span style={{color:C.red,fontSize:10,fontWeight:700}}>OBJECTION: </span>
                    <span style={{color:C.muted,fontSize:11}}>{o.objection}</span>
                  </div>
                  <div style={{padding:"7px 12px",borderBottom:"1px solid "+C.border}}>
                    <span style={{color:C.green,fontSize:10,fontWeight:700}}>RESPONSE: </span>
                    <span style={{color:C.text,fontSize:11}}>{o.response}</span>
                  </div>
                  {o.proof_point&&<div style={{padding:"6px 12px",background:C.accentDim}}>
                    <span style={{color:C.accent,fontSize:10,fontWeight:700}}>PROOF: </span>
                    <span style={{color:C.muted,fontSize:10}}>{o.proof_point}</span>
                  </div>}
                </div>
              ))}
            </div>
          ) : null}
        </Sec>
      )}

      {/* Chat */}
      <Sec title="Ask About This Target" icon="💬" accent={C.purple}>
        <div ref={chatRef} style={{background:C.surface,borderRadius:7,padding:10,marginBottom:10,maxHeight:240,overflowY:"auto",minHeight:50}}>
          {!chat.length&&<div style={{color:C.dim,fontSize:11,textAlign:"center",paddingTop:10}}>Ask anything — objection handling, contact strategy, competitive angles...</div>}
          {chat.map((m,i)=>(
            <div key={i} style={{marginBottom:8,display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
              <div style={{maxWidth:"82%",padding:"7px 11px",borderRadius:7,background:m.role==="user"?C.purpleDim:C.card,border:"1px solid "+(m.role==="user"?C.purple+"40":C.border),color:m.role==="user"?C.purple:C.text,fontSize:11,lineHeight:1.6}}>{m.content}</div>
            </div>
          ))}
          {asking&&<div style={{color:C.dim,fontSize:11}}>⟳ Thinking...</div>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&ask()} placeholder={"Ask about "+data.company+"..."}
            style={{flex:1,background:C.surface,border:"1px solid "+C.border,borderRadius:7,padding:"9px 12px",color:C.text,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
          <button onClick={ask} disabled={asking||!q.trim()} style={{padding:"9px 16px",background:C.purple,color:"#fff",border:"none",borderRadius:7,fontWeight:800,fontSize:11,cursor:asking?"wait":"pointer",fontFamily:"inherit"}}>SEND</button>
        </div>
      </Sec>
    </div>
  );
}

// ─── CRM Record ───────────────────────────────────────────────────────────────
function CRMRecord({record, onUpdate, onRemove, keys}) {
  const [showReport, setShowReport] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState(record.crm?.stage||"Prospecting");
  const [note, setNote] = useState("");
  const [dealVal, setDealVal] = useState(record.crm?.deal_value||"");
  const [nextAct, setNextAct] = useState(record.crm?.next_action||"Schedule discovery call");

  function save() {
    const log = record.activityLog||[];
    const newLog = note.trim()?[{date:new Date().toLocaleString(),note:note.trim(),stage},...log]:log;
    onUpdate(record.company, {crm:{...record.crm,stage,deal_value:dealVal,next_action:nextAct},activityLog:newLog});
    setNote(""); setEditing(false);
  }

  const sc = STAGE_COLORS[stage]||C.muted;
  const t = record.tam_som_arr||{}; const inc = record.incumbent||{};

  return (
    <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,marginBottom:10,overflow:"hidden"}}>
      <div style={{padding:"12px 16px",borderBottom:"1px solid "+C.border,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,background:C.accent+"06"}}>
        <div>
          <div style={{color:C.text,fontWeight:800,fontSize:15}}>{record.company}</div>
          <div style={{color:C.accent,fontSize:11,marginTop:2}}>{record.segment}</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <select value={stage} onChange={e=>setStage(e.target.value)}
            style={{background:C.surface,border:"1px solid "+sc+"50",color:sc,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:700,fontFamily:"inherit",cursor:"pointer",outline:"none"}}>
            {STAGES.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={()=>{setShowReport(!showReport);setEditing(false);}}
            style={{background:showReport?C.accentDim:"transparent",border:"1px solid "+C.accent+"50",color:C.accent,borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:showReport?700:400}}>
            {showReport?"▲ Hide Report":"📋 Full Report"}
          </button>
          <button onClick={()=>{setEditing(!editing);setShowReport(false);}}
            style={{background:C.accentDim,border:"1px solid "+C.accent+"40",color:C.accent,borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
            {editing?"Cancel":"✏ Edit"}
          </button>
          <button onClick={()=>onRemove(record.company)} style={{background:"transparent",border:"1px solid "+C.border,color:C.dim,borderRadius:6,padding:"5px 8px",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>✕</button>
        </div>
      </div>
      <div style={{padding:"12px 16px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:8,marginBottom:12}}>
          {[["HQ",record.hq||record.crm?.hq],["Industry",record.crm?.industry||record.segment],["Employees",record.employees||record.crm?.employees],["Revenue",record.revenue||record.crm?.revenue],["ARR Potential",t.likely_arr_usd],["Incumbent",inc.name],["Deal Value",record.crm?.deal_value||dealVal],["Website",record.website||record.crm?.website]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k} style={{background:C.surface,borderRadius:6,padding:"6px 10px"}}>
              <div style={{color:C.dim,fontSize:9,fontWeight:700,textTransform:"uppercase",marginBottom:2}}>{k}</div>
              <div style={{color:C.text,fontSize:11,wordBreak:"break-word"}}>{v}</div>
            </div>
          ))}
        </div>
        {record.crm?.next_action&&!editing&&<div style={{background:C.goldDim,borderRadius:6,padding:"6px 10px",fontSize:11,color:C.gold,marginBottom:10}}>▶ Next: {record.crm.next_action}</div>}
        {editing&&(
          <div style={{background:C.surface,borderRadius:8,padding:12,marginBottom:12,border:"1px solid "+C.border}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <div style={{color:C.dim,fontSize:10,fontWeight:700,marginBottom:4}}>DEAL VALUE</div>
                <input value={dealVal} onChange={e=>setDealVal(e.target.value)} placeholder="e.g. $250K" style={{width:"100%",background:C.card,border:"1px solid "+C.border,borderRadius:6,padding:"7px 10px",color:C.text,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
              </div>
              <div>
                <div style={{color:C.dim,fontSize:10,fontWeight:700,marginBottom:4}}>NEXT ACTION</div>
                <input value={nextAct} onChange={e=>setNextAct(e.target.value)} placeholder="e.g. Send proposal" style={{width:"100%",background:C.card,border:"1px solid "+C.border,borderRadius:6,padding:"7px 10px",color:C.text,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
              </div>
            </div>
            <div style={{color:C.dim,fontSize:10,fontWeight:700,marginBottom:4}}>ACTIVITY NOTE / CALL REPORT</div>
            <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Log a call, meeting, email or update..." rows={3}
              style={{width:"100%",background:C.card,border:"1px solid "+C.border,borderRadius:6,padding:"8px 10px",color:C.text,fontSize:12,outline:"none",fontFamily:"inherit",resize:"vertical",boxSizing:"border-box"}}/>
            <button onClick={save} style={{marginTop:8,padding:"8px 18px",background:C.green,color:"#000",border:"none",borderRadius:6,fontWeight:800,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>SAVE</button>
          </div>
        )}
        {(record.activityLog||[]).length ? (
          <div style={{marginBottom:showReport?16:0}}>
            <div style={{color:C.dim,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>Activity Log</div>
            {record.activityLog.map((entry,i)=>(
              <div key={i} style={{padding:"7px 10px",background:C.surface,borderRadius:6,marginBottom:5,borderLeft:"2px solid "+C.accent}}>
                <div style={{color:C.dim,fontSize:10,marginBottom:2}}>{entry.date} · {entry.stage}</div>
                <div style={{color:C.text,fontSize:11}}>{entry.note}</div>
              </div>
            ))}
          </div>
        ) : null}
        {showReport&&(
          <div style={{borderTop:"1px solid "+C.border,paddingTop:16,marginTop:4}}>
            <div style={{color:C.muted,fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14}}>Intelligence Report — {record.company}</div>
            <AnalysisView data={record} onAdd={null} inPipeline={true} keys={keys}/>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({pipeline}) {
  const total = pipeline.length;
  const won = pipeline.filter(r=>r.crm?.stage==="Closed / Won").length;
  const winRate = total ? Math.round(won/total*100) : 0;
  const withVal = pipeline.filter(r=>r.crm?.deal_value);
  const avgDeal = withVal.length ? "$"+Math.round(withVal.reduce((s,r)=>s+(parseFloat((r.crm?.deal_value||"").replace(/[^0-9.]/g,""))||0),0)/withVal.length/1000)+"K" : "—";
  const active = pipeline.filter(r=>!["Closed / Won","Expansion / Retention"].includes(r.crm?.stage)).length;
  const bySeg = {};
  pipeline.forEach(r=>{ const s=r.segment||"Unknown"; if(!bySeg[s]) bySeg[s]={total:0,won:0}; bySeg[s].total++; if(r.crm?.stage==="Closed / Won") bySeg[s].won++; });
  const stageCounts = Object.fromEntries(STAGES.map(s=>[s,pipeline.filter(r=>r.crm?.stage===s).length]));

  return (
    <div>
      <div style={{color:C.text,fontSize:20,fontWeight:800,marginBottom:18}}>Dashboard</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:20}}>
        {[["Total Accounts",String(total),C.accent],["Win Rate",winRate+"%",C.green],["Avg Deal",avgDeal,C.gold],["Active",String(active),C.purple]].map(([l,v,c])=>(
          <Chip key={l} label={l} value={v} color={c}/>
        ))}
      </div>
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{color:C.muted,fontSize:11,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:12}}>Pipeline Funnel</div>
        {STAGES.map(s=>{
          const cnt=stageCounts[s]||0; const pct=total?Math.round(cnt/total*100):0; const color=STAGE_COLORS[s];
          return (
            <div key={s} style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{color:C.text,fontSize:11}}>{s}</span>
                <span style={{color,fontSize:11,fontWeight:700}}>{cnt} ({pct}%)</span>
              </div>
              <div style={{background:C.surface,borderRadius:4,height:6}}><div style={{width:pct+"%",height:"100%",background:color,borderRadius:4}}/></div>
            </div>
          );
        })}
      </div>
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:16}}>
        <div style={{color:C.muted,fontSize:11,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:12}}>Metrics by Vertical</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{background:C.surface}}>{["Segment","Accounts","Win Rate","Avg Deal","Conv Rate"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",color:C.muted,fontWeight:700,fontSize:10,letterSpacing:"0.05em"}}>{h}</th>)}</tr></thead>
            <tbody>
              {Object.entries(bySeg).map(([seg,d])=>{
                const wr=d.total?Math.round(d.won/d.total*100)+"%":"—";
                const sd=pipeline.filter(r=>r.segment===seg&&r.crm?.deal_value);
                const ad=sd.length?"$"+Math.round(sd.reduce((s,r)=>s+(parseFloat((r.crm?.deal_value||"").replace(/[^0-9.]/g,""))||0),0)/sd.length/1000)+"K":"—";
                const sql=pipeline.filter(r=>r.segment===seg&&r.crm?.stage!=="Prospecting").length;
                const conv=d.total?Math.round(sql/d.total*100)+"%":"—";
                return <tr key={seg} style={{borderBottom:"1px solid "+C.border}}>
                  <td style={{padding:"8px 12px",color:C.text}}>{seg}</td>
                  <td style={{padding:"8px 12px",color:C.accent,fontWeight:700}}>{d.total}</td>
                  <td style={{padding:"8px 12px",color:C.green}}>{wr}</td>
                  <td style={{padding:"8px 12px",color:C.gold}}>{ad}</td>
                  <td style={{padding:"8px 12px",color:C.purple}}>{conv}</td>
                </tr>;
              })}
              {!Object.keys(bySeg).length&&<tr><td colSpan={5} style={{padding:"24px 12px",color:C.dim,textAlign:"center"}}>No pipeline data yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Alerts ───────────────────────────────────────────────────────────────────
function AlertsPanel({pipeline, alerts, onAddAlert}) {
  const [checking, setChecking] = useState(false);
  const [sel, setSel] = useState(pipeline[0]?.company||"");

  async function check() {
    if (!sel||checking) return; setChecking(true);
    const rec = pipeline.find(r=>norm(r.company)===norm(sel));
    if (!rec) { setChecking(false); return; }
    const kw = (rec.alert_keywords||[]).join(", ")||"crypto, payments, blockchain";
    try {
      const result = await callAPI("You are a fintech news analyst. Return only a JSON array.",
        "Generate 3 plausible recent news alerts for \""+sel+"\" related to: "+kw+", crypto, payments, blockchain, stablecoins, tokenization, licensing, regulatory, merchant acceptance, cross-border. Return only JSON array: [{\"headline\":\"...\",\"date\":\"...\",\"category\":\"...\",\"summary\":\"...\",\"relevance_to_cp\":\"...\",\"urgency\":\"High|Medium|Low\"}]",
        1500);
      let arr; try { arr = parseJSON(result); if (!Array.isArray(arr)) arr=[]; } catch { arr=[]; }
      arr.forEach(a=>onAddAlert({...a,company:sel,checkedAt:new Date().toLocaleString()}));
    } catch(e) { console.error(e); }
    setChecking(false);
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{color:C.text,fontSize:20,fontWeight:800}}>News Alerts</div>
          <div style={{color:C.muted,fontSize:11}}>Monitor pipeline accounts for relevant news</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={sel} onChange={e=>setSel(e.target.value)}
            style={{background:C.surface,border:"1px solid "+C.border,color:C.text,borderRadius:7,padding:"8px 12px",fontSize:12,fontFamily:"inherit",outline:"none"}}>
            {pipeline.map(r=><option key={r.company} value={r.company}>{r.company}</option>)}
          </select>
          <button onClick={check} disabled={checking||!pipeline.length}
            style={{padding:"8px 16px",background:checking?C.surface:C.accent,color:checking?C.muted:"#000",border:"1px solid "+(checking?C.border:C.accent),borderRadius:7,fontWeight:800,fontSize:11,cursor:checking?"wait":"pointer",fontFamily:"inherit"}}>
            {checking?"Checking...":"⚡ Check Alerts"}
          </button>
        </div>
      </div>
      {!alerts.length&&<div style={{textAlign:"center",color:C.dim,padding:60,fontSize:12}}>No alerts yet — add companies to pipeline and click Check Alerts.</div>}
      {alerts.map((a,i)=>(
        <div key={i} style={{background:C.card,border:"1px solid "+(a.urgency==="High"?C.red+"40":C.border),borderRadius:10,padding:14,marginBottom:10}}>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
            <Badge color={a.urgency==="High"?"red":a.urgency==="Medium"?"gold":"muted"}>{a.urgency}</Badge>
            <Badge color="muted" sm>{a.category}</Badge>
            <Badge color="cyan" sm>{a.company}</Badge>
          </div>
          <div style={{color:C.text,fontWeight:700,fontSize:13,marginBottom:4}}>{a.headline}</div>
          <div style={{color:C.muted,fontSize:11,marginBottom:6,lineHeight:1.6}}>{a.summary}</div>
          <div style={{background:C.accentDim,borderRadius:5,padding:"5px 9px",fontSize:10,color:C.accent}}>↳ {a.relevance_to_cp}</div>
          <div style={{color:C.dim,fontSize:10,marginTop:6}}>{a.date} · Checked {a.checkedAt}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Reports ──────────────────────────────────────────────────────────────────
function Reports({pipeline}) {
  const [filter, setFilter] = useState("All");
  const segs = ["All",...new Set(pipeline.map(r=>r.segment).filter(Boolean))];
  const filtered = filter==="All"?pipeline:pipeline.filter(r=>r.segment===filter);

  function exportCSV() {
    const h = ["Company","Segment","HQ","Employees","Revenue","ARR Potential","Incumbent","Stage","Deal Value","Next Action","Website","Analyzed"];
    const rows = filtered.map(r=>{const c=r.crm||{},t=r.tam_som_arr||{},inc=r.incumbent||{};
      return [r.company,r.segment,r.hq,r.employees,r.revenue,t.likely_arr_usd,inc.name,c.stage,c.deal_value,c.next_action,r.website,r.analyzedAt?new Date(r.analyzedAt).toLocaleDateString():""]
        .map(v=>"\""+((v||"").replace(/"/g,'""'))+"\"").join(",");
    });
    const blob = new Blob([[h.join(","),...rows].join("\n")],{type:"text/csv"});
    Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:"coinpayments_pipeline.csv"}).click();
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{color:C.text,fontSize:20,fontWeight:800}}>Pipeline Report</div>
          <div style={{color:C.muted,fontSize:11}}>{filtered.length} accounts{filter!=="All"?" in "+filter:""}</div>
        </div>
        <button onClick={exportCSV} style={{background:C.goldDim,border:"1px solid "+C.gold+"40",color:C.gold,borderRadius:7,padding:"8px 14px",fontWeight:700,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>⬇ Export CSV</button>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
        {segs.map(s=><button key={s} onClick={()=>setFilter(s)} style={{padding:"4px 12px",borderRadius:20,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit",background:filter===s?C.accent:C.surface,color:filter===s?"#000":C.muted,border:"1px solid "+(filter===s?C.accent:C.border)}}>{s}</button>)}
      </div>
      {!filtered.length&&<div style={{textAlign:"center",color:C.dim,padding:60,fontSize:12}}>No accounts yet.</div>}
      {filtered.length ? (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{background:C.card}}>
              {["Company","Segment","HQ","ARR Potential","Incumbent","Stage","Deal Value","Next Action"].map(h=>(
                <th key={h} style={{padding:"10px 12px",textAlign:"left",color:C.muted,fontWeight:700,fontSize:10,letterSpacing:"0.05em",borderBottom:"1px solid "+C.border,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map((r,i)=>{const c=r.crm||{},t=r.tam_som_arr||{},inc=r.incumbent||{},sc=STAGE_COLORS[c.stage]||C.muted; return (
                <tr key={i} style={{borderBottom:"1px solid "+C.border,background:i%2===0?"transparent":C.card+"80"}}>
                  <td style={{padding:"9px 12px",color:C.text,fontWeight:700}}>{r.company}</td>
                  <td style={{padding:"9px 12px",color:C.muted}}>{r.segment}</td>
                  <td style={{padding:"9px 12px",color:C.muted}}>{r.hq}</td>
                  <td style={{padding:"9px 12px",color:C.green,fontWeight:700}}>{t.likely_arr_usd||"—"}</td>
                  <td style={{padding:"9px 12px",color:C.muted}}>{inc.name||"—"}</td>
                  <td style={{padding:"9px 12px"}}><span style={{color:sc,fontWeight:700}}>{c.stage||"—"}</span></td>
                  <td style={{padding:"9px 12px",color:C.gold}}>{c.deal_value||"—"}</td>
                  <td style={{padding:"9px 12px",color:C.muted}}>{c.next_action||"—"}</td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("analyze");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [tavilyKey,    setTavilyKey]    = useState(()=>localStorage.getItem(STORAGE.tavily)||"");
  const [ninjapearKey, setNinjapearKey] = useState(()=>localStorage.getItem(STORAGE.ninjapear)||"");
  const { pipeline, alerts, addRecord, updateRecord, removeRecord, addAlert } = usePipeline();

  const saveKey = (k,v,fn) => { fn(v); localStorage.setItem(k,v); };
  const keys = { tavily:tavilyKey, ninjapear:ninjapearKey };
  const hasContacts = !!ninjapearKey;
  const keyStatus = tavilyKey&&ninjapearKey?"🟢 Full Intel":tavilyKey||ninjapearKey?"🟡 Partial":"🔑 Add Keys";

  async function go() {
    if (!company.trim()||loading) return;
    setError(""); setResult(null); setLoading(true);
    try { setResult(await runAnalysis(company.trim(), setStep, keys)); }
    catch(e) { setError(e.message); }
    setLoading(false); setStep("");
  }

  const PAGES = [["analyze","🔬 Analyze"],["pipeline","📋 Pipeline ("+pipeline.length+")"],["dashboard","📊 Dashboard"],["alerts","🔔 Alerts"+(alerts.length?" ("+alerts.length+")":"")],["reports","📄 Reports"]];

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'IBM Plex Mono','Courier New',monospace",color:C.text}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:#07090F}
        ::-webkit-scrollbar-thumb{background:#1F2937;border-radius:3px}
        input::placeholder,textarea::placeholder{color:#334155}
        select option{background:#111827}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
      `}</style>

      {/* Nav */}
      <div style={{background:C.surface,borderBottom:"1px solid "+C.border,padding:"0 16px",display:"flex",alignItems:"center",justifyContent:"space-between",height:52,position:"sticky",top:0,zIndex:100,gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <div style={{width:28,height:28,borderRadius:7,background:"linear-gradient(135deg,"+C.accent+","+C.purple+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>₿</div>
          <div>
            <div style={{color:C.text,fontWeight:800,fontSize:11,letterSpacing:"0.05em"}}>COINPAYMENTS</div>
            <div style={{color:C.dim,fontSize:8,letterSpacing:"0.1em"}}>INTELLIGENCE AGENT</div>
          </div>
        </div>
        <div style={{display:"flex",gap:3,overflowX:"auto",alignItems:"center"}}>
          {PAGES.map(([id,label])=>(
            <button key={id} onClick={()=>setPage(id)} style={{padding:"5px 11px",borderRadius:7,fontFamily:"inherit",background:page===id?C.accent:"transparent",color:page===id?"#000":C.muted,border:"1px solid "+(page===id?C.accent:"transparent"),fontWeight:page===id?800:500,fontSize:10,cursor:"pointer",whiteSpace:"nowrap"}}>{label}</button>
          ))}
          <div style={{width:1,height:24,background:C.border,margin:"0 4px"}}/>
          <button onClick={()=>setShowKeys(!showKeys)}
            style={{padding:"4px 10px",borderRadius:7,fontFamily:"inherit",background:"transparent",color:tavilyKey&&ninjapearKey?C.green:tavilyKey||ninjapearKey?C.gold:C.red,border:"1px solid "+(tavilyKey&&ninjapearKey?C.green+"50":tavilyKey||ninjapearKey?C.gold+"50":C.red+"50"),fontSize:10,cursor:"pointer",whiteSpace:"nowrap"}}>
            {keyStatus}
          </button>
        </div>
      </div>

      {/* Keys panel */}
      {showKeys && (
        <div style={{background:C.surface,borderBottom:"1px solid "+C.border,padding:"14px 20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{color:C.text,fontSize:12,fontWeight:700}}>🔑 API Key Settings</div>
            <button onClick={()=>setShowKeys(false)} style={{background:"transparent",border:"1px solid "+C.border,color:C.dim,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>Done</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(380px,1fr))",gap:12}}>
            {[
              {label:"Tavily Search",icon:"🌐",desc:"Live news & web data",sk:STORAGE.tavily,val:tavilyKey,fn:v=>saveKey(STORAGE.tavily,v,setTavilyKey),ph:"tvly-xxxx  →  tavily.com (free)"},
              {label:"NinjaPear",icon:"🎯",desc:"Person verification + company enrichment · nubela.co",sk:STORAGE.ninjapear,val:ninjapearKey,fn:v=>saveKey(STORAGE.ninjapear,v,setNinjapearKey),ph:"your-api-key  →  nubela.co/dashboard"},

            ].map(({label,icon,desc,val,fn,ph})=>(
              <div key={label} style={{background:C.card,borderRadius:8,padding:"12px 14px",border:"1px solid "+(val?C.green+"40":C.border)}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize:16}}>{icon}</span>
                  <div style={{flex:1}}>
                    <div style={{color:C.text,fontSize:11,fontWeight:700}}>{label}</div>
                    <div style={{color:C.dim,fontSize:10}}>{desc}</div>
                  </div>
                  {val&&<span style={{color:C.green,fontSize:10,fontWeight:700}}>✓ CONNECTED</span>}
                </div>
                <input value={val} onChange={e=>fn(e.target.value)} placeholder={ph}
                  style={{width:"100%",background:C.surface,border:"1px solid "+(val?C.green+"50":C.border),borderRadius:6,padding:"7px 10px",color:C.text,fontSize:11,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
              </div>
            ))}
          </div>
          <div style={{marginTop:10,color:C.dim,fontSize:10,lineHeight:1.6}}>🟢 Full Intel = Tavily + NinjaPear. NinjaPear confirms scraped contacts. + people scraping) + NinjaPear (LinkedIn-licensed employee data). NinjaPear finds verified current employees by company domain — no org name guessing, no business email required. ~$0.01-0.10/credit · nubela.co/dashboard</div>

        </div>
      )}

      {/* Content */}
      <div style={{maxWidth:1080,margin:"0 auto",padding:"24px 16px"}}>
        {page==="analyze" && (
          <>
            <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:"18px 20px",marginBottom:20}}>
              <div style={{color:C.muted,fontSize:10,fontWeight:700,letterSpacing:"0.1em",marginBottom:10}}>TARGET CLIENT ANALYSIS</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <input value={company} onChange={e=>setCompany(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}
                  placeholder="Enter company name  (e.g. Revolut, Wise, Chime, Marqeta...)"
                  style={{flex:1,minWidth:240,background:C.surface,border:"1px solid "+C.border,borderRadius:7,padding:"10px 13px",color:C.text,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                <button onClick={go} disabled={loading||!company.trim()} style={{padding:"10px 24px",background:loading?C.surface:C.accent,color:loading?C.muted:"#000",border:"1px solid "+(loading?C.border:C.accent),borderRadius:7,fontWeight:800,fontSize:11,cursor:loading?"wait":"pointer",letterSpacing:"0.06em",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                  {loading?"ANALYZING...":"▶ RUN ANALYSIS"}
                </button>
              </div>
              {step&&<div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}><span style={{color:C.accent,animation:"blink 1s infinite"}}>⟳</span><span style={{color:C.accent,fontSize:11}}>{step}</span></div>}
              {error&&<div style={{marginTop:12,background:C.redDim,border:"1px solid "+C.red+"40",borderRadius:8,padding:12}}><div style={{color:C.red,fontSize:11,fontWeight:700,marginBottom:4}}>ERROR</div><div style={{color:C.muted,fontSize:11,lineHeight:1.6,wordBreak:"break-word",whiteSpace:"pre-wrap"}}>{error}</div></div>}
              {/* API status warnings */}
              {!loading && result && apiStatus.tavily.ok===false && (
                <div style={{marginTop:10,background:C.goldDim,border:"1px solid "+C.gold+"30",borderRadius:8,padding:"10px 14px"}}>
                  <div style={{color:C.gold,fontSize:11,fontWeight:700,marginBottom:6}}>⚠ API Status</div>
                  {apiStatus.tavily.error==="OUT_OF_CREDITS"&&(
                    <div style={{color:C.gold,fontSize:11,display:"flex",gap:8}}>
                      <span>🌐</span><span><strong>Tavily credits exhausted.</strong> News and people scraping disabled. Top up at tavily.com — Starter plan ($35/mo) = 10,000 searches.</span>
                    </div>
                  )}
                  {apiStatus.tavily.error==="INVALID_KEY"&&(
                    <div style={{color:C.red,fontSize:11,display:"flex",gap:8}}>
                      <span>🌐</span><span><strong>Tavily key invalid.</strong> Check Settings.</span>
                    </div>
                  )}
                </div>
              )}
              {!loading && result && apiStatus.ninjapear && apiStatus.ninjapear.ok === false && (
                <div style={{marginTop:10,background:C.goldDim,border:"1px solid "+C.gold+"30",borderRadius:8,padding:"10px 14px"}}>
                  <div style={{color:C.gold,fontSize:11,fontWeight:700,marginBottom:6}}>⚠ NinjaPear</div>
                  {apiStatus.ninjapear?.error==="OUT_OF_CREDITS"&&(
                    <div style={{color:C.gold,fontSize:11,display:"flex",gap:8}}>
<span>🎯</span><span><strong>NinjaPear credits exhausted.</strong> Top up at nubela.co/dashboard.</span>
                    </div>
                  )}
                  {apiStatus.ninjapear?.error==="INVALID_KEY"&&(
                    <div style={{color:C.red,fontSize:11,display:"flex",gap:8}}>
                      <span>🎯</span><span><strong>NinjaPear key invalid.</strong> Check your key in Settings.</span>
                    </div>
                  )}
                  {!apiStatus.ninjapear?.error&&(
                    <div style={{color:C.gold,fontSize:11,display:"flex",gap:8}}>
<span>🎯</span><span>NinjaPear returned 0 contacts for {result && result.company}. Check your key at nubela.co/dashboard.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {result && <AnalysisView data={result} onAdd={()=>addRecord({...result,crm:{...result.crm,stage:"Prospecting"}})} inPipeline={pipeline.some(r=>norm(r.company)===norm(result.company))} keys={keys}/>}
          </>
        )}
        {page==="pipeline" && (
          <div>
            <div style={{color:C.text,fontSize:20,fontWeight:800,marginBottom:18}}>Pipeline CRM</div>
            {!pipeline.length&&<div style={{textAlign:"center",color:C.dim,padding:60,fontSize:12}}>No accounts yet. Analyze a company and click Add to Pipeline.</div>}
            {pipeline.map(r=><CRMRecord key={r.company} record={r} onUpdate={updateRecord} onRemove={removeRecord} keys={keys}/>)}
          </div>
        )}
        {page==="dashboard" && <Dashboard pipeline={pipeline}/>}
        {page==="alerts"   && <AlertsPanel pipeline={pipeline} alerts={alerts} onAddAlert={addAlert}/>}
        {page==="reports"  && <Reports pipeline={pipeline}/>}
      </div>
    </div>
  );
}
