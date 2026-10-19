FROM rust:1.70
WORKDIR /app
COPY Cargo.toml ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release || true
RUN rm -rf src
COPY src ./src
RUN cargo build --release
EXPOSE 3008
CMD ["./target/release/microservice-08"]
