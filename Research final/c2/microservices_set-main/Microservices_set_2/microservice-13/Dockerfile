FROM haskell:9.4
WORKDIR /app
COPY package.yaml stack.yaml ./
RUN stack build --only-dependencies
COPY . .
RUN stack build
EXPOSE 3013
CMD ["stack", "exec", "microservice-13-exe"]