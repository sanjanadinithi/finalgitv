FROM openresty/openresty:1.21.4.1-0-alpine

WORKDIR /app

RUN apk add --no-cache \
    lua5.1 \
    lua5.1-dev \
    luarocks5.1 \
    gcc \
    musl-dev \
    make \
    openssl-dev

RUN luarocks-5.1 install lapis

COPY . .

EXPOSE 3017

CMD ["lapis", "server", "--port", "3017"]