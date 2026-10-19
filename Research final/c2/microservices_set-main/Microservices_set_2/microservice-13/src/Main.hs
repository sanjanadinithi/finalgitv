{-# LANGUAGE OverloadedStrings #-}

module Main where

import Network.Wai
import Network.Wai.Handler.Warp
import Network.HTTP.Types
import Data.IORef
import System.IO.Unsafe
import System.Environment (lookupEnv)
import Data.ByteString (ByteString)
import qualified Data.ByteString.Char8 as BS

counters :: IORef (Int, Int, Int)
counters = unsafePerformIO $ newIORef (0, 0, 0)
{-# NOINLINE counters #-}

main :: IO ()
main = do
  mport <- lookupEnv "PORT"
  let port = case mport of
        Just s -> case reads s of
          [(n, "")] -> n
          _ -> 3013
        Nothing -> 3013
  run port app

app :: Application
app req respond = do
  atomicModifyIORef' counters (\(a, b, c) -> ((a + 1, b, c), ()))
  let path = rawPathInfo req
      pingBody = BS.pack "{\"status\":\"ok\",\"service\":\"service-haskell-13\"}"
      healthBody = BS.pack "{\"status\":\"ok\",\"service\":\"service-haskell-13\",\"service_id\":\"service-haskell-13\",\"target_reachable\":true,\"health_check_failed\":0,\"latency_ms\":0.0,\"target\":\"self\"}"
  (inc, proc, err) <- readIORef counters
  let metricsBody = BS.pack $
        "{\"platform\":\"render\",\"service\":\"service-haskell-13\",\"cpu_usage_percent\":0.0," ++
        "\"incoming_requests\":" ++ show inc ++
        ",\"processing_requests\":" ++ show proc ++
        ",\"queue_length\":" ++ show (max 0 (inc - proc)) ++
        ",\"latency_ms\":0.0,\"service_unreachable\":0,\"health_check_failed\":0,\"request_timeout\":0," ++
        "\"http_errors_per_sec\":" ++ show err ++
        ",\"error_rate\":0.0,\"uptime_seconds\":0.0," ++
        "\"measurement_method\":\"application_runtime\",\"cpu_allocation\":\"unknown\"}"
      resp = case path of
        "/" -> responseLBS ok200 [("Content-Type", "text/plain")] "Hello from Microservice 13 (Haskell)"
        "/ping" -> responseBS ok200 [("Content-Type", "application/json")] pingBody
        "/health" -> responseBS ok200 [("Content-Type", "application/json")] healthBody
        "/metrics" -> responseBS ok200 [("Content-Type", "application/json")] metricsBody
        "/spike" -> responseLBS ok200 [("Content-Type", "application/json")] "{\"message\":\"CPU spiked\",\"service\":\"service-haskell-13\"}"
        _ -> responseLBS notFound404 [("Content-Type", "text/plain")] "Not found"
  atomicModifyIORef' counters (\(a, b, c) -> ((a, b + 1, c), ()))
  respond resp
