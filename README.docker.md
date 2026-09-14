# Playthrough

**Draw the feature before it exists. Then play your scenarios through the drawing.**

A team designing a feature draws a flow on a whiteboard and lists the cases in a spreadsheet. The two
never meet, so nobody notices the case that no branch handles until the code is written. Playthrough
puts them on one page: you draw the flow as nodes joined by guarded edges, each scenario is a row of
inputs and expectations, and every row is played through the drawing as you type, turning green or
red.

![Playthrough](https://raw.githubusercontent.com/hussein-akar/playthrough/main/assets/playthrough.jpg)

## Try it

```bash
docker run --rm -p 8095:8095 husseinakar/playthrough
```

1. Open <http://localhost:8095>.
2. Click **Template → Presets**, and press **Load it** on **Simple**.
3. Click the red row in the table, *Phone order*, to see its path, and double-click it to see why it
   fails.

Whatever you save this way lives inside the container and is gone when it stops.

## Keep your flows

Run it from the repository the feature belongs to, with a folder mounted:

```bash
docker run -d --name playthrough -p 8095:8095 \
  -v "$PWD/specs:/app/specs" \
  husseinakar/playthrough
```

| Part | Why it is there |
|---|---|
| `-p 8095:8095` | Your browser reaches it at <http://localhost:8095>. |
| `-v "$PWD/specs:/app/specs"` | Every flow is a JSON file in `specs/` on your disk, ready to commit. |

**On Linux**, add `--user "$(id -u):$(id -g)"` so the container can write to the folder. Docker
Desktop on macOS and Windows does not need it.

### Docker Compose

```yaml
services:
  playthrough:
    image: husseinakar/playthrough
    ports:
      - "8095:8095"
    volumes:
      - ./specs:/app/specs
    restart: unless-stopped
    # On Linux, your own ids, from `id -u` and `id -g`:
    # user: "1000:1000"
```

## Reference

| | |
|---|---|
| **Platforms** | `linux/amd64`, `linux/arm64` |
| **Tags** | `latest` (the main branch), `1.2.3` (a release), `1.2` (the newest 1.2.x) |
| **Port** | `8095` |
| **Project folder** | `/app/specs` |
| **User** | `node` (uid 1000) |
| **Health check** | `GET /health` answers `{"status":"UP","version":"1.1.1"}` — the version is the image's, and the page shows it beside the name |

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8095` | The port inside the container. |
| `PLAYTHROUGH_DIR` | `/app/specs` | The project folder. Set it to empty (`-e PLAYTHROUGH_DIR=`) to run without one; **Save** then downloads a file. |

To update: `docker pull husseinakar/playthrough`, then remove the container and start it again. Your
flows are in the mounted folder, not in the container.

There is no authentication. Run it on your machine or a trusted network.

## More

The full guide (drawing, conditions, scenarios, generating scenarios, keys, the file format and the
HTTP API) is in the repository: <https://github.com/hussein-akar/playthrough>.

Apache 2.0.
