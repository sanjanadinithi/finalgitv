FROM gradle:7.6-jdk17
WORKDIR /app
COPY build.gradle.kts ./
RUN if [ -f settings.gradle.kts ]; then cp settings.gradle.kts ./; fi
RUN gradle build --no-daemon || true
COPY . .
RUN gradle build --no-daemon || true
EXPOSE 3009
CMD ["gradle", "run", "--no-daemon"]
