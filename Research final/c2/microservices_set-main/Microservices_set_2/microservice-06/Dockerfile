FROM php:8.1-cli
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends unzip libzip-dev && docker-php-ext-install zip && rm -rf /var/lib/apt/lists/*
COPY composer.json ./
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
RUN composer install --no-interaction --prefer-source
COPY . .
EXPOSE 3006
CMD ["php", "-S", "0.0.0.0:3006", "index.php"]
