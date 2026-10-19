FROM julia:1.8
WORKDIR /app
COPY . .
RUN julia -e "using Pkg; Pkg.add(\"HTTP\")"
EXPOSE 3016
CMD ["julia", "app.jl"]