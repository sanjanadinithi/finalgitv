defmodule Microservice11.Application do
  use Application

  def start(_type, _args) do
    :ets.new(:metrics_counters, [:named_table, :public])
    :ets.insert(:metrics_counters, [{:inc, 0}, {:proc, 0}, {:err, 0}])
    children = [
      {Plug.Cowboy, scheme: :http, plug: Microservice11.Router, options: [port: String.to_integer(System.get_env("PORT", "3011"))]}
    ]
    opts = [strategy: :one_for_one, name: Microservice11.Supervisor]
    Supervisor.start_link(children, opts)
  end
end