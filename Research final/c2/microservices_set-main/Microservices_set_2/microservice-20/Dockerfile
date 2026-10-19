FROM swift:5.7
WORKDIR /app
COPY Package.swift ./
RUN swift package resolve
COPY . .
RUN swift build -c release
EXPOSE 3020
CMD ["./.build/release/App"]