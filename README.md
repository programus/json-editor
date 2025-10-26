# JSON Editor

A json editor based on [svelt-jsoneditor](https://github.com/josdejong/svelte-jsoneditor) with a [docker image](https://hub.docker.com/repository/docker/programus/json-editor/general), which you can use to self-host one by yourself.

## Using by docker

docker-compose.yml

```yaml
services:
  json-editor:
    platform: linux/amd64
    container_name: json-editor
    image: programus/json-editor:latest
    ports:
      - "8080:80"
```

or docker command

```sh
docker run --rm --platform linux/amd64 --name json-editor -p 8080:80 programus/json-editor:latest
```

and then open http://localhost:8080 by browser.
