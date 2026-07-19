import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const WRANGLER_VERSION = "4.112.0";
const MAX_SERVICES = 100;
const MAX_ITEMS = 10;
const MAX_TEXT = 600;
const MAX_COMMENT = 60_000;
const VALID_STATUSES = new Set(["ready", "partial", "blocked"]);

class DeploymentError extends Error {}

async function main(environment = process.env) {
  const context = await actionContext(environment);
  let analysis;

  try {
    if (context.closed) {
      const reportDir = await createReportDirectory(context, renderClosedHTML(context));
      const deployed = await deployOrExplain(context, reportDir, { requireCredentials: !context.restricted });
      const outcome = {
        kind: "closed",
        status: "closed",
        score: 0,
        deploymentUrl: deployed.deploymentUrl,
        reportUrl: deployed.stableUrl,
        message: deployed.skippedReason,
        exitCode: deployed.skippedReason && !context.restricted ? 1 : 0,
      };
      await finalize(context, outcome);
      return outcome.exitCode;
    }

    analysis = await analyzeProject(context);
    await validateAnalysisAssets(analysis, context.workspace);

    if (analysis.readiness.status === "ready") {
      const demoDir = resolve(context.tempRoot, "demo");
      await rm(demoDir, { recursive: true, force: true });
      runCLI(context, [
        "demo",
        "-f",
        context.composePath,
        "-o",
        demoDir,
        "--safe-root",
        context.workspace,
      ]);
      const deployed = await deployOrExplain(context, demoDir, { requireCredentials: !context.restricted });
      const outcome = {
        kind: "ready",
        status: "ready",
        score: analysis.readiness.score,
        analysis,
        previewUrl: deployed.skippedReason ? "" : deployed.stableUrl,
        deploymentUrl: deployed.deploymentUrl,
        message: deployed.skippedReason,
        exitCode: deployed.skippedReason && !context.restricted ? 1 : 0,
      };
      await finalize(context, outcome);
      return outcome.exitCode;
    }

    const reportDir = await createReportDirectory(context, renderCompatibilityHTML(context, analysis));
    const deployed = await deployOrExplain(context, reportDir, { requireCredentials: false });
    const outcome = {
      kind: analysis.readiness.status,
      status: analysis.readiness.status,
      score: analysis.readiness.score,
      analysis,
      deploymentUrl: deployed.deploymentUrl,
      reportUrl: deployed.stableUrl,
      message: deployed.skippedReason,
      exitCode: 1,
    };
    await finalize(context, outcome);
    return outcome.exitCode;
  } catch (error) {
    const safeMessage = safeErrorMessage(error);
    let deployed = { stableUrl: "", deploymentUrl: "", skippedReason: "" };
    if (!(error instanceof DeploymentError) && context.canDeploy) {
      try {
        const reportDir = await createReportDirectory(context, renderErrorHTML(context, safeMessage, analysis));
        deployed = await deployPreview(context, reportDir);
      } catch (deployError) {
        deployed.skippedReason = "The compatibility report could not be deployed. An older PR alias may still be visible.";
        console.error(safeErrorMessage(deployError));
      }
    } else if (!context.canDeploy) {
      deployed.skippedReason = context.restricted
        ? restrictedDeploymentMessage(context)
        : missingCredentialsMessage(context);
    } else {
      deployed.skippedReason = "Cloudflare deployment failed. An older PR alias may still be visible.";
    }
    const outcome = {
      kind: "error",
      status: analysis?.readiness?.status || "error",
      score: analysis?.readiness?.score || 0,
      analysis,
      deploymentUrl: deployed.deploymentUrl,
      reportUrl: deployed.stableUrl,
      message: [safeMessage, deployed.skippedReason].filter(Boolean).join(" "),
      exitCode: 1,
    };
    await finalize(context, outcome);
    return 1;
  }
}

async function actionContext(environment) {
  const eventName = environment.GITHUB_EVENT_NAME || "pull_request";
  if (eventName !== "pull_request") {
    throw new Error("PocketStack Preview must run from a pull_request workflow event.");
  }
  const eventPath = environment.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is not available.");
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const pullRequest = event.pull_request;
  if (!pullRequest?.number || !pullRequest?.head?.sha) {
    throw new Error("The pull_request event payload is incomplete.");
  }

  const workspace = resolve(environment.GITHUB_WORKSPACE || process.cwd());
  const composeInput = String(environment.INPUT_COMPOSE_FILE || "compose.yaml").trim();
  if (!composeInput || isAbsolute(composeInput)) {
    throw new Error("compose-file must be a non-empty path relative to the repository root.");
  }
  const composePath = resolve(workspace, composeInput);
  if (!isPathWithin(workspace, composePath)) {
    throw new Error("compose-file must stay inside the checked-out repository.");
  }

  const repository = environment.GITHUB_REPOSITORY || event.repository?.full_name || "";
  const actor = String(environment.GITHUB_ACTOR || event.sender?.login || "");
  const fromFork = Boolean(pullRequest.head.repo?.full_name && pullRequest.head.repo.full_name !== repository);
  const dependabot = actor.toLowerCase() === "dependabot[bot]";
  const restricted = fromFork || dependabot;
  const project = String(environment.INPUT_CLOUDFLARE_PROJECT || "").trim();
  const accountId = String(environment.INPUT_CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = String(environment.INPUT_CLOUDFLARE_API_TOKEN || "").trim();
  const canDeploy = !restricted && Boolean(project && accountId && apiToken);
  const prNumber = Number(pullRequest.number);
  const branch = `pr-${prNumber}`;
  const runnerTemp = resolve(environment.RUNNER_TEMP || workspace, "pocketstack-action");
  const composeKey = createHash("sha256").update(composeInput).digest("hex").slice(0, 12);

  return {
    environment,
    event,
    pullRequest,
    repository,
    actor,
    workspace,
    composeInput,
    composePath,
    prNumber,
    branch,
    headSha: String(pullRequest.head.sha),
    closed: event.action === "closed",
    restricted,
    fromFork,
    dependabot,
    project,
    accountId,
    apiToken,
    canDeploy,
    githubToken: String(environment.INPUT_GITHUB_TOKEN || "").trim(),
    apiURL: String(environment.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, ""),
    tempRoot: runnerTemp,
    outputPath: environment.GITHUB_OUTPUT || "",
    summaryPath: environment.GITHUB_STEP_SUMMARY || "",
    marker: `<!-- pocketstack-preview:${composeKey} -->`,
    cli: environment.POCKETSTACK_CLI || resolve(runnerTemp, "pocketstack"),
    npx: environment.POCKETSTACK_NPX || "npx",
  };
}

async function analyzeProject(context) {
  if (!existsSync(context.composePath)) {
    throw new Error(`Compose file not found: ${context.composeInput}`);
  }
  const result = runCLI(context, [
    "analyze",
    "-f",
    context.composePath,
    "--json",
    "--safe-root",
    context.workspace,
  ]);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("PocketStack returned malformed analysis JSON.");
  }
  return normalizeAnalysis(parsed);
}

function runCLI(context, args) {
  if (!existsSync(context.cli)) throw new Error("The trusted PocketStack CLI was not built.");
  const result = spawnSync(context.cli, args, {
    cwd: context.workspace,
    encoding: "utf8",
    env: context.environment,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(limitText(result.stderr || result.stdout || `PocketStack exited with ${result.status}.`, 2_000));
  }
  return result;
}

function normalizeAnalysis(value) {
  const readiness = value?.readiness || {};
  const status = String(readiness.status || "");
  if (!VALID_STATUSES.has(status)) throw new Error("Analysis JSON has an invalid readiness status.");
  const score = Number(readiness.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("Analysis JSON has an invalid readiness score.");
  }
  const services = Array.isArray(value.services) ? value.services.slice(0, MAX_SERVICES).map(normalizeService) : [];
  return {
    composeFile: limitText(value.composeFile, MAX_TEXT),
    projectRoot: limitText(value.projectRoot, MAX_TEXT),
    mode: limitText(value.mode, 80),
    browserNative: Boolean(value.browserNative),
    readiness: {
      status,
      score: Math.round(score),
      browserNativeServices: boundedNumber(readiness.browserNativeServices),
      totalServices: boundedNumber(readiness.totalServices),
      summary: limitText(readiness.summary, MAX_TEXT),
    },
    services,
    omittedServices: Math.max(0, (Array.isArray(value.services) ? value.services.length : 0) - services.length),
    warnings: normalizeItems(value.warnings),
    nextSteps: normalizeItems(value.nextSteps),
    hostRequirements: {
      crossOriginIsolationRequired: Boolean(value.hostRequirements?.crossOriginIsolationRequired),
      networkAccessRequired: Boolean(value.hostRequirements?.networkAccessRequired),
    },
  };
}

function normalizeService(service) {
  return {
    name: limitText(service?.name || "unnamed", 160),
    image: limitText(service?.image, 240),
    adapter: limitText(service?.adapter || "unsupported", 100),
    browserNative: Boolean(service?.browserNative),
    unsupported: normalizeItems(service?.unsupported),
    suggestions: normalizeItems(service?.suggestions),
    warnings: normalizeItems(service?.warnings),
    assets: Array.isArray(service?.assets)
      ? service.assets.slice(0, 100).map((asset) => ({ source: String(asset?.source || "") }))
      : [],
  };
}

function normalizeItems(values) {
  return Array.isArray(values) ? values.slice(0, MAX_ITEMS).map((value) => limitText(value, MAX_TEXT)) : [];
}

function boundedNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(Math.round(number), 100_000) : 0;
}

async function validateAnalysisAssets(analysis, workspace) {
  for (const service of analysis.services) {
    for (const asset of service.assets) {
      if (!asset.source) continue;
      await assertRealPathWithin(asset.source, workspace, `asset for service ${service.name}`);
    }
  }
  if (analysis.projectRoot) await assertRealPathWithin(analysis.projectRoot, workspace, "project root");
}

async function assertRealPathWithin(candidate, workspace, label) {
  const absolute = resolve(candidate);
  if (!isPathWithin(workspace, absolute)) throw new Error(`${label} resolves outside the checked-out repository.`);
  try {
    const [realWorkspace, realCandidate] = await Promise.all([realpath(workspace), realpath(absolute)]);
    if (!isPathWithin(realWorkspace, realCandidate)) {
      throw new Error(`${label} follows a symlink outside the checked-out repository.`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function isPathWithin(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function deployOrExplain(context, directory, { requireCredentials }) {
  if (context.restricted) {
    return { stableUrl: "", deploymentUrl: "", skippedReason: restrictedDeploymentMessage(context) };
  }
  if (!context.canDeploy) {
    const skippedReason = missingCredentialsMessage(context);
    if (requireCredentials) throw new Error(skippedReason);
    return { stableUrl: "", deploymentUrl: "", skippedReason };
  }
  return deployPreview(context, directory);
}

function restrictedDeploymentMessage(context) {
  return context.dependabot
    ? "Deployment and PR comments are skipped for Dependabot because repository deployment secrets are unavailable."
    : "Deployment and PR comments are skipped for forked PRs because repository deployment secrets and a writable token are unavailable.";
}

function missingCredentialsMessage(context) {
  const missing = [];
  if (!context.project) missing.push("cloudflare-project");
  if (!context.accountId) missing.push("cloudflare-account-id");
  if (!context.apiToken) missing.push("cloudflare-api-token");
  return `Preview deployment is not configured; missing ${missing.join(", ") || "Cloudflare credentials"}. An older PR alias may still be visible.`;
}

async function deployPreview(context, directory) {
  if (!/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$|^[a-z0-9]$/i.test(context.project)) {
    throw new Error("cloudflare-project must contain only letters, numbers, and hyphens and be at most 59 characters.");
  }
  const args = [
    "--yes",
    `wrangler@${WRANGLER_VERSION}`,
    "pages",
    "deploy",
    directory,
    "--project-name",
    context.project,
    "--branch",
    context.branch,
    "--commit-hash",
    context.headSha,
    "--commit-message",
    `PocketStack preview for PR #${context.prNumber}`,
  ];
  const result = spawnSync(context.npx, args, {
    cwd: context.workspace,
    encoding: "utf8",
    env: {
      ...context.environment,
      CLOUDFLARE_ACCOUNT_ID: context.accountId,
      CLOUDFLARE_API_TOKEN: context.apiToken,
      WRANGLER_SEND_METRICS: "false",
      CI: "true",
    },
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (output) console.log(output);
  if (result.error || result.status !== 0) {
    throw new DeploymentError("Cloudflare deployment failed. An older PR alias may still be visible.");
  }
  const stableUrl = `https://${context.branch}.${context.project}.pages.dev`;
  return {
    stableUrl,
    deploymentUrl: parseDeploymentURL(output, stableUrl),
    skippedReason: "",
  };
}

function parseDeploymentURL(output, stableUrl = "") {
  const urls = String(output || "").match(/https:\/\/[a-z0-9.-]+\.pages\.dev\/?/gi) || [];
  const normalizedStable = stableUrl.replace(/\/$/, "");
  return (urls.map((url) => url.replace(/\/$/, "")).find((url) => url !== normalizedStable) || urls[0] || "").replace(/\/$/, "");
}

async function createReportDirectory(context, html) {
  const directory = resolve(context.tempRoot, "report");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "index.html"), html);
  return directory;
}

async function finalize(context, outcome) {
  await writeOutputs(context, outcome);
  let markdown = renderMarkdown(context, outcome);
  await appendSummary(context, markdown);
  if (!context.restricted && context.githubToken) {
    try {
      await upsertComment(context, markdown);
    } catch (error) {
      const warning = `\n> PR comment unavailable: ${escapeMarkdown(safeErrorMessage(error))}\n`;
      console.warn(warning.trim());
      await appendSummary(context, warning);
    }
  } else if (!context.restricted && !context.githubToken) {
    await appendSummary(context, "\n> PR comment unavailable: github-token was not provided.\n");
  }
}

async function writeOutputs(context, outcome) {
  if (!context.outputPath) return;
  const values = {
    readiness_status: outcome.status || "error",
    readiness_score: String(outcome.score || 0),
    preview_url: outcome.kind === "ready" ? outcome.previewUrl || "" : "",
    deployment_url: outcome.deploymentUrl || "",
  };
  const body = Object.entries(values).map(([key, value]) => `${key}=${String(value).replace(/[\r\n]/g, "")}`).join("\n") + "\n";
  await appendFile(context.outputPath, body);
}

async function appendSummary(context, markdown) {
  if (!context.summaryPath) return;
  await appendFile(context.summaryPath, `${markdown.trim()}\n\n`);
}

async function upsertComment(context, markdown) {
  const body = limitComment(`${context.marker}\n${markdown.trim()}`);
  let existing;
  for (let page = 1; page <= 5 && !existing; page += 1) {
    const response = await githubRequest(context, `/repos/${context.repository}/issues/${context.prNumber}/comments?per_page=100&page=${page}`);
    const comments = await response.json();
    if (!Array.isArray(comments) || comments.length === 0) break;
    existing = comments.find((comment) => String(comment?.body || "").includes(context.marker));
    if (comments.length < 100) break;
  }
  if (existing?.id) {
    await githubRequest(context, `/repos/${context.repository}/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
  } else {
    await githubRequest(context, `/repos/${context.repository}/issues/${context.prNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }
}

async function githubRequest(context, path, init = {}) {
  const response = await fetch(`${context.apiURL}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${context.githubToken}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const permissionHint = response.status === 403
      ? "Check that the workflow grants pull-requests: write."
      : "";
    throw new Error(`GitHub comment request returned ${response.status}. ${permissionHint}`.trim());
  }
  return response;
}

function renderMarkdown(context, outcome) {
  const analysis = outcome.analysis;
  const lines = [];
  if (outcome.kind === "ready") {
    lines.push("## PocketStack preview", "", `✅ Browser readiness **${outcome.score}%**`);
    if (outcome.previewUrl) lines.push("", `[Open the static PR preview](${outcome.previewUrl})`);
    if (outcome.message) lines.push("", `> ${escapeMarkdown(outcome.message)}`);
    lines.push("", "Every active service maps to a browser adapter. The preview runs browser code and static assets—not container images.");
  } else if (outcome.kind === "closed") {
    lines.push("## PocketStack preview closed", "", "The stable PR alias now shows a closed-preview page.");
    if (outcome.reportUrl) lines.push("", `[Open the closed-preview page](${outcome.reportUrl})`);
    if (outcome.message) lines.push("", `> ${escapeMarkdown(outcome.message)}`);
    return lines.join("\n");
  } else if (outcome.kind === "error") {
    lines.push("## PocketStack preview failed", "", "❌ No app preview was published.");
    if (outcome.reportUrl) lines.push("", `[Open the static error report](${outcome.reportUrl})`);
    if (outcome.message) lines.push("", `> ${escapeMarkdown(outcome.message)}`);
  } else {
    const icon = outcome.kind === "partial" ? "⚠️" : "❌";
    lines.push(
      "## PocketStack compatibility",
      "",
      `${icon} No app preview published — browser readiness **${outcome.score}%**`,
      "",
      "PocketStack does not run arbitrary containers. Every active service must map to a browser adapter before an app preview can be published.",
    );
    if (outcome.reportUrl) lines.push("", `[Open the static compatibility report](${outcome.reportUrl})`);
    if (outcome.message) lines.push("", `> ${escapeMarkdown(outcome.message)}`);
  }

  if (analysis?.services?.length) {
    lines.push("", "| Service | Browser mapping | Result |", "| --- | --- | --- |");
    for (const service of analysis.services) {
      lines.push(`| ${escapeMarkdownCell(service.name)} | ${escapeMarkdownCell(service.browserNative ? service.adapter : service.image || "No adapter")} | ${service.browserNative ? "✅ Ready" : "❌ Unsupported"} |`);
    }
    if (analysis.omittedServices) lines.push(`| … | ${analysis.omittedServices} more services omitted | … |`);
  }
  const warnings = [
    ...(analysis?.warnings || []),
    ...(analysis?.services || []).flatMap((service) => service.warnings.map((warning) => `${service.name}: ${warning}`)),
  ];
  if (warnings.length) {
    lines.push("", "### Compatibility notes");
    for (const warning of warnings.slice(0, MAX_ITEMS)) lines.push(`- ⚠️ ${escapeMarkdown(warning)}`);
  }
  const blocked = analysis?.services?.filter((service) => !service.browserNative) || [];
  for (const service of blocked) {
    lines.push("", `### ${escapeMarkdown(service.name)}`);
    for (const reason of service.unsupported) lines.push(`- ${escapeMarkdown(reason)}`);
    for (const suggestion of service.suggestions) lines.push(`- **Try:** ${escapeMarkdown(suggestion)}`);
  }
  if (analysis?.hostRequirements?.crossOriginIsolationRequired) {
    lines.push("", "> This preview requires COOP/COEP headers. PocketStack emits them and Cloudflare Pages applies them.");
  }
  return lines.join("\n");
}

function renderCompatibilityHTML(context, analysis) {
  const status = analysis.readiness.status;
  const services = analysis.services.map((service) => {
    const details = service.browserNative
      ? `<p class="mapping">${escapeHTML(service.name)} <span>→</span> <strong>${escapeHTML(service.adapter)}</strong></p>
        ${service.warnings.map((item) => `<p class="warning"><b>Note:</b> ${escapeHTML(item)}</p>`).join("")}`
      : `<p class="mapping">${escapeHTML(service.name)} <span>·</span> <strong>${escapeHTML(service.image || "No browser adapter")}</strong></p>
        ${service.warnings.map((item) => `<p class="warning"><b>Note:</b> ${escapeHTML(item)}</p>`).join("")}
        ${service.unsupported.map((item) => `<p class="reason">${escapeHTML(item)}</p>`).join("")}
        ${service.suggestions.map((item) => `<p class="suggestion"><b>Try:</b> ${escapeHTML(item)}</p>`).join("")}`;
    return `<article class="service ${service.browserNative ? "ready" : "unsupported"}">
      <div class="service-status">${service.browserNative ? "✓ Ready" : "△ Unsupported"}</div>${details}
    </article>`;
  }).join("");
  return reportShell({
    title: "No app preview published",
    eyebrow: "Static compatibility report — not an app preview",
    tone: status === "partial" ? "warning" : "danger",
    body: `<p class="lede">Browser readiness <strong>${analysis.readiness.score}%</strong>. PocketStack never runs arbitrary containers. Every active service must map to a browser adapter before deployment.</p>
      <div class="score" aria-label="Browser readiness ${analysis.readiness.score} percent"><span style="width:${analysis.readiness.score}%"></span></div>
      <section class="services">${services}</section>
      ${analysis.warnings.length ? `<section class="project-warnings"><h2>Compatibility notes</h2>${analysis.warnings.map((item) => `<p class="warning">${escapeHTML(item)}</p>`).join("")}</section>` : ""}
      <p class="footnote">PR #${context.prNumber} · ${escapeHTML(context.composeInput)} · Generated as a static report.</p>`,
  });
}

function renderClosedHTML(context) {
  return reportShell({
    title: "Preview closed",
    eyebrow: "PocketStack PR preview",
    tone: "neutral",
    body: `<p class="lede">Pull request #${context.prNumber} is closed. This stable alias no longer serves the application preview.</p>
      <p class="footnote">The deployment is a static tombstone page. No container or PocketStack server is running.</p>`,
  });
}

function renderErrorHTML(context, message, analysis) {
  return reportShell({
    title: "Preview generation failed",
    eyebrow: "Static PocketStack error report",
    tone: "danger",
    body: `<p class="lede">No app preview was published. ${escapeHTML(message)}</p>
      ${analysis ? `<p class="footnote">Last known browser readiness: ${analysis.readiness.score}%.</p>` : ""}
      <p class="footnote">PR #${context.prNumber} · ${escapeHTML(context.composeInput)}</p>`,
  });
}

function reportShell({ title, eyebrow, tone, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHTML(title)} · PocketStack</title>
  <style>
    :root{color-scheme:light;--ink:#0b0f14;--muted:#46505e;--line:#cbd3de;--green:#00843f;--amber:#b86a00;--red:#b42318;--soft:#f6f8fa}
    *{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    main{width:min(900px,calc(100% - 36px));margin:0 auto;padding:72px 0 96px}.brand{font-weight:800;font-size:20px;margin-bottom:80px}.eyebrow{font:600 13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
    h1{font-size:clamp(44px,8vw,82px);line-height:.98;letter-spacing:-.055em;margin:18px 0 24px;max-width:780px}.lede{font-size:clamp(18px,2.5vw,24px);line-height:1.5;color:var(--muted);max-width:780px}.lede strong{color:${tone === "warning" ? "var(--amber)" : tone === "danger" ? "var(--red)" : "var(--ink)"}}
    .score{height:10px;background:#e8ecf1;margin:42px 0;border-radius:99px;overflow:hidden}.score span{display:block;height:100%;background:${tone === "warning" ? "var(--amber)" : "var(--red)"}}
    .services{border:1px solid var(--line);border-bottom:0;margin-top:42px}.service{position:relative;padding:22px 180px 22px 24px;border-bottom:1px solid var(--line)}.service-status{position:absolute;right:24px;top:22px;font:700 14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.ready .service-status,.ready strong{color:var(--green)}.unsupported .service-status,.unsupported strong{color:var(--amber)}
    .mapping{margin:0;font:500 17px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.mapping span{color:#8a94a2;margin:0 8px}.reason,.suggestion,.warning{margin:10px 0 0;color:var(--muted);line-height:1.55}.suggestion b,.warning b{color:var(--ink)}.project-warnings{margin-top:28px;padding:20px 24px;border:1px solid var(--line);background:#fffaf0}.project-warnings h2{margin:0 0 8px;font-size:18px}.project-warnings .warning{margin:6px 0}.footnote{margin:32px 0 0;color:var(--muted);font:500 14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
    @media(max-width:620px){main{padding-top:32px}.brand{margin-bottom:64px}.service{padding:20px}.service-status{position:static;margin-bottom:8px}.mapping{font-size:15px}}
  </style>
</head>
<body><main><div class="brand">PocketStack</div><p class="eyebrow">${escapeHTML(eyebrow)}</p><h1>${escapeHTML(title)}</h1>${body}</main></body>
</html>`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeMarkdown(value) {
  return escapeHTML(limitText(value, MAX_TEXT)).replace(/[\\`*_{}\[\]()#+.!|-]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

function escapeMarkdownCell(value) {
  return escapeMarkdown(value).replace(/\|/g, "&#124;");
}

function limitText(value, maximum = MAX_TEXT) {
  const text = String(value ?? "").replace(/\0/g, "");
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function limitComment(value) {
  const text = String(value || "");
  return text.length > MAX_COMMENT ? `${text.slice(0, MAX_COMMENT - 40)}\n\n_Report truncated._` : text;
}

function safeErrorMessage(error) {
  return limitText(error?.message || error || "Unknown PocketStack error.", 1_500).replace(/[\r\n]+/g, " ").trim();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const exitCode = await main();
  process.exitCode = exitCode;
}

export {
  WRANGLER_VERSION,
  actionContext,
  escapeHTML,
  escapeMarkdown,
  isPathWithin,
  main,
  normalizeAnalysis,
  parseDeploymentURL,
  renderCompatibilityHTML,
  renderMarkdown,
  reportShell,
};
