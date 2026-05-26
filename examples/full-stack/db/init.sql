create table if not exists todos (
  id integer primary key,
  name text not null
);

insert into todos (id, name)
values (1, 'Ship browser-only demos')
on conflict (id) do update set name = excluded.name;
