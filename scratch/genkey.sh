#!/bin/bash

# implementation based from: https://coolaj86.com/articles/create-your-own-certificate-authority-for-testing/

FQDN="$1"



# Create the CSR
openssl req -new \
  -key "keys/ca.private.key" \
  -out "temp.csr" \
  -subj "/C=US/ST=WA/L=Provo/O=Proxy Service/CN=${FQDN}"


# Sign the request from Server with your Root CA
openssl x509 \
  -req -in temp.csr \
  -CA certs/ca.pem \
  -CAkey keys/ca.private.key \
  -CAcreateserial \
  -out temp.crt \
  -days 9131
 


echo ""

# echo "PRIVATE server bundle: certs/servers/${FQDN}/server.pem"
# echo "(keep it secret, keep it safe - just like privkey.pem)"
# echo ""
# echo ""
# cat \
  # "keys/ca.private.key" \
  # "temp.crt" \
  # > "temp.crt"




# TODO
#
# The Convention for Full Chain is one of these:
#   root + intermediates + cert
#   root + intermediates
#   intermediates + cert
#
# ... but I don't remember which
# I may be wrong about chain as well...

echo "fullchain: certs/servers/${FQDN}/fullchain.pem"
echo "(contains Server CERT, Intermediates and Root CA)"
echo ""
echo ""
cat \
  "temp.crt" \
  "certs/ca.pem" \
  > "temp.fullchain.crt"

echo "All Done"

