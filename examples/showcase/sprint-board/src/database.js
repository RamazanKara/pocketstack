import { seedIssues } from "./data";

const DATABASE_URL = import.meta.env.VITE_POCKETSTACK_DB_DB_URL || "";
const STORAGE_KEY = "pocketstack-sprint-board-v1";

function quoteSQL(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function query(sql) {
  const response = await fetch(`${DATABASE_URL}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  if (!response.ok) throw new Error(`Browser database returned ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.result) ? payload.result : [];
}

function localIssues() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return seedIssues;
}

function saveLocal(issues) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(issues));
  return issues;
}

export async function loadIssues() {
  if (!DATABASE_URL) return localIssues();
  return query("select id, issue_key, title, category, status, assignee, position from issues order by status, position, id");
}

export async function createIssue(title, currentIssues) {
  const nextNumber = Math.max(112, ...currentIssues.map((issue) => Number(issue.issue_key.split("-")[1]) || 0)) + 1;
  const issue = {
    id: Math.max(0, ...currentIssues.map((item) => Number(item.id) || 0)) + 1,
    issue_key: `WEB-${nextNumber}`,
    title,
    category: "Enhancement",
    status: "backlog",
    assignee: "taylor",
    position: currentIssues.filter((item) => item.status === "backlog").length + 1,
  };
  if (!DATABASE_URL) {
    saveLocal([...currentIssues, issue]);
    return issue;
  }
  const rows = await query(`insert into issues (issue_key, title, category, status, assignee, position) values (${quoteSQL(issue.issue_key)}, ${quoteSQL(issue.title)}, ${quoteSQL(issue.category)}, 'backlog', 'taylor', ${issue.position}) returning id, issue_key, title, category, status, assignee, position`);
  return rows[0] || issue;
}

export async function moveIssue(issue, status, currentIssues) {
  const next = currentIssues.map((item) => item.id === issue.id
    ? { ...item, status, position: currentIssues.filter((candidate) => candidate.status === status).length + 1 }
    : item);
  if (!DATABASE_URL) return saveLocal(next);
  await query(`update issues set status=${quoteSQL(status)}, position=${next.find((item) => item.id === issue.id).position} where id=${Number(issue.id)}`);
  return next;
}
