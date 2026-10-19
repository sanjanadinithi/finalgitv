FROM clojure:openjdk-17-lein
WORKDIR /app
COPY project.clj ./
RUN lein deps
COPY . .
EXPOSE 3012
CMD ["lein", "run"]