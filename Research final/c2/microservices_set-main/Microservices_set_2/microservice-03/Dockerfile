FROM maven:3.9-eclipse-temurin-17
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests
EXPOSE 3003
CMD ["java", "-jar", "target/microservice-03-0.0.1-SNAPSHOT.jar"]
