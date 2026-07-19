const ranges = {
  7: {
    metrics: [3412, 5128, 39.8, 386],
    sessions: [540, 680, 610, 790, 720, 880, 900],
    newVisitors: [320, 410, 360, 500, 430, 540, 570],
    returning: [220, 270, 250, 290, 290, 340, 330],
  },
  30: {
    metrics: [12489, 18932, 42.3, 1249],
    sessions: [480, 650, 560, 370, 520, 610, 470, 610, 720, 630, 700, 550, 790, 780, 490, 480, 610, 760, 680, 780, 690, 790, 620, 720, 810, 680, 890, 820, 760, 930],
    newVisitors: [360, 300, 280, 340, 370, 290, 320, 340, 360, 260, 220, 330, 280, 300, 350, 280, 260, 310, 250, 210, 180, 230, 420, 390, 350, 280, 310, 370, 390, 410],
    returning: [580, 500, 480, 470, 590, 510, 560, 590, 620, 500, 460, 650, 580, 520, 620, 590, 570, 600, 620, 590, 540, 580, 700, 610, 510, 490, 630, 600, 690, 620],
  },
  90: {
    metrics: [34872, 52140, 44.1, 3294],
    sessions: Array.from({ length: 45 }, (_, index) => 640 + Math.round(Math.sin(index / 3) * 160) + index * 10),
    newVisitors: Array.from({ length: 45 }, (_, index) => 330 + Math.round(Math.sin(index / 4) * 90) + index * 4),
    returning: Array.from({ length: 45 }, (_, index) => 520 + Math.round(Math.cos(index / 5) * 120) + index * 5),
  },
};

const pageRows = [
  { page: "/", views: 5124, unique: 3412, bounce: 38.6 },
  { page: "/products", views: 2987, unique: 2104, bounce: 41.2 },
  { page: "/pricing", views: 1876, unique: 1345, bounce: 33.8 },
  { page: "/about", views: 1203, unique: 987, bounce: 36.1 },
  { page: "/blog", views: 987, unique: 701, bounce: 48.2 },
];

let currentRange = 30;
let sort = { key: "views", direction: "desc" };

document.querySelector("#range-select").addEventListener("change", (event) => {
  currentRange = Number(event.target.value);
  renderDashboard();
});

document.querySelectorAll("[data-sort]").forEach((button) => {
  button.addEventListener("click", () => setSort(button.dataset.sort));
  button.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") { event.preventDefault(); sort = { key: button.dataset.sort, direction: "asc" }; renderTable(); }
    if (event.key === "ArrowDown") { event.preventDefault(); sort = { key: button.dataset.sort, direction: "desc" }; renderTable(); }
  });
});

function setSort(key) {
  sort = { key, direction: sort.key === key && sort.direction === "desc" ? "asc" : "desc" };
  renderTable();
}

function renderDashboard() {
  const data = ranges[currentRange];
  const [visitors, sessions, bounce, conversions] = data.metrics;
  document.querySelector("#visitors").textContent = visitors.toLocaleString();
  document.querySelector("#sessions").textContent = sessions.toLocaleString();
  document.querySelector("#bounce").textContent = `${bounce}%`;
  document.querySelector("#conversions").textContent = conversions.toLocaleString();
  renderLineChart(document.querySelector("#line-chart"), data.sessions);
  renderBarChart(document.querySelector("#bar-chart"), data.newVisitors, data.returning);
}

function chartFrame(values, width = 660, height = 270) {
  const max = Math.ceil(Math.max(...values) / 250) * 250;
  const plot = { left: 58, top: 24, right: width - 16, bottom: height - 38 };
  const x = (index, count) => plot.left + (index / Math.max(1, count - 1)) * (plot.right - plot.left);
  const y = (value) => plot.bottom - (value / max) * (plot.bottom - plot.top);
  return { width, height, max, plot, x, y };
}

function renderLineChart(container, values) {
  const frame = chartFrame(values);
  const points = values.map((value, index) => `${frame.x(index, values.length)},${frame.y(value)}`).join(" ");
  const labels = tickLabels(values.length);
  container.innerHTML = `<svg viewBox="0 0 ${frame.width} ${frame.height}" aria-hidden="true">
    ${grid(frame)}
    <polyline class="line-path" points="${points}" />
    ${values.map((value, index) => `<circle class="line-point" cx="${frame.x(index, values.length)}" cy="${frame.y(value)}" r="4" tabindex="0" data-index="${index}" data-value="${value}" />`).join("")}
    ${labels.map(({ index, label }) => `<text class="axis-label" text-anchor="middle" x="${frame.x(index, values.length)}" y="${frame.height - 10}">${label}</text>`).join("")}
  </svg>`;
  container.querySelectorAll(".line-point").forEach((point) => bindTooltip(point, () => `<strong>${dateLabel(Number(point.dataset.index))}</strong>Sessions&nbsp;&nbsp; ${Number(point.dataset.value).toLocaleString()}`));
}

function renderBarChart(container, newVisitors, returning) {
  const totals = newVisitors.map((value, index) => value + returning[index]);
  const frame = chartFrame(totals, 760, 270);
  const width = Math.max(5, (frame.plot.right - frame.plot.left) / totals.length - 4);
  const labels = tickLabels(totals.length);
  container.innerHTML = `<svg viewBox="0 0 ${frame.width} ${frame.height}" aria-hidden="true">
    ${grid(frame)}
    ${totals.map((total, index) => {
      const x = frame.x(index, totals.length) - width / 2;
      const returningHeight = frame.plot.bottom - frame.y(returning[index]);
      const newHeight = frame.plot.bottom - frame.y(newVisitors[index]);
      return `<rect class="bar-return" x="${x}" y="${frame.plot.bottom - returningHeight - newHeight}" width="${width}" height="${returningHeight}" /><rect class="bar-new" x="${x}" y="${frame.plot.bottom - newHeight}" width="${width}" height="${newHeight}" /><rect class="chart-hit" x="${x - 2}" y="${frame.plot.top}" width="${width + 4}" height="${frame.plot.bottom - frame.plot.top}" tabindex="0" data-index="${index}" data-new="${newVisitors[index]}" data-returning="${returning[index]}" />`;
    }).join("")}
    ${labels.map(({ index, label }) => `<text class="axis-label" text-anchor="middle" x="${frame.x(index, totals.length)}" y="${frame.height - 10}">${label}</text>`).join("")}
  </svg>`;
  container.querySelectorAll(".chart-hit").forEach((bar) => bindTooltip(bar, () => `<strong>${dateLabel(Number(bar.dataset.index))}</strong>New visitors&nbsp;&nbsp; ${bar.dataset.new}<br>Returning visitors&nbsp;&nbsp; ${bar.dataset.returning}`));
}

function grid(frame) {
  return Array.from({ length: 5 }, (_, index) => {
    const value = Math.round((frame.max / 4) * (4 - index));
    const y = frame.plot.top + ((frame.plot.bottom - frame.plot.top) / 4) * index;
    return `<line class="grid-line" x1="${frame.plot.left}" x2="${frame.plot.right}" y1="${y}" y2="${y}" /><text class="axis-label" text-anchor="end" x="${frame.plot.left - 12}" y="${y + 4}">${value.toLocaleString()}</text>`;
  }).join("");
}

function tickLabels(count) {
  const last = count - 1;
  return [0, Math.round(last / 3), Math.round((last * 2) / 3), last].map((index) => ({ index, label: index === 0 ? "May 1" : index === last ? `May ${Math.min(31, index + 1)}` : `May ${Math.min(31, index + 1)}` }));
}

function dateLabel(index) { return `May ${Math.min(31, index + 1)}, 2025`; }

function bindTooltip(element, content) {
  const tooltip = document.querySelector("#chart-tooltip");
  const show = () => {
    const box = element.getBoundingClientRect();
    tooltip.innerHTML = content();
    tooltip.style.left = `${Math.min(window.innerWidth - 190, Math.max(8, box.left - 70))}px`;
    tooltip.style.top = `${Math.max(8, box.top - 82)}px`;
    tooltip.classList.add("visible");
  };
  const hide = () => tooltip.classList.remove("visible");
  element.addEventListener("mouseenter", show);
  element.addEventListener("focus", show);
  element.addEventListener("mouseleave", hide);
  element.addEventListener("blur", hide);
}

function renderTable() {
  const direction = sort.direction === "asc" ? 1 : -1;
  const rows = [...pageRows].sort((left, right) => {
    if (typeof left[sort.key] === "string") return left[sort.key].localeCompare(right[sort.key]) * direction;
    return (left[sort.key] - right[sort.key]) * direction;
  });
  document.querySelector("#pages-body").innerHTML = rows.map((row) => `<tr><td>${row.page}</td><td>${row.views.toLocaleString()}</td><td>${row.unique.toLocaleString()}</td><td>${row.bounce}%</td></tr>`).join("");
  document.querySelectorAll("[data-sort]").forEach((button) => {
    if (button.dataset.sort === sort.key) {
      button.setAttribute("aria-sort", sort.direction === "asc" ? "ascending" : "descending");
      button.querySelector("span").textContent = sort.direction === "asc" ? "↑" : "↓";
    } else {
      button.removeAttribute("aria-sort");
      button.querySelector("span").textContent = "↕";
    }
  });
}

renderDashboard();
renderTable();
