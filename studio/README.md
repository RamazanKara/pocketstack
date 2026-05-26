# PocketStack Studio

PocketStack Studio is a static browser page for quick compatibility checks.

Use it to paste Compose YAML, upload a Compose file, optionally add the project
folder, and see which browser adapter each service maps to. Studio does not
call a PocketStack backend, Docker daemon, runner, or hidden server. The only
network dependency is the browser loading `js-yaml` from a public CDN so YAML
can be parsed locally in the tab.

Studio mirrors the CLI analyzer closely enough to flag:

- unsupported services;
- missing project files for bind-mounted assets;
- COOP/COEP host requirements;
- browser runtime network access;
- the WebContainer bridge used for mock/database demo endpoints.

Run it locally:

```sh
make studio
```

Then open <http://127.0.0.1:4173/>. When the default port is occupied, run
`make studio PORT=4174` from the repo root.
