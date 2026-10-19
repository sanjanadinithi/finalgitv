FROM google/dart:2.19
WORKDIR /app
COPY pubspec.yaml ./
RUN dart pub get
COPY . .
EXPOSE 3014
CMD ["dart", "run", "bin/server.dart"]