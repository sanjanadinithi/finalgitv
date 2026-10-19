FROM hseeberger/scala-sbt:17.0.2_1.6.2_2.13.8

WORKDIR /app

COPY build.sbt ./
COPY project/ ./project/

RUN sbt update

COPY . .

RUN sbt compile

EXPOSE 3010

CMD sh -c 'sbt -Dhttp.port=$PORT run'