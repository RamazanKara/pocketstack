create table notes (
  id integer primary key,
  title text not null,
  done integer not null default 0
);
