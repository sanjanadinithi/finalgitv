FROM r-base:4.2
WORKDIR /app
RUN R -e "install.packages('plumber')"
COPY . .
EXPOSE 3015
CMD ["Rscript", "-e", "library(plumber); pr <- plumb('plumber.R'); pr$run(port=3015)"]