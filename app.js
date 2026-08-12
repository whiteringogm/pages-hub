const OWNER = "whiteringogm";
const grid = document.querySelector("#projectGrid");
const template = document.querySelector("#projectTemplate");
const searchInput = document.querySelector("#searchInput");
const refreshButton = document.querySelector("#refreshButton");
const statusText = document.querySelector("#statusText");
const checkedAt = document.querySelector("#checkedAt");
const emptyState = document.querySelector("#emptyState");
const toast = document.querySelector("#toast");

let projects = [];
let cards = [];
let toastTimer;

function cleanVersion(value) {
  const match = String(value || "").match(/\bv\s*(\d+(?:\.\d+){0,3})\b/i);
  return match ? `v${match[1]}` : "";
}

function versionFromText(text) {
  if (!text) return "";
  const preferred = String(text).match(/(?:app[-_ ]?version|version|cache(?:_name)?)[^\n\r"'<>]{0,45}?[=:>\s"']+(v\d+(?:\.\d+){0,3})\b/i);
  return cleanVersion(preferred?.[1]) || cleanVersion(text);
}

function versionFromHtml(html) {
  if (!html) return "";
  const documentCopy = new DOMParser().parseFromString(html, "text/html");
  const meta = documentCopy.querySelector('meta[name="app-version"], meta[name="version"]')?.content;
  const marked = documentCopy.querySelector("[data-app-version]")?.dataset.appVersion;
  const visible = documentCopy.querySelector(".app-version, #appVersion, .version-badge, .version")?.textContent;
  return cleanVersion(meta) || cleanVersion(marked) || cleanVersion(visible) || versionFromText(html);
}

function shortDate(value) {
  if (!value) return "取得できず";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "取得できず";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function queryUrl(base, token) {
  const url = new URL(base);
  url.searchParams.set("v", token);
  return url.href;
}

async function fetchOptionalText(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return { ok: false, text: "", modified: "" };
    return {
      ok: true,
      text: await response.text(),
      modified: response.headers.get("last-modified") || ""
    };
  } catch {
    return { ok: false, text: "", modified: "" };
  }
}

async function fetchCommit(repo, branch = "main") {
  try {
    const response = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/commits/${branch}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    return {
      sha: data.sha || "",
      date: data.commit?.committer?.date || data.commit?.author?.date || ""
    };
  } catch {
    return { sha: "", date: "" };
  }
}

async function inspectProject(project) {
  const pageUrl = `https://${OWNER}.github.io/${project.repo}/`;
  const stamp = Date.now();
  const [versionFile, page, commit] = await Promise.all([
    fetchOptionalText(`${pageUrl}version.json?hub=${stamp}`),
    fetchOptionalText(`${pageUrl}?hub=${stamp}`),
    fetchCommit(project.repo, project.branch || "main")
  ]);

  let version = "";
  if (versionFile.ok) {
    try {
      version = cleanVersion(JSON.parse(versionFile.text)?.version);
    } catch {
      version = versionFromText(versionFile.text);
    }
  }
  if (!version && page.ok) version = versionFromHtml(page.text);

  if (!version) {
    const worker = await fetchOptionalText(`${pageUrl}sw.js?hub=${stamp}`);
    if (worker.ok) version = versionFromText(worker.text);
  }

  const shortSha = commit.sha.slice(0, 7);
  const fallbackToken = shortSha || new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date()).replace(/\D/g, "");

  return {
    ...project,
    pageUrl,
    repoUrl: `https://github.com/${OWNER}/${project.repo}`,
    pageOk: page.ok,
    version,
    commitSha: shortSha,
    updated: commit.date || page.modified,
    latestUrl: queryUrl(pageUrl, version ? version.slice(1) : fallbackToken)
  };
}

function makeCard(project) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.style.setProperty("--card-accent", project.color || "#9aaee7");
  node.dataset.search = `${project.title} ${project.repo} ${project.description}`.toLowerCase();

  node.querySelector(".project-icon").textContent = project.icon || "◇";
  node.querySelector("h2").textContent = project.title;
  node.querySelector(".repo-name").textContent = `${OWNER}/${project.repo}`;
  node.querySelector(".description").textContent = project.description || "";

  const pageLink = node.querySelector(".page-link");
  const latestLink = node.querySelector(".latest-link");
  const repoLink = node.querySelector(".repo-link");
  pageLink.href = project.pageUrl;
  latestLink.href = project.latestUrl;
  repoLink.href = project.repoUrl;

  const status = node.querySelector(".publish-status");
  status.textContent = project.pageOk ? "公開中" : "未確認";
  status.classList.add(project.pageOk ? "online" : "offline");

  const version = node.querySelector(".version-value");
  version.textContent = project.version || (project.commitSha ? `rev ${project.commitSha}` : "版数未設定");
  version.classList.remove("skeleton");
  version.title = project.version ? "公開ページから取得" : "版数がないため最新コミットを表示";

  const updated = node.querySelector(".updated-value");
  updated.textContent = shortDate(project.updated);
  updated.classList.remove("skeleton");

  node.querySelector(".commit-value").textContent = project.commitSha || "取得できず";

  node.querySelector(".copy-button").addEventListener("click", async () => {
    const copied = await copyText(project.latestUrl);
    showToast(copied ? "最新版URLをコピーした" : "URLをコピーできなかった");
  });

  return node;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function applyFilter() {
  const query = searchInput.value.trim().toLowerCase();
  let visible = 0;
  cards.forEach((card) => {
    const match = !query || card.dataset.search.includes(query);
    card.hidden = !match;
    if (match) visible += 1;
  });
  emptyState.hidden = visible !== 0;
}

async function loadProjects() {
  refreshButton.classList.add("loading");
  refreshButton.disabled = true;
  statusText.textContent = "最新情報を確認中…";
  grid.replaceChildren();
  cards = [];

  try {
    const response = await fetch(`projects.json?hub=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("projects");
    projects = await response.json();

    const settled = await Promise.allSettled(projects.map(inspectProject));
    const inspected = settled.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : {
            ...projects[index],
            pageUrl: `https://${OWNER}.github.io/${projects[index].repo}/`,
            repoUrl: `https://github.com/${OWNER}/${projects[index].repo}`,
            latestUrl: `https://${OWNER}.github.io/${projects[index].repo}/?v=${Date.now()}`,
            pageOk: false,
            version: "",
            commitSha: "",
            updated: ""
          }
    );

    cards = inspected.map(makeCard);
    grid.append(...cards);
    applyFilter();

    const onlineCount = inspected.filter((item) => item.pageOk).length;
    statusText.textContent = `${onlineCount} / ${inspected.length}件を公開確認`;
    checkedAt.textContent = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
    checkedAt.dateTime = new Date().toISOString();
  } catch {
    statusText.textContent = "一覧を読み込めなかった";
    emptyState.hidden = false;
    emptyState.querySelector("p").textContent = "projects.jsonを読み込めなかった。";
  } finally {
    refreshButton.classList.remove("loading");
    refreshButton.disabled = false;
  }
}

searchInput.addEventListener("input", applyFilter);
refreshButton.addEventListener("click", () => void loadProjects());
void loadProjects();
