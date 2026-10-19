defmodule Microservice11.MixProject do
  use Mix.Project

  def project do
    [
      app: :microservice_11,
      version: "0.1.0",
      elixir: "~> 1.14",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {Microservice11.Application, []}
    ]
  end

  defp deps do
    [
      {:plug_cowboy, "~> 2.5"}
    ]
  end
end