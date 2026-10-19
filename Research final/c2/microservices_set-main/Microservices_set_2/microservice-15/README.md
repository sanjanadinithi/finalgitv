# Microservice 15 - R Plumber

A basic microservice using R and Plumber.

## Running

1. Install R and Plumber (`install.packages('plumber')`) if not installed.
2. Run: `Rscript -e "library(plumber); pr <- plumb('plumber.R'); pr$run(port=3015)"`

Access at http://localhost:3015/