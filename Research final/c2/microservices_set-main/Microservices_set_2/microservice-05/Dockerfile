FROM ruby:3.3-alpine AS builder

WORKDIR /app

RUN apk add --no-cache build-base git

COPY Gemfile ./
RUN bundle config set --local without 'development test' && \
    bundle install

COPY . .
RUN bundle install

FROM ruby:3.3-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /usr/local/bundle /usr/local/bundle
COPY --from=builder /app .

ENV RACK_ENV=production
ENV APP_ENV=production
ENV PORT=3005

EXPOSE 3005

CMD ["ruby", "app.rb"]
