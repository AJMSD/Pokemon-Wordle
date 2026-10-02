# CORS for auth and REST, answered at the gateway (GoTrue's own CORS rejects
# the apikey / x-supabase-api-version headers supabase-js sends from browsers).
# Included from location blocks; $cors_origin is set in default.conf.
proxy_hide_header Access-Control-Allow-Origin;
proxy_hide_header Access-Control-Allow-Credentials;
proxy_hide_header Access-Control-Allow-Headers;
proxy_hide_header Access-Control-Allow-Methods;
proxy_hide_header Access-Control-Expose-Headers;

add_header Access-Control-Allow-Origin $cors_origin always;
add_header Access-Control-Allow-Credentials true always;
add_header Access-Control-Allow-Headers "apikey, authorization, content-type, x-client-info, x-supabase-api-version, prefer, range, accept-profile, content-profile" always;
add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
add_header Access-Control-Expose-Headers "content-range, x-total-count" always;
add_header Access-Control-Max-Age 86400 always;
add_header Vary Origin always;

if ($request_method = OPTIONS) {
  return 204;
}
