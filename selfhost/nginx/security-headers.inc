# Security headers for the static site. nginx add_header is NOT inherited into
# a location that declares its own add_header, so every site location includes
# this file. `always` keeps the headers on 404s and other error responses.
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; connect-src 'self' https://wurmple-api.ajmsd.space https://pokeapi.co; img-src 'self' data: https://raw.githubusercontent.com; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
