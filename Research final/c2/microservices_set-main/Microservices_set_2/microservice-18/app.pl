#!/usr/bin/env perl

use Mojolicious::Lite -signatures;
use Time::HiRes ();

my %C = (inc => 0, proc => 0, err => 0);
my $last_latency = 0;
my $start = time();

sub T { Time::HiRes::time() }

sub finish {
  my ($c, $t0) = @_;
  $C{proc}++;
  $last_latency = (T() - $t0) * 1000;
  if (($c->res->code // 200) >= 400) { $C{err}++ }
  return 1;
}

get '/' => sub ($c) {
  my $t0 = T();
  $C{inc}++;
  my $r = $c->render(text => 'Hello from Microservice 18 (Perl Mojolicious)');
  finish($c, $t0);
  return $r;
};

get '/ping' => sub ($c) {
  my $t0 = T();
  $C{inc}++;
  my $r = $c->render(json => { status => 'ok', service => $ENV{SERVICE_NAME} // 'service-perl-18' });
  finish($c, $t0);
  return $r;
};

get '/health' => sub ($c) {
  my $t0 = T();
  $C{inc}++;
  my $r = $c->render(json => {
    status => 'ok', service => $ENV{SERVICE_NAME} // 'service-perl-18',
    service_id => $ENV{SERVICE_NAME} // 'service-perl-18',
    platform => $ENV{PLATFORM} // 'render',
    target_reachable => \1, health_check_failed => 0,
    latency_ms => $last_latency, target => 'self'
  });
  finish($c, $t0);
  return $r;
};

get '/metrics' => sub ($c) {
  my $t0 = T();
  $C{inc}++;
  my $inc = $C{inc};
  my $proc = $C{proc};
  my $err = $C{err};
  my $r = $c->render(json => {
    platform => $ENV{PLATFORM} // 'render',
    service => $ENV{SERVICE_NAME} // 'service-perl-18',
    timestamp => scalar(gmtime),
    cpu_usage_percent => 0,
    incoming_requests => $inc, processing_requests => $proc,
    queue_length => ($inc > $proc ? $inc - $proc : 0),
    latency_ms => $last_latency,
    service_unreachable => 0, health_check_failed => 0, request_timeout => 0,
    http_errors_per_sec => $err,
    error_rate => ($inc > 0 ? $err / $inc : 0),
    uptime_seconds => time() - $start,
    measurement_method => 'application_runtime', cpu_allocation => 'unknown'
  });
  finish($c, $t0);
  return $r;
};

get '/spike' => sub ($c) {
  my $t0 = T();
  $C{inc}++;
  my $d = $c->param('duration') // 10;
  my $end = time() + $d;
  while (time() < $end) { sqrt(64**5); }
  my $r = $c->render(json => { message => "CPU spiked for $d seconds", service => $ENV{SERVICE_NAME} // 'service-perl-18' });
  finish($c, $t0);
  return $r;
};

app->start;
