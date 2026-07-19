export const people = {
  maya: { name: "Maya Chen", image: "/assets/avatar-maya.jpg" },
  noah: { name: "Noah Williams", image: "/assets/avatar-noah.jpg" },
  taylor: { name: "Taylor Smith", image: "/assets/avatar-taylor.jpg" },
  liam: { name: "Liam Carter", image: "/assets/avatar-liam.jpg" },
  omar: { name: "Omar Haddad", image: "/assets/avatar-omar.jpg" },
};

export const seedIssues = [
  ["WEB-101", "Improve landing page hero", "Design", "backlog", "maya", 1],
  ["WEB-102", "Add product grid", "Enhancement", "backlog", "noah", 2],
  ["WEB-103", "Optimize images", "Performance", "backlog", "taylor", 3],
  ["WEB-104", "Build navigation menu", "Frontend", "backlog", "liam", 4],
  ["WEB-105", "Integrate analytics", "Analytics", "backlog", "omar", 5],
  ["WEB-106", "Fix mobile spacing", "Frontend", "progress", "taylor", 1],
  ["WEB-107", "Set up project repo", "DevOps", "progress", "omar", 2],
  ["WEB-108", "Configure CI workflow", "DevOps", "progress", "noah", 3],
  ["WEB-109", "Create component library", "Frontend", "done", "maya", 1],
  ["WEB-110", "Add basic routing", "Frontend", "done", "liam", 2],
  ["WEB-111", "Update color palette", "Design", "done", "taylor", 3],
  ["WEB-112", "Write initial content", "Content", "done", "omar", 4],
].map(([issue_key, title, category, status, assignee, position], index) => ({
  id: index + 1,
  issue_key,
  title,
  category,
  status,
  assignee,
  position,
}));

export const columns = [
  { id: "backlog", title: "Backlog" },
  { id: "progress", title: "In progress" },
  { id: "done", title: "Done" },
];
