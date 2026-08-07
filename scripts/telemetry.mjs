#!/usr/bin/env node
// Gera assets/stats.svg a partir da API do GitHub.
// ponytail: existe porque github-readme-stats.vercel.app vive em 503;
// asset proprio = zero dependencia de uptime de terceiro.
// Uso: GITHUB_TOKEN=... node scripts/telemetry.mjs [login]

import { writeFileSync } from "node:fs";

const LOGIN = process.argv[2] || process.env.GITHUB_REPOSITORY_OWNER || "mikenew01";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN ausente");

const MAX_LANGS = 6;
const MAX_PAGES = 4; // 100 repos por pagina

// Distribuicao por linguagem PRIMARIA do repo, nao por bytes: notebooks e
// arquivos gerados inflam bytes e mostrariam "Jupyter Notebook 50%" no lugar
// de Java. Markup/config fica fora porque nao representa o que eu construo.
const SKIP_LANG = new Set([
  "HTML", "CSS", "SCSS", "Less", "Jupyter Notebook", "Dockerfile", "Batchfile",
  "Makefile", "Shell", "Mermaid", "TeX", "Roff", "Handlebars", "EJS", "Pug",
]);

const QUERY = `
query($login:String!,$cursor:String){
  user(login:$login){
    followers{totalCount}
    contributionsCollection{
      totalCommitContributions
      restrictedContributionsCount
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
    }
    repositories(first:100,after:$cursor,ownerAffiliations:OWNER,isFork:false,orderBy:{field:PUSHED_AT,direction:DESC}){
      totalCount
      pageInfo{hasNextPage endCursor}
      nodes{
        stargazerCount
        primaryLanguage{name color}
      }
    }
  }
}`;

async function gql(cursor) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN, cursor } }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data.user;
}

async function collect() {
  const tally = new Map(); // linguagem -> {repos, color}
  let stars = 0;
  let cursor = null;
  let head = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const user = await gql(cursor);
    head ??= user;
    for (const repo of user.repositories.nodes) {
      stars += repo.stargazerCount;
      const lang = repo.primaryLanguage;
      if (!lang || SKIP_LANG.has(lang.name)) continue;
      const cur = tally.get(lang.name) ?? { repos: 0, color: lang.color };
      cur.repos += 1;
      tally.set(lang.name, cur);
    }
    if (!user.repositories.pageInfo.hasNextPage) break;
    cursor = user.repositories.pageInfo.endCursor;
  }

  const c = head.contributionsCollection;
  const total = [...tally.values()].reduce((a, b) => a + b.repos, 0) || 1;
  const langs = [...tally.entries()]
    .sort((a, b) => b[1].repos - a[1].repos)
    .slice(0, MAX_LANGS)
    .map(([name, v]) => ({ name, pct: (v.repos / total) * 100, color: v.color || "#7C4DFF" }));

  // Metrica zerada e pior que metrica ausente: PR/review/issue publicos ficam
  // em zero para quem entrega em repo corporativo privado. So mostra o que tem sinal.
  const kpis = [
    { label: "COMMITS · 12M", value: c.totalCommitContributions + c.restrictedContributionsCount },
    { label: "OWN REPOS", value: head.repositories.totalCount },
    { label: "STARS EARNED", value: stars },
    { label: "FOLLOWERS", value: head.followers.totalCount },
    { label: "PULL REQUESTS", value: c.totalPullRequestContributions },
    { label: "CODE REVIEWS", value: c.totalPullRequestReviewContributions },
    { label: "ISSUES", value: c.totalIssueContributions },
  ].filter((k) => k.value > 0);

  return { kpis: kpis.slice(0, 6), langs, repos: head.repositories.totalCount };
}

const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(".0", "")}k` : String(n));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

function render({ kpis, langs, repos }) {
  // Grid adaptativo: 3 colunas quando ha 5+ KPIs, 2 colunas quando ha menos.
  const cols = kpis.length >= 5 ? 3 : 2;
  const tileW = cols === 3 ? 162 : 246;
  const stride = cols === 3 ? 178 : 268;
  const tile = (k, i) => {
    const x = 44 + (i % cols) * stride;
    const y = i < cols ? 66 : 172;
    const cx = x + tileW / 2;
    return `
    <g opacity="0">
      <animate attributeName="opacity" from="0" to="1" dur=".7s" begin="${(i * 0.11).toFixed(2)}s" fill="freeze"/>
      <rect x="${x}" y="${y}" width="${tileW}" height="84" rx="11" fill="#0C1626" stroke="#1F6FEB" stroke-opacity=".38"/>
      <rect x="${x}" y="${y}" width="${tileW}" height="2.5" rx="1.25" fill="#00E5FF" opacity=".55"/>
      <text x="${cx}" y="${y + 46}" text-anchor="middle" fill="#E6EDF3" font-family="${MONO}" font-size="27" font-weight="700">${compact(k.value)}</text>
      <text x="${cx}" y="${y + 67}" text-anchor="middle" fill="#5C7D9E" font-family="${MONO}" font-size="9" letter-spacing="1.6">${k.label}</text>
    </g>`;
  };

  const BAR_X = 762;
  const BAR_W = 330;
  const bar = (l, i) => {
    const y = 86 + i * 33;
    const w = Math.max(3, (l.pct / 100) * BAR_W);
    const begin = (0.35 + i * 0.13).toFixed(2);
    return `
    <g>
      <text x="620" y="${y + 7}" fill="#8FB6DE" font-family="${MONO}" font-size="11" letter-spacing=".6">${esc(l.name)}</text>
      <rect x="${BAR_X}" y="${y}" width="${BAR_W}" height="9" rx="4.5" fill="#101B2D" stroke="#1F6FEB" stroke-opacity=".22"/>
      <rect x="${BAR_X}" y="${y}" width="0" height="9" rx="4.5" fill="${l.color}">
        <animate attributeName="width" from="0" to="${w.toFixed(1)}" dur="1.3s" begin="${begin}s" fill="freeze" calcMode="spline" keySplines=".2 .8 .2 1" keyTimes="0;1"/>
      </rect>
      <circle cx="${BAR_X}" cy="${y + 4.5}" r="3.2" fill="#EAFBFF" opacity="0">
        <animate attributeName="cx" from="${BAR_X}" to="${(BAR_X + w).toFixed(1)}" dur="1.3s" begin="${begin}s" fill="freeze" calcMode="spline" keySplines=".2 .8 .2 1" keyTimes="0;1"/>
        <animate attributeName="opacity" values="0;1;1;0" dur="1.9s" begin="${begin}s" fill="freeze"/>
      </circle>
      <text x="1156" y="${y + 7}" text-anchor="end" fill="#5C7D9E" font-family="${MONO}" font-size="10.5">${l.pct.toFixed(1)}%</text>
    </g>`;
  };

  const stamp = new Date().toISOString().slice(0, 10);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" width="1200" height="300" role="img" aria-label="Telemetria do GitHub de ${esc(LOGIN)}">
  <title>Mission telemetry — ${esc(LOGIN)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#04060B"/><stop offset=".5" stop-color="#0A1120"/><stop offset="1" stop-color="#04060B"/>
    </linearGradient>
    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#00E5FF" stop-opacity="0"/>
      <stop offset=".5" stop-color="#00E5FF" stop-opacity=".8"/>
      <stop offset="1" stop-color="#00E5FF" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="frame"><rect width="1200" height="300" rx="14"/></clipPath>
  </defs>
  <g clip-path="url(#frame)">
    <rect width="1200" height="300" fill="url(#bg)"/>
    <g stroke="#2F81F7" stroke-opacity=".06">
      <path d="M0 50H1200M0 100H1200M0 150H1200M0 200H1200M0 250H1200"/>
      <path d="M100 0V300M300 0V300M500 0V300M700 0V300M900 0V300M1100 0V300"/>
    </g>
    <path d="M600 34V276" stroke="#1F6FEB" stroke-opacity=".28" stroke-dasharray="3 7"/>
    <g stroke="#00E5FF" stroke-opacity=".45" stroke-width="1.5" fill="none">
      <path d="M24 42V24H42"/><path d="M1176 42V24H1158"/><path d="M24 258V276H42"/><path d="M1176 258V276H1158"/>
    </g>
    <g font-family="${MONO}" font-size="10.5" letter-spacing="2.4">
      <circle cx="52" cy="35" r="3.2" fill="#3FB950"><animate attributeName="opacity" values="1;.15;1" dur="1.7s" repeatCount="indefinite"/></circle>
      <text x="64" y="39" fill="#7FD8F5">MISSION TELEMETRY</text>
      <text x="1148" y="39" text-anchor="end" fill="#4E7BB0">SYNC ${stamp} · ${repos} REPOS</text>
      <text x="620" y="62" fill="#7FD8F5">STACK · BY REPOSITORY</text>
    </g>
    ${kpis.map(tile).join("")}
    ${langs.map(bar).join("")}
    <text x="1156" y="292" text-anchor="end" fill="#33506E" font-family="${MONO}" font-size="8.5" letter-spacing="1.4">AUTO-GENERATED · GITHUB ACTIONS</text>
    <rect x="-300" y="0" width="300" height="300" fill="url(#sweep)" opacity=".1">
      <animate attributeName="x" from="-300" to="1200" dur="7s" repeatCount="indefinite"/>
    </rect>
  </g>
  <rect x=".75" y=".75" width="1198.5" height="298.5" rx="14" fill="none" stroke="#1F6FEB" stroke-opacity=".35"/>
</svg>
`;
}

const data = await collect();
writeFileSync("assets/stats.svg", render(data));
console.log(`stats.svg gerado · ${data.repos} repos · langs: ${data.langs.map((l) => l.name).join(", ")}`);
