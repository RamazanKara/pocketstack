create table if not exists issues (
  id serial primary key,
  issue_key text unique not null,
  title text not null,
  category text not null,
  status text not null check (status in ('backlog', 'progress', 'done')),
  assignee text not null,
  position integer not null
);

insert into issues (issue_key, title, category, status, assignee, position) values
  ('WEB-101', 'Improve landing page hero', 'Design', 'backlog', 'maya', 1),
  ('WEB-102', 'Add product grid', 'Enhancement', 'backlog', 'noah', 2),
  ('WEB-103', 'Optimize images', 'Performance', 'backlog', 'taylor', 3),
  ('WEB-104', 'Build navigation menu', 'Frontend', 'backlog', 'liam', 4),
  ('WEB-105', 'Integrate analytics', 'Analytics', 'backlog', 'omar', 5),
  ('WEB-106', 'Fix mobile spacing', 'Frontend', 'progress', 'taylor', 1),
  ('WEB-107', 'Set up project repo', 'DevOps', 'progress', 'omar', 2),
  ('WEB-108', 'Configure CI workflow', 'DevOps', 'progress', 'noah', 3),
  ('WEB-109', 'Create component library', 'Frontend', 'done', 'maya', 1),
  ('WEB-110', 'Add basic routing', 'Frontend', 'done', 'liam', 2),
  ('WEB-111', 'Update color palette', 'Design', 'done', 'taylor', 3),
  ('WEB-112', 'Write initial content', 'Content', 'done', 'omar', 4)
on conflict (issue_key) do nothing;
