import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { columns, people, seedIssues } from "./data";
import { createIssue, loadIssues, moveIssue } from "./database";
import { BoardIcon, ChartIcon, FilterIcon, GearIcon, ListIcon, PlusIcon, TagIcon } from "./icons";
import "./styles.css";

const categoryStyles = {
  Design: "purple",
  Enhancement: "green",
  Performance: "orange",
  Frontend: "blue",
  Analytics: "amber",
  DevOps: "violet",
  Content: "gold",
};

function App() {
  const [issues, setIssues] = useState(seedIssues);
  const [loading, setLoading] = useState(true);
  const [newIssueOpen, setNewIssueOpen] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("All");
  const [draggedId, setDraggedId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadIssues()
      .then((rows) => { if (!cancelled && rows.length) setIssues(rows); })
      .catch((reason) => { if (!cancelled) setError(`Using local board data: ${reason.message}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visibleIssues = useMemo(() => filter === "All" ? issues : issues.filter((issue) => issue.category === filter), [filter, issues]);

  async function submitIssue(event) {
    event.preventDefault();
    const title = newIssueTitle.trim();
    if (!title) return;
    try {
      const issue = await createIssue(title, issues);
      setIssues((current) => [...current, issue]);
      setNewIssueTitle("");
      setNewIssueOpen(false);
    } catch (reason) {
      setError(reason.message);
    }
  }

  async function move(issue, status) {
    if (issue.status === status) return;
    const previous = issues;
    const optimistic = previous.map((item) => item.id === issue.id ? { ...item, status } : item);
    setIssues(optimistic);
    try {
      setIssues(await moveIssue(issue, status, previous));
    } catch (reason) {
      setIssues(previous);
      setError(reason.message);
    }
  }

  function moveWithKeyboard(issue, direction) {
    const index = columns.findIndex((column) => column.id === issue.status);
    const target = columns[index + direction];
    if (target) move(issue, target.id);
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main>
        <header className="topbar">
          <div><h1>Website Redesign</h1>{loading ? <span className="loading">Loading browser database…</span> : null}</div>
          <div className="actions">
            <div className="filter-wrap">
              <button type="button" className="secondary" onClick={() => setFilterOpen((current) => !current)} aria-expanded={filterOpen}><FilterIcon /> Filters</button>
              {filterOpen ? <div className="filter-menu" role="menu">{["All", "Design", "Frontend", "DevOps", "Performance"].map((item) => <button type="button" role="menuitemradio" aria-checked={filter === item} key={item} onClick={() => { setFilter(item); setFilterOpen(false); }}>{item}</button>)}</div> : null}
            </div>
            <label className="group-select"><span className="sr-only">Group issues</span><select><option>Group: None</option><option>Group: Assignee</option></select></label>
            <button type="button" className="primary" onClick={() => setNewIssueOpen(true)}><PlusIcon /> New issue</button>
          </div>
        </header>
        {error ? <p className="notice" role="status">{error}</p> : null}
        <section className="board" aria-label="Website Redesign sprint board">
          {columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              issues={visibleIssues.filter((issue) => issue.status === column.id).sort((left, right) => left.position - right.position)}
              draggedId={draggedId}
              onDragStart={setDraggedId}
              onDrop={(status) => {
                const issue = issues.find((item) => item.id === draggedId);
                if (issue) move(issue, status);
                setDraggedId(null);
              }}
              onMoveKeyboard={moveWithKeyboard}
              newIssueOpen={column.id === "backlog" && newIssueOpen}
              newIssueTitle={newIssueTitle}
              onNewIssueTitle={setNewIssueTitle}
              onSubmitIssue={submitIssue}
              onCancelIssue={() => { setNewIssueOpen(false); setNewIssueTitle(""); }}
            />
          ))}
        </section>
      </main>
    </div>
  );
}

function Sidebar() {
  const items = [
    ["Board", BoardIcon],
    ["Backlog", ListIcon],
    ["Reports", ChartIcon],
    ["Releases", TagIcon],
    ["Settings", GearIcon],
  ];
  return <aside className="sidebar"><div className="brand"><span><i /><i /><i /></span>Sprint Board</div><nav>{items.map(([label, Icon], index) => <a href="#board" className={index === 0 ? "active" : ""} key={label}><Icon />{label}</a>)}</nav><label className="project-select"><span className="sr-only">Project</span><select><option>Website Redesign</option></select></label><div className="profile"><Avatar person={people.taylor} /><span>Taylor Smith</span><b>⌄</b></div></aside>;
}

function BoardColumn({ column, issues, draggedId, onDragStart, onDrop, onMoveKeyboard, newIssueOpen, newIssueTitle, onNewIssueTitle, onSubmitIssue, onCancelIssue }) {
  return (
    <div className={draggedId ? "column dragging" : "column"} onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(column.id)}>
      <header><h2>{column.title} <span>· {issues.length}</span></h2><button type="button" aria-label={`${column.title} menu`}>⋮</button></header>
      <div className="issue-list">
        {issues.map((issue) => <IssueCard key={issue.id} issue={issue} onDragStart={() => onDragStart(issue.id)} onMoveKeyboard={onMoveKeyboard} />)}
        {newIssueOpen ? <form className="new-issue" onSubmit={onSubmitIssue}><label><span className="sr-only">New issue title</span><input autoFocus value={newIssueTitle} onChange={(event) => onNewIssueTitle(event.target.value)} placeholder="New issue title" /></label><div><button type="submit">Add issue</button><button type="button" onClick={onCancelIssue}>Cancel</button></div></form> : null}
      </div>
    </div>
  );
}

function IssueCard({ issue, onDragStart, onMoveKeyboard }) {
  const person = people[issue.assignee] || people.taylor;
  return (
    <article className="issue-card" draggable onDragStart={onDragStart} tabIndex="0" onKeyDown={(event) => {
      if (event.key === "ArrowLeft") { event.preventDefault(); onMoveKeyboard(issue, -1); }
      if (event.key === "ArrowRight") { event.preventDefault(); onMoveKeyboard(issue, 1); }
    }} aria-label={`${issue.issue_key}: ${issue.title}. Press left or right arrow to move.`}>
      <span className="grip" aria-hidden="true">⠿</span>
      <div className="issue-copy"><code>{issue.issue_key}</code><h3>{issue.title}</h3><span className={`label ${categoryStyles[issue.category] || "blue"}`}>{issue.category}</span></div>
      <Avatar person={person} />
    </article>
  );
}

function Avatar({ person }) {
  return <img className="avatar" src={person.image} alt={person.name} title={person.name} />;
}

createRoot(document.getElementById("root")).render(<App />);
