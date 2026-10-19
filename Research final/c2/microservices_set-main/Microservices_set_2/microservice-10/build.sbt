name := "microservice-10"
version := "1.0"
scalaVersion := "2.13.10"

lazy val root = (project in file(".")).enablePlugins(PlayScala)

libraryDependencies += guice
libraryDependencies += "com.typesafe.play" %% "play" % "2.8.20"
