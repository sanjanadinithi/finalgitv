FROM perl:5.36
WORKDIR /app
RUN cpan Mojolicious
COPY . .
EXPOSE 3018
CMD perl app.pl daemon -l http://*:${PORT:-3018}