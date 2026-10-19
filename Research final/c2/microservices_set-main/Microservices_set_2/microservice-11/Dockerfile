FROM elixir:1.14
WORKDIR /app
COPY mix.exs mix.lock ./
RUN mix deps.get
COPY . .
RUN mix compile
EXPOSE 3011
CMD ["mix", "run", "--no-halt"]