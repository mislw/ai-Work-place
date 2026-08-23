FROM caddy:2.10.2-alpine

RUN addgroup -S -g 10001 relay \
  && adduser -S -D -H -u 10001 -G relay relay \
  && setcap -r /usr/bin/caddy \
  && test -z "$(getcap /usr/bin/caddy)"

COPY --chown=relay:relay Caddyfile /etc/caddy/Caddyfile

ENV HOME=/tmp/relay \
    XDG_CONFIG_HOME=/tmp/relay/config \
    XDG_DATA_HOME=/tmp/relay/data

USER relay
